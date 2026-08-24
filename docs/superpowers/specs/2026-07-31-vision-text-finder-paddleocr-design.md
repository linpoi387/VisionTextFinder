# 文字雷達 — PaddleOCR 引擎重寫設計

日期：2026-07-31
狀態：已批准（使用者逐段核准架構、比對、錯誤處理、測試四段設計）

## 背景與動機

現行「文字雷達」以 Tesseract.js（`chi_tra+eng`）在瀏覽器內做 OCR，並在圖片中標記使用者輸入文字的座標。使用者回報兩類問題：

- **漏框（false negative）**：部分字（尤其繁中細筆畫）辨識不出來，導致目標文字找不到。
- **誤框（false positive）**：把不是目標的文字標記出來。

根因（已診斷自現有 `app.js`）：

1. `enhanceForOcr()` 的 `grayscale(1) contrast(1.25)` 會打斷繁中細筆畫。
2. `preciseMatches()` 用精確 `indexOf`，OCR 錯一字就整筆遺漏。
3. fuzzy 模式 `replace(/[\s\p{P}]/gu, '')` 刪除全部標點，使「ABC」可誤配「A、B、C」等。
4. 無信心度門檻，低品質辨識結果也畫框。
5. 數字專用 PSM 11 whitelist 路徑易把中文筆畫誤讀成數字。

## 目標

改用 PaddleOCR.js（官方瀏覽器 SDK）替代 Tesseract.js，配合多語模型（字典涵蓋繁中、英數），從根本提升辨識品質，並重寫比對邏輯以同時減少漏框與誤框。

## 非目標（YAGNI）

- 不上傳圖片到任何伺服器（維持全本地處理）。
- 不做後端、不做帳號、不做批次處理。
- 不保留 Tesseract 程式碼路徑。

## 已確認的使用者決策

1. 方向：維持純瀏覽器、可加載更好的模型（不上傳圖片）。
2. 部署：本地伺服器 + 模型放本機；新增啟動腳本，接受「不再能雙擊 index.html」。
3. 方案：A — 完全離線（模型、SDK、onnxruntime-wasm、opencv.js 全部下載到本機）。

## 架構

```
vision-text-finder/
├── 啟動.bat            # 雙擊入口：node server.js
├── server.js           # Node 本地 HTTP 伺服器 + 資源下載器（零依賴，僅用 Node 內建模組）
├── index.html          # 修改：以 <script type="module"> 載入 vendor 的 SDK 與 app.js
├── app.js              # 重寫：PaddleOCR 引擎 + 新比對邏輯（module）
├── style.css           # 大致保留（可加信心度滑桿樣式）
├── models/             # PP-OCRv6_small_det + PP-OCRv6_small_rec 兩個 .tar（首次啟動自動下載）
├── vendor/             # @paddleocr/paddleocr-js、onnxruntime-web wasm、opencv.js（首次啟動自動下載）
├── test-images/        # 人工測試圖（供手動測試）
└── README.md           # 更新使用說明（不可雙擊 index.html，改為執行 啟動.bat）
```

三個單元、職責單一：

1. **`server.js`** — 純靜態檔案伺服器 + 資源下載器。
   - 啟動時檢查 `models/` 與 `vendor/` 完整性；缺檔或檔案損壞（大小為 0 或小於閾值）即下載，進度印在伺服器視窗 console。
   - 下載完成後在 `127.0.0.1` 的固定 port `8123` 伺服專案資料夾；port 被佔用時自動嘗試下一埠並回報實際網址。
   - 伺服完畢自動以 `start http://127.0.0.1:<port>/` 開啟瀏覽器（Windows 的 `start` 指令）。
   - 同一 origin 提供檔案，無 CORS 問題；`.tar`、`.wasm`、`.mjs` 均給正確 `Content-Type`。
   - 關閉視窗即停止伺服器。

2. **`app.js`** — 前端邏輯（ES module）：載入圖片 → PaddleOCR 辨識 → 比對目標 → 畫框 → 顯示結果。

3. **`啟動.bat`** — 薄入口：`@echo off` + `node server.js`。伺服器視窗同時作為下載進度與錯誤訊息的顯示處，結束時不自動關閉視窗（`pause`），避免使用者看不到錯誤。

### 新增資源來源（URL 寫死於 server.js）

