# 文字雷達（瀏覽器端 PaddleOCR）

在圖片或相機畫面中找出指定文字，並標記其位置。PaddleOCR 與模型完全在使用者的瀏覽器內執行；圖片不會上傳到伺服器或外部 OCR API。

## 本機啟動

1. 安裝 Node.js 18 或更新版本。
2. 在 Windows 雙擊 `啟動.bat`。
3. 開啟顯示的 `http://127.0.0.1:8123` 網址。

請勿直接以 `file://` 開啟 `index.html`，瀏覽器模組與模型檔需要透過本機網頁伺服器提供。

## Render 部署

本專案已附帶 `render.yaml`，可用 Render Blueprint 建立免費的 Static Site。請將下列資料一併提交至 Git：

- `models/`
- `vendor/`
- `render.yaml`

Static Site 僅提供前端檔案，不會執行 Python、FastAPI 或雲端 PaddleOCR，因此不需要付費記憶體方案。

## 使用提示

- 第一次辨識時，瀏覽器需要載入 OCR 模型與 WebAssembly 執行環境，可能需要稍候。
- 相機辨識會持續擷取畫面，但會等待上一輪辨識完成才進行下一輪。
- 效能取決於使用者的裝置；低階手機或高解析度相機畫面可能較慢。