| 資源 | 來源 | 驗證 |
|---|---|---|
| det 模型 | `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_det_onnx_infer.tar` | 已確認 HTTP 200 |
| rec 模型 | `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_rec_onnx_infer.tar` | 已確認 HTTP 200 |
| SDK | `https://registry.npmjs.org/@paddleocr/paddleocr-js/-/paddleocr-js-0.4.2.tgz`（unpacked ~23.8MB） | 已確認存在 |
| onnxruntime-web + opencv.js | 對應 npm tarball（版本於實作時釘住並記錄於 server.js） | 實作時驗證 |

- 模型下載後命名為 `PP-OCRv6_small_det_onnx_infer.tar` / `PP-OCRv6_small_rec_onnx_infer.tar` 存放於 `models/`，不做解包——SDK 直接 fetch 整個 `.tar`，內部自行依 ustar 讀取 `inference.onnx` 與 `inference.yml`。
- SDK 依賴 onnxruntime-web（wasm）與 opencv.js，需以本地路徑載入（`wasmPaths` 指向 `vendor/`），確保離線可用。
- 完全離線的前提：首次下載成功後，後續啟動不再需要任何網路。

## 執行流程與資料結構

```
圖片載入 → PaddleOCR.create({...}) → predict(image, params) → items[]
→ 比對邏輯逐 item 檢查 → 命中產生 bbox → draw() 畫框 → showMatches() 列表
```

PaddleOCR 的 `predict` 回傳 `OcrResult[]`，每筆含 `items[]`，每項：

```
{ poly: [{x,y}×4], text: string, score: number }
```

- `poly` 為四點多邊形，座標已縮放回原圖尺寸。
- `text` 為整行/整段辨識文字。
- `score` 為 0–1 逐字元平均機率。

### SDK 初始化參數

- `PaddleOCR.create({ textDetectionModelName: 'PP-OCRv6_small_det', textRecognitionModelName: 'PP-OCRv6_small_rec', ortOptions })`。
- SDK 僅接受 HTTP origin（`file://` 會拋錯）——本地伺服器方案的必要理由。
- runtime 參數（沿用官方 demo 合理值）：
  - `textDetThresh: 0.3`
  - `textDetBoxThresh: 0.6`
  - `textDetUnclipRatio: 1.5`
  - `textRecScoreThresh`：由 UI 的信心度滑桿控制（見下）。
- `predict(source, { textRecScoreThresh })`，source 直接傳原圖（HTMLImageElement / canvas 皆可）。

## 比對邏輯（取代舊 `preciseMatches`）

PaddleOCR 給整行文字，比對因此以「行」為單位：

1. **正規化（normalise）**：
   - 精確模式：`value.trim()`。
   - 忽略大小寫與空白模式：移除所有空白字元（含全形空格）並 `toLocaleLowerCase()`；**不移除標點**（避免「A、B、C」誤配「ABC」的誤框來源）。
2. **三種模式**：
   - **精確**（預設）：`line.includes(query)`。
   - **忽略大小寫與空白**：正規化後 `includes`。
   - **模糊容錯**：以 Levenshtein 距離做滑動視窗比對，允許錯 1–2 個字元（`errorsAllowed = min(2, max(1, floor(queryLen/4)))`），取最低距離的視窗作為命中。
3. **誤框抑制（信心度門檻）**：`score < textRecScoreThresh`（UI 滑桿，預設 0.6、範圍 0–1）的行直接忽略。行文字長度小於目標長度的，直接跳過。
4. **畫框（bbox 產生）**：
   - 整行命中：直接使用該行 `poly` 的四點最小/最大座標形成軸對齊矩形。
   - 子字串命中：沿 `poly` 的四邊做「字元比例內插」切出子區間：
     - 判定方向：`poly` 高度大於寬度 × 1.45 視為垂直文字，沿左右兩邊垂直內插；否則沿上下兩邊水平內插。
     - 內插比例 =（子字串字元數）/（整行字元數），從該行的字元起點/終點位置計算。
     - 最後取四內插點的最小/最大座標，輸出軸對齊 `bbox {x0,y0,x1,y1}`，與現行 `draw()` 相容。
5. **多行命中**：所有命中全部列出（沿用現行「全部顯示」）。
6. **去重**：保留現行 `overlap() > 0.45` 的 `uniqueMatches()` 語意，防止同一命中被重複畫框。
7. **「擴大搜尋」**：保留現行選項（預設關閉）。勾選時，額外對原圖放大 3 倍的 canvas 再跑一次 `predict`，將結果座標縮回原圖後與第一次結果合併去重，以補較小/較淡文字；沿用現行提示「可能增加誤框」。

## UI 變更（基於現行，最小改動）

- 移除 `verified` 以外的舊 checkbox 結構，改為「比對模式」下拉（或分段選單）：
  - `精確`（預設）
  - `忽略大小寫與空白`
  - `模糊容錯（允許 1–2 字差異）`
- 保留「擴大搜尋」勾選框（語意與現行相同）。
- 新增「信心度門檻」滑桿（0–1，預設 0.6，`input` 即時重新比對並重畫框）。
- 其餘沿用：輸入框、拖放上傳、canvas 畫框（現行 `draw()` 的 `#e9562d` 框線與留白邏輯）、結果列表（點擊定位）、下載標記後圖片、`status` 訊息、`countBadge`。
- 移除：舊的「數字專用模式」路徑（多語模型已含數字，無需 whitelist pass）。
- `index.html` 的 Tesseract CDN `<script>` 改為 `<script type="module">` 匯入本地 SDK 與 `app.js`。

## 錯誤處理與使用者體驗

- **首次啟動**（`啟動.bat` → server.js）：
  - 資源缺失 → 下載並於 console 顯示進度（檔名 + 已完成位元組 / 總位元組）。
  - 下載失敗（無網路等）→ 印出明確訊息與缺少的檔案清單，`pause` 停留視窗，供使用者修正後重試。
- **執行期錯誤**：
  - 圖片載入失敗 → 頁面 `status` 提示，不崩潰。
  - SDK 初始化失敗（如 wasm 檔缺失）→ 頁面顯示錯誤與修復指引（重新執行 `啟動.bat` 以下載資源）。
  - 比對無命中 → 「找不到相符文字。」並提示可切換「模糊容錯」或調整信心度門檻。
  - 大圖/慢速裝置：辨識期間 `status` 顯示「辨識中…」，並停用 `findButton`（沿用現行），避免看起來當掉。

## 測試策略

無自動化測試框架（純瀏覽器工具），採手動測試 + 檢查清單：

1. **測試圖**：於 `test-images/` 製作人工圖片，涵蓋：
   - 繁中（含 臺灣、裡/裡 等常見字形）、英文大小寫、數字混排。
   - 故意放置相似易誤框的字（如「太」vs「大」），驗證誤框抑制。
   - 一行直排中文字，驗證垂直切框。
2. **驗證項目**：
   - 精確模式：命中目標、不誤框相似字。
   - 忽略大小寫與空白：英文大小寫、半形/全形空格。
   - 模糊容錯：人為使 OCR 錯 1–2 字的情境仍能命中（以易混淆字形圖測試）。
   - 信心度門檻：調高過濾低信心行、調低找回更多，且變更即時反映。
   - 擴大搜尋：開啟後能多找到較小文字。
   - 啟動流程：刪除 `models/` 後重跑 `啟動.bat` → 自動下載；斷網時 → 明確報錯不崩潰。
3. **回歸**：舊版測試圖片（若使用者仍保有）重跑，確認改善幅度。

## 已知風險與對策

- **SDK 與模型命名驗證**：SDK 依 `inference.yml` 的 `model_name` 驗證模型。`PP-OCRv6_small_det` / `PP-OCRv6_small_rec` 為官方對應名稱，預期相符；若不符，於實作時先解開 tar 檢視 `inference.yml`，以實際 `model_name` 作為傳入名稱，或下載後於 server.js 端補正。
- **opencv.js 與 onnxruntime wasm 的載入路徑**：SDK 預設可能指向 CDN，需明確改指 `vendor/` 本地路徑；實作時以 SDK 文件與原始碼的設定點為準驗證離線可用。
- **node 環境**：本機有 Node v24.14.1 但無 npm；`server.js` 必須零依賴（僅 Node 內建模組：`http`、`https`、`fs`、`path`、`zlib`、`child_process`）。下載與解包 SDK tarball 用 `https.get` + `zlib` gunzip 即可（npm tarball 為 gzip 格式）。
