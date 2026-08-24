# 文字雷達 — PaddleOCR 引擎重寫實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將「文字雷達」從 Tesseract.js 重寫為完全離線的 PaddleOCR.js 引擎，重做比對邏輯，同時減少漏框與誤框。

**Architecture:** `啟動.bat` 啟動零依賴的 `server.js`（首次自動下載模型與 SDK/wasm 到本機，之後完全離線），並在 `127.0.0.1:8123` 提供靜態伺服器。前端以 import map 將 `@paddleocr/paddleocr-js`、`@techstark/opencv-js`、`onnxruntime-web` 三個裸模組指到本機 vendor；`app.js`（ES module）負責 OCR 與畫框，純比對邏輯抽到獨立 `match.js` 以便用 Node 內建測試執行器做自動化測試。

**Tech Stack:** Node 24（`http`/`https`/`fs`，零 npm 依賴）、PaddleOCR.js SDK 0.4.2、onnxruntime-web 1.22.0（wasm）、@techstark/opencv-js 4.10.0-release.1、PP-OCRv6_small（det + rec 多語模型，字典涵蓋繁中/英/數）、Node 內建 `node --test` 測試執行器。

## Global Constraints

- 專案根目錄：`C:\Users\allen.lin\Saved Games\vision-text-finder`（下文 `ROOT`）。
- **零 npm 依賴**：`server.js` 只能用 Node 內建模組（`node:http`、`node:https`、`node:fs`、`node:path`、`node:url`、`node:child_process`）。本機無 npm。
- 所有 UI 文案與 console 訊息使用繁體中文。
- 圖片一律只在瀏覽器本地處理，絕不上傳。
- 首次下載成功後**完全離線**：執行期不得有任何向外部網域發出的請求（用 DevTools Network 面板驗證）。
- 模型名稱（必須與 `inference.yml` 的 `model_name` 完全一致，SDK 會驗證）：
  - `PP-OCRv6_small_det`
  - `PP-OCRv6_small_rec`
- 固定資源版本：SDK `0.4.2`、onnxruntime-web `1.22.0`、opencv-js `4.10.0-release.1`。
- 資源下載來源統一用「單檔直下」的 jsDelivr URL（**此為對 spec 的實作精煉**：spec 寫「npm tarball」，但 npm tarball 需 gzip + tar 解包，而 jsDelivr 提供同內容的單檔直連且皆已驗證 HTTP 200，Node 端無需解包邏輯；「首次下載後離線」的目標不變）。
- 資源清單與完整性閾值（`minBytes` 約為實際大小的 9 成，已實測）：

| 本機路徑 | 下載來源 | 實測大小 | minBytes |
|---|---|---|---|
| `models/PP-OCRv6_small_det_onnx_infer.tar` | `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_det_onnx_infer.tar` | 9,891,840 | 9,000,000 |
| `models/PP-OCRv6_small_rec_onnx_infer.tar` | `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_rec_onnx_infer.tar` | 21,319,680 | 20,000,000 |
| `vendor/sdk/dist/index.mjs` | `https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/dist/index.mjs` | 81,588 | 60,000 |
| `vendor/opencv-js/opencv.js` | `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js` | 10,378,215 | 9,000,000 |
| `vendor/onnxruntime-web/dist/ort.min.mjs` | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.mjs` | 357,568 | 300,000 |
| `vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm` | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.wasm` | 11,210,254 | 10,000,000 |

- 已實測確認：bcebos 與 jsDelivr 下載皆直接回 HTTP 200、**無跳轉**。
- 已實測確認 SDK `dist/index.mjs` 第 6 行為 `import cvModule from "@techstark/opencv-js"`（靜態 default import），且其內部支援 `cvModule instanceof Promise`（會 `await`）——因此 opencv 必須用本計畫的 shim 提供 default export（opencv.js 本身是 UMD，以 ESM 方式直接 import 不會有 default export）。
- 已實測確認 opencv.js 以「一般 `<script>`」載入時會執行 `window.cv = factory()`。
- SDK 執行期透過 `import("onnxruntime-web")` 載入 onnxruntime（import map 同樣涵蓋動態 import）。
- 模型 `.tar` 由 SDK 直接 `fetch`（瀏覽器同源，無 CORS），伺服器須回 `application/octet-stream`。
- 每個任務都必須執行「Step 驗證」所述指令並看到預期輸出後才算完成；每個任務結束都要 commit。

---

## 檔案結構

| 檔案 | 責任 | 任務 |
|---|---|---|
| `package.json` | 宣告 `"type": "module"`（讓 Node 以 ESM 解讀 `.js`） | 1 |
| `.gitignore` | 忽略 `models/`、`vendor/onnxruntime-web/`、`vendor/opencv-js/`、`vendor/sdk/` | 1 |
| `server.js` | 資源下載器 + 靜態伺服器（零依賴） | 1 |
| `啟動.bat` | 雙擊入口：`node server.js`，錯誤時暫停顯示 | 1 |
| `match.js` | 純比對邏輯（正規化、Levenshtein、行內比對、內插切框、去重）——無 DOM | 2 |
| `tests/match.test.js` | `node --test` 測試 | 2 |
| `vendor/opencv-shim.mjs` | opencv.js 的 ESM default export shim（以 `<script>` 載入 opencv.js 並回傳 Promise） | 3 |
| `index.html` | import map + module script + 新控制項（比對模式下拉、信心度滑桿） | 3 |
| `app.js` | 前端主邏輯：初始化 OCR、predict、比對、畫框、結果列表、下載 | 3 |
| `style.css` | 微調（滑桿等；沿用現行） | 3 |
| `test-images/生成測試圖.ps1` | 用 PowerShell System.Drawing 產生人工測試圖 | 4 |
| `README.md` | 更新使用說明 | 4 |

---

### Task 1: server.js（資源下載器 + 靜態伺服器）與啟動腳本

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `server.js`
- Create: `啟動.bat`

**Interfaces:**
- Produces: `node server.js` — 缺資源則下載（進度印 stdout），失敗印中文錯誤並 `process.exit(1)`；成功後啟動 HTTP 伺服器於 `http://127.0.0.1:<port>/`（預設 8123，佔用則遞增最多 20 次），自動開啟瀏覽器，程序保持執行直到關閉視窗。
- Produces: `啟動.bat` — `cd` 到腳本所在目錄、確認 `node` 存在、執行 `node server.js`、`errorlevel` 非零時 `pause`。

- [ ] **Step 1: 建立 `package.json`**

```json
{
  "name": "vision-text-finder",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: 建立 `.gitignore`**

```gitignore
models/
vendor/onnxruntime-web/
vendor/opencv-js/
vendor/sdk/
```

（`vendor/opencv-shim.mjs` 是本專案自建檔，需進版控，不可被忽略。）

- [ ] **Step 3: 建立 `server.js`（完整實作）**

```js
import { createServer } from 'node:http';
import { stat, rename, mkdir, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { extname, join, normalize, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import https from 'node:https';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT_BASE = 8123;
const PORT_TRIES = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.tar': 'application/octet-stream',
  '.yml': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

const RESOURCES = [
  {
    file: 'models/PP-OCRv6_small_det_onnx_infer.tar',
    url: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_det_onnx_infer.tar',
    minBytes: 9000000
  },
  {
    file: 'models/PP-OCRv6_small_rec_onnx_infer.tar',
    url: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_rec_onnx_infer.tar',
    minBytes: 20000000
  },
  {
    file: 'vendor/sdk/dist/index.mjs',
    url: 'https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/dist/index.mjs',
    minBytes: 60000
  },
  {
    file: 'vendor/opencv-js/opencv.js',
    url: 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
    minBytes: 9000000
  },
  {
    file: 'vendor/onnxruntime-web/dist/ort.min.mjs',
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.mjs',
    minBytes: 300000
  },
  {
    file: 'vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.wasm',
    minBytes: 10000000
  }
];

function print(message) { process.stdout.write(message + '\n'); }

async function resourceOk(rel) {
  try {
    const s = await stat(join(ROOT, rel));
    const expected = RESOURCES.find(r => r.file === rel);
    return s.isFile() && s.size >= (expected ? expected.minBytes : 1);
  } catch { return false; }
}

function downloadFile(url, destPath, destRel) {
  return new Promise((resolvePromise, reject) => {
    function request(u, redirectsLeft) {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error(`跳轉次數過多：${u}`));
          return request(new URL(res.headers.location, u).toString(), redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`下載失敗（HTTP ${res.statusCode}）：${u}`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        const out = createWriteStream(destPath);
        out.on('error', reject);
        out.on('finish', () => out.close(() => resolvePromise()));
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            process.stdout.write(`\r${destRel} ${pct}% (${received}/${total})   `);
          }
        });
        res.on('end', () => process.stdout.write('\n'));
        res.on('error', reject);
        res.pipe(out);
      }).on('error', reject);
    }
    request(url, 5);
  });
}

async function ensureResource(res) {
  if (await resourceOk(res.file)) return;
  const dir = join(ROOT, res.file.split('/').slice(0, -1).join('/'));
  await mkdir(dir, { recursive: true });
  const part = join(ROOT, res.file + '.part');
  print(`下載 ${res.file} …`);
  try {
    await downloadFile(res.url, part, res.file);
    const s = await stat(part);
    if (!s.isFile() || s.size < res.minBytes) {
      throw new Error(`${res.file} 下載不完整（${s.size} 位元組）`);
    }
    await rename(part, join(ROOT, res.file));
    print(`完成 ${res.file}（${s.size} 位元組）`);
  } catch (err) {
    await unlink(part).catch(() => {});
    throw err;
  }
}

async function ensureResources() {
  const missing = [];
  for (const res of RESOURCES) {
    if (!(await resourceOk(res.file))) missing.push(res);
  }
  if (missing.length === 0) { print('所有資源已就緒。'); return; }
  print(`需要下載 ${missing.length} 個資源…`);
  for (const res of missing) await ensureResource(res);
  print('資源下載完成。');
}

async function serveRequest(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (pathname === '/') pathname = '/index.html';
  const rel = normalize(pathname).replace(/^[/\\]+/, '');
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const abs = resolve(ROOT, rel);
  const mime = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
  try {
    const s = await stat(abs);
    if (!s.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': s.size, 'Cache-Control': 'no-cache' });
    createReadStream(abs).pipe(res);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
}

function startServer() {
  const server = createServer((req, res) => {
    serveRequest(req, res).catch(() => { res.writeHead(500); res.end('Internal Error'); });
  });
  let port = PORT_BASE;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < PORT_BASE + PORT_TRIES) {
      port += 1;
      server.listen(port, '127.0.0.1');
    } else {
      print(`伺服器啟動失敗：${err.message}`);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    print(`伺服器已啟動：${url}`);
    print('關閉此視窗即可停止。');
    exec(`start "" "${url}"`, { shell: 'cmd.exe' }, () => {});
  });
}

try {
  await ensureResources();
} catch (err) {
  print('');
  print(`錯誤：${err.message}`);
  print('請確認網路連線後重新執行 啟動.bat。');
  process.exit(1);
}
startServer();
```

- [ ] **Step 4: 建立 `啟動.bat`**

```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js，請先安裝 Node.js 後再執行本工具。
  pause
  exit /b 1
)
node server.js
if errorlevel 1 (
  echo.
  echo 啟動失敗，請查看上方的錯誤訊息。
  pause
)
```

- [ ] **Step 5: 驗證首次執行（下載 + 伺服）**

Run: `node server.js`
Expected: 依序印出「需要下載 6 個資源…」與每個檔的百分比進度，接著「資源下載完成。」、`伺服器已啟動：http://127.0.0.1:8123/`，並自動開啟瀏覽器。

在另一終端驗證（伺服器保持執行）：

```bash
curl -sI http://127.0.0.1:8123/ | head -1
curl -sI http://127.0.0.1:8123/models/PP-OCRv6_small_rec_onnx_infer.tar | head -3
curl -sI http://127.0.0.1:8123/vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm | head -3
```

Expected: 三個 curl 分別為 `HTTP/1.1 200 OK`、200 且 `Content-Type: application/octet-stream`、200 且 `Content-Type: application/wasm`。`models/` 與 `vendor/` 下出現 6 個檔案，大小符合 Global Constraints 表格。

- [ ] **Step 6: 驗證再次執行（秒開、不重下載）**

Run: `node server.js`
Expected: 只印「所有資源已就緒。」與伺服器啟動訊息，**不重新下載**。

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore server.js 啟動.bat
git commit -m "feat: 新增零依賴本地伺服器與首次下載機制"
```

---

### Task 2: match.js 純比對邏輯（TDD）

**Files:**
- Create: `match.js`
- Create: `tests/match.test.js`
- Test: `tests/match.test.js`

**Interfaces:**
- Consumes: 無（純函式，無 DOM、無 SDK）。
- Produces（Task 3 的 `app.js` 依賴這些簽名）：
  - `normalise(value: string, mode: 'exact'|'loose'|'fuzzy'): string`
  - `compactIndex(text: string): { text: string; map: number[] }`
  - `levenshteinDistance(a: string[], b: string[]): number`
  - `fuzzyErrorsFor(queryLen: number): number`
  - `findInLine(line: string, query: string, mode: string): Array<{ start: number; end: number; text: string; distance: number }>`（`start`/`end` 為原文字元的 code-point 偏移）
  - `matchItems(items: Array<{ poly: Array<[number, number]>; text: string; score: number }>, query: string, mode: string, scoreThresh: number): Array<{ item; start; end; text; distance; total; full }>`
  - `polyToBbox(poly: Array<[number, number]>): { x0; y0; x1; y1 }`
  - `slicePolyBox(poly: Array<[number, number]>, start: number, end: number, total: number): { x0; y0; x1; y1 }`
  - `matchBbox(match): { x0; y0; x1; y1 }`
  - `overlap(a: { x0; y0; x1; y1 }, b: { x0; y0; x1; y1 }): number`
  - `uniqueMatches(matches): matches`（同 `item.text` 且 `overlap > 0.45` 的去重）

**規則（實作基準）**：
- `exact`：`value.trim()`。
- `loose`（忽略大小寫與空白）：移除**所有空白字元**（含全形空白 U+3000，JS `\s` 涵蓋）並 `toLocaleLowerCase()`；**不移除標點**。
- `fuzzy`：同 `loose` 的字元層級，但比對時允許 `fuzzyErrorsFor(queryLen) = min(2, max(1, floor(queryLen/4)))` 個 Levenshtein 編輯距離。
- 所有字元索引以 **code point** 為單位（用 `[...str]`，因字典含 BMP 外字元）。
- `poly` 為 4 點陣列 `[p0, p1, p2, p3]`，`p0→p1` 為頂邊、`p3→p2` 為底邊（PaddleX 慣例）；`Point2D = [number, number]`。
- 垂直文字判定：`height > width * 1.45`（`width = |p0 p1|`、`height = |p0 p3|`）。

- [ ] **Step 1: 先建立測試骨架**

Create: `tests/match.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise,
  compactIndex,
  levenshteinDistance,
  fuzzyErrorsFor,
  findInLine,
  matchItems,
  polyToBbox,
  slicePolyBox,
  matchBbox,
  overlap,
  uniqueMatches
} from '../match.js';

const LINE = '訂單編號 2026';
const LINE_POLY = [[0, 0], [180, 0], [180, 40], [0, 40]];

function fakeItem(text, score, poly = LINE_POLY) {
  return { poly, text, score };
}

// ---- normalise ----
test('normalise exact 只做 trim', () => {
  assert.equal(normalise('  王小明  ', 'exact'), '王小明');
  assert.equal(normalise('ABC DEF', 'exact'), 'ABC DEF');
});

test('normalise loose 移除空白並轉小寫、保留標點', () => {
  assert.equal(normalise('王 小明', 'loose'), '王小明');
  assert.equal(normalise('A B, C。', 'loose'), 'ab,c。');
  assert.equal(normalise('Ａ\u3000Ｂ', 'loose'), 'ａｂ'); // 全形空白
});

test('normalise fuzzy 同 loose', () => {
  assert.equal(normalise('王 小明', 'fuzzy'), '王小明');
});

// ---- compactIndex ----
test('compactIndex 回傳壓縮字串與原始偏移', () => {
  const r = compactIndex('王 小明');
  assert.equal(r.text, '王小明');
  assert.deepEqual(r.map, [0, 2, 3]);
});

test('compactIndex 全形空白也算空白', () => {
  const r = compactIndex('a\u3000b');
  assert.equal(r.text, 'ab');
  assert.deepEqual(r.map, [0, 2]);
});

// ---- levenshteinDistance ----
test('levenshteinDistance 已知值', () => {
  assert.equal(levenshteinDistance([...'kitten'], [...'sitting']), 3);
  assert.equal(levenshteinDistance([...'abc'], [...'abc']), 0);
  assert.equal(levenshteinDistance([...''], [...'abc']), 3);
  assert.equal(levenshteinDistance([...'abc'], [...'']), 3);
});

// ---- fuzzyErrorsFor ----
test('fuzzyErrorsFor 上限 2、下限 1', () => {
  assert.equal(fuzzyErrorsFor(1), 1);
  assert.equal(fuzzyErrorsFor(3), 1);
  assert.equal(fuzzyErrorsFor(4), 1);
  assert.equal(fuzzyErrorsFor(5), 1);
  assert.equal(fuzzyErrorsFor(6), 1);
  assert.equal(fuzzyErrorsFor(8), 2);
  assert.equal(fuzzyErrorsFor(20), 2);
});

// ---- findInLine ----
test('findInLine exact 命中子字串', () => {
  const hits = findInLine('今天天氣很好', '天氣', 'exact');
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], { start: 2, end: 4, text: '天氣', distance: 0 });
});

test('findInLine exact 找不到回傳空陣列', () => {
  assert.deepEqual(findInLine('今天天氣很好', '下雨', 'exact'), []);
});

test('findInLine loose 忽略大小寫', () => {
  const hits = findInLine('AbC def', 'abc', 'loose');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].start, 0);
  assert.equal(hits[0].end, 3);
});

test('findInLine loose 忽略行內空白且偏移正確', () => {
  const hits = findInLine('王 小明 你好', '王小明', 'loose');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].start, 0);
  assert.equal(hits[0].end, 4);
  assert.equal(hits[0].text, '王 小明');
});

test('findInLine exact 回報多個命中', () => {
  const hits = findInLine('AABAB', 'AB', 'exact');
  assert.deepEqual(hits.map(h => [h.start, h.end]), [[1, 3], [3, 5]]);
});

test('findInLine fuzzy 允許一字誤配', () => {
  const hits = findInLine('訂單編號 2026', '訂單編號 2027', 'fuzzy');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].distance, 1);
});

test('findInLine loose 不容許字元誤配', () => {
  assert.deepEqual(findInLine('訂單編號 2027', '訂單編號 2026', 'loose'), []);
});

// ---- matchItems ----
test('matchItems 過濾低信心度', () => {
  const items = [
    fakeItem('訂單編號 2026', 0.9),
    fakeItem('王小明', 0.2)
  ];
  const matches = matchItems(items, '訂單編號', 'exact', 0.5);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].item.text, '訂單編號 2026');
  assert.equal(matches[0].start, 0);
  assert.equal(matches[0].end, 4);
  assert.equal(matches[0].total, 9);
});

test('matchItems 行長不足直接跳過', () => {
  const matches = matchItems([fakeItem('短', 0.9)], '長一點的字', 'exact', 0);
  assert.deepEqual(matches, []);
});

test('matchItems 模糊模式命中並帶 full 旗標', () => {
  const items = [fakeItem('訂單編號 2026', 0.9)];
  const matches = matchItems(items, '訂單編號 2026', 'fuzzy', 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].full, true);
});

// ---- polyToBbox / slicePolyBox / matchBbox ----
test('polyToBbox 取四點極值', () => {
  assert.deepEqual(polyToBbox([[0, 0], [10, 0], [10, 20], [0, 20]]), { x0: 0, y0: 0, x1: 10, y1: 20 });
});

test('slicePolyBox 水平子字串依比例內插', () => {
  const box = slicePolyBox([[0, 0], [20, 0], [20, 10], [0, 10]], 0, 2, 4);
  assert.deepEqual(box, { x0: 0, y0: 0, x1: 10, y1: 10 });
});

test('slicePolyBox 垂直文字沿長邊內插', () => {
  const box = slicePolyBox([[0, 0], [10, 0], [10, 40], [0, 40]], 0, 2, 4);
  assert.deepEqual(box, { x0: 0, y0: 0, x1: 10, y1: 20 });
});

test('matchBbox 整行命中用整 poly、子字串用內插', () => {
  const full = { item: fakeItem(LINE, 0.9), start: 0, end: 9, total: 9, full: true };
  const part = { item: fakeItem(LINE, 0.9), start: 2, end: 4, total: 9, full: false };
  assert.deepEqual(matchBbox(full), { x0: 0, y0: 0, x1: 180, y1: 40 });
  const b = matchBbox(part);
  assert.ok(b.x0 > 20 && b.x1 < 100 && b.y0 === 0 && b.y1 === 40);
});

// ---- overlap / uniqueMatches ----
test('overlap 相同框為 1、不相交為 0', () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
  assert.equal(overlap(a, a), 1);
  assert.equal(overlap(a, { x0: 20, y0: 0, x1: 30, y1: 10 }), 0);
});

test('uniqueMatches 去除同文字且重疊 >0.45 的重複', () => {
  const m1 = { item: fakeItem(LINE, 0.9), start: 0, end: 9, total: 9, text: LINE, full: true };
  const m2 = { item: fakeItem(LINE, 0.8), start: 1, end: 9, total: 9, text: '單編號 2026', full: false };
  const m3 = { item: fakeItem('王小明', 0.9), start: 0, end: 3, total: 3, text: '王小明', full: true };
  const out = uniqueMatches([m1, m2, m3]);
  assert.equal(out.length, 2);
  assert.equal(out[0].item.text, '訂單編號 2026');
  assert.equal(out[1].item.text, '王小明');
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test tests/match.test.js`
Expected: 失敗（`ERR_MODULE_NOT_FOUND` 或 `cannot find module '../match.js'`）。

- [ ] **Step 3: 建立 `match.js`（完整實作）**

```js
export function toCodePoints(str) {
  return [...str];
}

export function normalise(value, mode) {
  if (mode === 'exact') return value.trim();
  return compactIndex(value).text;
}

export function compactIndex(text) {
  const cps = toCodePoints(text);
  const chars = [];
  const map = [];
  cps.forEach((cp, index) => {
    if (/\s/u.test(cp)) return;
    chars.push(cp.toLocaleLowerCase());
    map.push(index);
  });
  return { text: chars.join(''), map };
}

export function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

export function fuzzyErrorsFor(queryLen) {
  return Math.min(2, Math.max(1, Math.floor(queryLen / 4)));
}

function exactMatches(lineCp, needle) {
  const results = [];
  if (needle.length === 0) return results;
  const trimmed = lineCp.join('').trim();
  const lead = lineCp.length - toCodePoints(lineCp.join('').trimStart()).length;
  const hay = toCodePoints(trimmed);
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) {
      if (hay[i + k] !== needle[k]) { ok = false; break; }
    }
    if (ok) {
      const start = lead + i;
      results.push({
        start,
        end: start + needle.length,
        text: lineCp.slice(start, start + needle.length).join(''),
        distance: 0
      });
    }
  }
  return results;
}

function fuzzyMatches(lineCp, cLine, queryCp, errors) {
  const hay = toCodePoints(cLine.text);
  const q = queryCp;
  const results = [];
  if (q.length === 0 || hay.length < q.length) return results;
  const lo = Math.max(1, q.length - errors);
  const hi = q.length + errors;
  const candidates = [];
  for (let i = 0; i <= hay.length - lo; i++) {
    let bestDist = Infinity;
    let bestLen = lo;
    const upper = Math.min(hi, hay.length - i);
    for (let w = lo; w <= upper; w++) {
      const d = levenshteinDistance(hay.slice(i, i + w), q);
      if (d < bestDist) { bestDist = d; bestLen = w; }
    }
    if (bestDist <= errors) candidates.push({ i, w: bestLen, d: bestDist });
  }
  candidates.sort((a, b) => a.d - b.d || a.i - b.i);
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.i < lastEnd) continue;
    const start = cLine.map[c.i];
    const end = cLine.map[c.i + c.w - 1] + 1;
    results.push({ start, end, text: lineCp.slice(start, end).join(''), distance: c.d });
    lastEnd = c.i + c.w;
  }
  return results;
}

export function findInLine(line, query, mode) {
  const lineCp = toCodePoints(line);
  if (mode === 'exact') {
    return exactMatches(lineCp, toCodePoints(query));
  }
  const cLine = compactIndex(line);
  const q = toCodePoints(compactIndex(query).text);
  const errors = mode === 'fuzzy' ? fuzzyErrorsFor(q.length) : 0;
  return fuzzyMatches(lineCp, cLine, q, errors);
}

export function matchItems(items, query, mode, scoreThresh) {
  const results = [];
  for (const item of items) {
    if (item.score < scoreThresh) continue;
    const total = toCodePoints(item.text).length;
    const queryLen = toCodePoints(mode === 'exact' ? query : compactIndex(query).text).length;
    if (total < queryLen) continue;
    for (const hit of findInLine(item.text, query, mode)) {
      results.push({
        item,
        start: hit.start,
        end: hit.end,
        text: hit.text,
        distance: hit.distance,
        total,
        full: hit.start === 0 && hit.end === total
      });
    }
  }
  return results;
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function polyToBbox(poly) {
  const xs = poly.map(p => p[0]);
  const ys = poly.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function slicePolyBox(poly, start, end, total) {
  const [p0, p1, p2, p3] = poly;
  const width = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const height = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const t0 = start / total;
  const t1 = end / total;
  const pts = height > width * 1.45
    ? [lerp(p0, p3, t0), lerp(p0, p3, t1), lerp(p1, p2, t1), lerp(p1, p2, t0)]
    : [lerp(p0, p1, t0), lerp(p0, p1, t1), lerp(p3, p2, t1), lerp(p3, p2, t0)];
  return polyToBbox(pts);
}

export function matchBbox(match) {
  return match.full
    ? polyToBbox(match.item.poly)
    : slicePolyBox(match.item.poly, match.start, match.end, match.total);
}

export function overlap(a, b) {
  const width = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const height = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = width * height;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  const minArea = Math.min(areaA, areaB);
  return minArea <= 0 ? 0 : inter / minArea;
}

export function uniqueMatches(matches) {
  const withBox = matches.map(m => ({ m, bbox: matchBbox(m) }));
  return withBox
    .filter((entry, index) =>
      !withBox.slice(0, index).some(prev =>
        entry.m.item.text === prev.m.item.text && overlap(entry.bbox, prev.bbox) > 0.45))
    .map(entry => entry.m);
}
```

- [ ] **Step 4: 跑測試確認全數通過**

Run: `node --test tests/match.test.js`
Expected: 所有 `test` 都 PASS（`pass 23`、`fail 0`）。

- [ ] **Step 5: Commit**

```bash
git add match.js tests/match.test.js
git commit -m "feat: 新增純比對邏輯模組與單元測試"
```

---

### Task 3: 前端整合（index.html + app.js + opencv shim）

**Files:**
- Create: `vendor/opencv-shim.mjs`
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `match.js` 的 `matchItems`、`matchBbox`、`uniqueMatches`（見 Task 2）；`server.js` 提供的 `/models/*.tar`、`/vendor/*`。
- Produces: `http://127.0.0.1:8123/` 下可運作的完整網頁工具。

**行為基準（沿用現行 UI 語意）**：拖放/點擊上傳、輸入目標、`辨識並標記`、結果列表（點擊定位）、`下載標記後圖片`、狀態列、命中計數。新增「比對模式」下拉與「信心度門檻」滑桿；保留「擴大搜尋」勾選框。

- [ ] **Step 1: 建立 `vendor/opencv-shim.mjs`**

```js
const cvPromise = new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = '/vendor/opencv-js/opencv.js';
  script.onload = () => {
    const check = () => {
      if (typeof globalThis.cv !== 'undefined' && typeof globalThis.cv.Mat === 'function') {
        resolve(globalThis.cv);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  };
  script.onerror = () => reject(new Error('opencv.js 載入失敗'));
  document.head.appendChild(script);
});

export default cvPromise;
```

- [ ] **Step 2: 更新 `index.html`**

以完整新內容覆寫（import map 放在任何 module script 之前；移除 Tesseract CDN）：

```html
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>文字雷達｜圖片文字辨識</title>
  <link rel="stylesheet" href="style.css" />
  <script type="importmap">
  {
    "imports": {
      "@paddleocr/paddleocr-js": "/vendor/sdk/dist/index.mjs",
      "@techstark/opencv-js": "/vendor/opencv-shim.mjs",
      "onnxruntime-web": "/vendor/onnxruntime-web/dist/ort.min.mjs"
    }
  }
  </script>
</head>
<body>
  <main class="app-shell">
    <header>
      <div class="brand-mark">⌕</div>
      <div><p class="eyebrow">VISUAL TEXT FINDER</p><h1>文字雷達</h1></div>
      <p class="tagline">在圖片的每個字裡，找到你要的那一句。</p>
    </header>

    <section class="controls" aria-label="搜尋設定">
      <label class="target-label">想找的文字
        <input id="targetText" type="search" placeholder="例如：訂單編號、王小明、2026" autocomplete="off" />
      </label>
      <label class="option">比對模式
        <select id="matchMode">
          <option value="exact">精確</option>
          <option value="loose">忽略大小寫與空白</option>
          <option value="fuzzy">模糊容錯（允許 1–2 字差異）</option>
        </select>
      </label>
      <label class="option"><input id="verified" type="checkbox" /> 擴大搜尋（可能增加誤框）</label>
      <label class="option">信心度門檻 <span id="threshValue">0.6</span>
        <input id="scoreThresh" type="range" min="0" max="1" step="0.05" value="0.6" />
      </label>
      <button id="findButton" class="primary" disabled>辨識並標記</button>
    </section>

    <section id="dropZone" class="drop-zone" tabindex="0" role="button" aria-label="上傳圖片">
      <input id="imageInput" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden />
      <div class="upload-icon">↑</div>
      <strong>拖放圖片到這裡</strong>
      <span>或點擊選擇 PNG、JPG、WEBP、BMP 圖片</span>
    </section>

    <section id="workspace" class="workspace hidden">
      <div class="image-panel">
        <div class="panel-head"><h2>辨識畫面</h2><span id="imageInfo"></span></div>
        <div class="canvas-wrap"><canvas id="resultCanvas"></canvas></div>
      </div>
      <aside class="results-panel">
        <div class="panel-head"><h2>搜尋結果</h2><span id="countBadge" class="count">尚未辨識</span></div>
        <div id="status" class="status">輸入想找的文字，然後開始辨識。</div>
        <ol id="resultList" class="result-list"></ol>
        <button id="downloadButton" class="secondary hidden">下載標記後圖片</button>
      </aside>
    </section>
  </main>
  <footer>所有辨識均在你的瀏覽器內處理；圖片不會上傳到伺服器。</footer>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: 以新內容覆寫 `app.js`**

```js
import { PaddleOCR } from '@paddleocr/paddleocr-js';
import { matchItems, matchBbox, uniqueMatches } from './match.js';

const input = document.querySelector('#imageInput');
const dropZone = document.querySelector('#dropZone');
const findButton = document.querySelector('#findButton');
const targetText = document.querySelector('#targetText');
const matchMode = document.querySelector('#matchMode');
const verified = document.querySelector('#verified');
const scoreThresh = document.querySelector('#scoreThresh');
const threshValue = document.querySelector('#threshValue');
const workspace = document.querySelector('#workspace');
const canvas = document.querySelector('#resultCanvas');
const ctx = canvas.getContext('2d');
const status = document.querySelector('#status');
const resultList = document.querySelector('#resultList');
const countBadge = document.querySelector('#countBadge');
const downloadButton = document.querySelector('#downloadButton');

let image = null;
let imageFile = null;
let ocr = null;
let originalFileName = 'marked-image';
let latestMatches = [];
let lastBatch = null;

const PREDICT_PARAMS = {
  textDetThresh: 0.3,
  textDetBoxThresh: 0.6,
  textDetUnclipRatio: 1.5
};

function setStatus(message) { status.textContent = message; }

function draw(matches = []) {
  if (!image) return;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);
  const scale = Math.max(2, canvas.width / 800);
  ctx.lineWidth = scale * 2.2;
  matches.forEach(m => {
    const { x0, y0, x1, y1 } = matchBbox(m);
    const padding = Math.max(scale * 5, Math.min(x1 - x0, y1 - y0) * .18);
    const left = Math.max(0, x0 - padding);
    const top = Math.max(0, y0 - padding);
    const right = Math.min(canvas.width, x1 + padding);
    const bottom = Math.min(canvas.height, y1 + padding);
    ctx.strokeStyle = '#e9562d';
    ctx.strokeRect(left, top, right - left, bottom - top);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showMatches(matches) {
  latestMatches = matches;
  draw(matches);
  resultList.innerHTML = '';
  countBadge.textContent = `${matches.length} 筆結果`;
  if (!matches.length) {
    setStatus('找不到相符文字。可切換「模糊容錯」、調低信心度門檻，或改用更清晰的圖片。');
    downloadButton.classList.add('hidden');
    return;
  }
  setStatus(`已在圖片中標記 ${matches.length} 個相符位置。點擊結果可在圖上定位。`);
  downloadButton.classList.remove('hidden');
  matches.forEach((match, index) => {
    const li = document.createElement('li');
    const pct = Math.round(match.item.score * 100);
    li.innerHTML = `<span class="match-text">${index + 1}. ${escapeHtml(match.text)}</span><span class="meta">信心度 ${pct}%</span>`;
    li.onclick = () => {
      draw([match]);
      canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => draw(latestMatches), 1300);
    };
    resultList.appendChild(li);
  });
}

function recompute() {
  if (!lastBatch) return;
  const thresh = parseFloat(scoreThresh.value);
  const mode = matchMode.value;
  const matches = uniqueMatches(matchItems(lastBatch.items, lastBatch.query, mode, thresh));
  showMatches(matches);
}

function upscale(source, scale) {
  const processed = document.createElement('canvas');
  processed.width = source.naturalWidth * scale;
  processed.height = source.naturalHeight * scale;
  const processedCtx = processed.getContext('2d');
  processedCtx.imageSmoothingEnabled = true;
  processedCtx.imageSmoothingQuality = 'high';
  processedCtx.drawImage(source, 0, 0, processed.width, processed.height);
  return processed;
}

async function ensureOcr() {
  if (ocr) return ocr;
  setStatus('正在初始化辨識引擎（首次較慢，請稍候）…');
  ocr = await PaddleOCR.create({
    textDetectionModelName: 'PP-OCRv6_small_det',
    textDetectionModelAsset: { url: '/models/PP-OCRv6_small_det_onnx_infer.tar' },
    textRecognitionModelName: 'PP-OCRv6_small_rec',
    textRecognitionModelAsset: { url: '/models/PP-OCRv6_small_rec_onnx_infer.tar' },
    ortOptions: {
      backend: 'wasm',
      wasmPaths: '/vendor/onnxruntime-web/dist/',
      numThreads: 1,
      simd: true
    }
  });
  setStatus('辨識引擎已就緒。');
  return ocr;
}

async function predictAll(engine, source) {
  const result = (await engine.predict(source, {
    ...PREDICT_PARAMS,
    textRecScoreThresh: 0
  }))[0];
  return result ? result.items : [];
}

async function recognise() {
  const query = targetText.value;
  if (!image || !query) { setStatus('請先上傳圖片並輸入要尋找的文字。'); return; }
  findButton.disabled = true;
  resultList.innerHTML = '';
  countBadge.textContent = '辨識中';
  try {
    const engine = await ensureOcr();
    setStatus('正在辨識圖片文字…');
    let items = await predictAll(engine, imageFile);
    if (verified.checked) {
      setStatus('正在以放大模式補找較小文字…');
      const up = upscale(image, 2);
      const extra = await predictAll(engine, up);
      items = items.concat(extra.map(it => ({
        ...it,
        poly: it.poly.map(([x, y]) => [x / 2, y / 2])
      })));
    }
    lastBatch = { items, query };
    recompute();
  } catch (error) {
    console.error(error);
    setStatus(`辨識失敗：${error.message}。若為資源問題，請關閉視窗後重新執行 啟動.bat。`);
    countBadge.textContent = '發生錯誤';
  } finally {
    findButton.disabled = false;
  }
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { setStatus('請選擇圖片檔案。'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    image = new Image();
    image.onload = () => {
      originalFileName = file.name.replace(/\.[^.]+$/, '') || originalFileName;
      imageFile = file;
      workspace.classList.remove('hidden');
      findButton.disabled = false;
      document.querySelector('#imageInfo').textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
      latestMatches = [];
      lastBatch = null;
      resultList.innerHTML = '';
      countBadge.textContent = '尚未辨識';
      downloadButton.classList.add('hidden');
      setStatus('圖片已載入。輸入想找的文字後開始辨識。');
      draw();
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

dropZone.onclick = () => input.click();
input.onchange = e => loadFile(e.target.files[0]);
['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
dropZone.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') input.click(); };
findButton.onclick = recognise;
targetText.addEventListener('keydown', e => { if (e.key === 'Enter') recognise(); });
matchMode.addEventListener('change', recompute);
scoreThresh.addEventListener('input', () => {
  threshValue.textContent = parseFloat(scoreThresh.value).toFixed(2);
  recompute();
});
downloadButton.onclick = () => {
  const a = document.createElement('a');
  a.download = `${originalFileName}-已標記.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
};
```

- [ ] **Step 4: 在 `style.css` 新增滑桿與下拉樣式（追加到檔尾）**

```css
.option select {
  margin-left: 6px;
}
.option input[type="range"] {
  margin-left: 6px;
  vertical-align: middle;
  width: 180px;
}
```

- [ ] **Step 5: 手動驗證（伺服器已由 Task 1 啟動）**

開啟 `http://127.0.0.1:8123/`（若已開，重新整理）：

1. 上傳一張含文字的圖片，輸入目標字串，點「辨識並標記」。
   Expected: 狀態列由「正在初始化辨識引擎（首次較慢…）」→「辨識引擎已就緒。」→「正在辨識圖片文字…」→「已在圖片中標記 N 個相符位置。」；圖片上出現 `#e9562d` 框線；右側列出結果與信心度百分比。
2. 開啟 DevTools → Network，篩選 `URL: paddle-model-ecology OR jsdelivr OR cdn`。
   Expected: **沒有任何外部網域請求**（全部請求都指向 `127.0.0.1:8123`）。
3. 切換「比對模式」與拖動「信心度門檻」滑桿。
   Expected: 不重新辨識、即時更新框線與結果（信心度低於門檻的行被過濾）。
4. 勾選「擴大搜尋」再辨識一次。
   Expected: 較小的文字也可能被找到（結果可能變多）。
5. 點結果列表項目。
   Expected: 該框單獨顯示約 1.3 秒後恢復全部框線。
6. 點「下載標記後圖片」。
   Expected: 下載「<檔名>-已標記.png」。

- [ ] **Step 6: Commit**

```bash
git add vendor/opencv-shim.mjs index.html app.js style.css
git commit -m "feat: 前端改為 PaddleOCR 引擎與新比對介面"
```

---

### Task 4: 測試圖、README 更新與回歸驗證

**Files:**
- Create: `test-images/生成測試圖.ps1`
- Modify: `README.md`

**Interfaces:**
- Consumes: 已完成的完整工具。
- Produces: 可重現的人工測試圖與手動驗證清單，供使用者確認改善幅度。

- [ ] **Step 1: 建立測試圖產生腳本**

Create: `test-images/生成測試圖.ps1`

```powershell
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '樣本.png'
$bmp = New-Object System.Drawing.Bitmap(900, 420)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Microsoft JhengHei', 30)
$fontSmall = New-Object System.Drawing.Font('Microsoft JhengHei', 18)
$brush = [System.Drawing.Brushes]::Black
$g.DrawString('訂單編號：ABC-2026', $font, $brush, 30, 30)
$g.DrawString('臺灣銀行 台北分行', $font, $brush, 30, 100)
$g.DrawString('王小明 你好，很高興認識你', $font, $brush, 30, 170)
$g.DrawString('2024 年 12 月 31 日', $font, $brush, 30, 240)
$g.DrawString('大小太犬 分辨測試', $fontSmall, $brush, 30, 330)
$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "已產生 $out"
```

Run: `powershell -ExecutionPolicy Bypass -File test-images/生成測試圖.ps1`
Expected: 印出「已產生 …樣本.png」，`test-images/樣本.png` 存在。

- [ ] **Step 2: 以測試圖跑回歸清單**

載入 `樣本.png` 並逐項驗證：

| # | 操作 | 預期 |
|---|---|---|
| 1 | 精確模式找「訂單編號」 | 命中 1 處（框住「訂單編號」，不含「：」） |
| 2 | 精確模式找「訂單編號 2026」 | 命中 1 處，含空格，整行框線 |
| 3 | 精確模式找「大小太犬 分辨測試」 | 命中 1 處（小字行） |
| 4 | 精確模式找「臺灣銀行」 | 命中 1 處（驗證繁中辨識） |
| 5 | 「忽略大小寫與空白」找「abc-2026」 | 命中「ABC-2026」 |
| 6 | 「忽略大小寫與空白」找「台北 分行」 | 命中「台北分行」（全形空格被忽略，驗證不刪標點） |
| 7 | 「模糊容錯」找「大小太犬」 | 命中該行；若 OCR 誤判相似字仍可命中 |
| 8 | 信心度門檻拉到 0.95 | 低信心行消失；拉回 0.0 全部回來 |
| 9 | 精確找「不存在文字」 | 「找不到相符文字。」+ 0 筆結果 |
| 10 | 勾「擴大搜尋」找「2024」 | 至少命中「2024」 |

- [ ] **Step 3: 更新 `README.md`**

```markdown
# 文字雷達

上傳含有文字的圖片，輸入欲尋找的文字後，工具會用瀏覽器內的 OCR 找到相符位置並以框線標記。

## 使用方式

1. 首次使用請先確認已安裝 [Node.js](https://nodejs.org/)（本工具使用 Node 24 測試）。
2. 雙擊 `啟動.bat`。第一次會自動下載辨識模型與執行環境（約 50MB，需連網並顯示進度）；之後完全離線、秒開。
3. 瀏覽器會自動開啟本機頁面。上傳圖片、輸入想找的文字（單字、姓名、數字、短句皆可），點「辨識並標記」。

## 比對模式

- **精確**：完全相符才標記。
- **忽略大小寫與空白**：無視大小寫與空白（含全形空格），但保留標點。
- **模糊容錯**：允許 1–2 個字元的辨識誤差，減少漏框；可能增加誤框。

「信心度門檻」可過濾低品質辨識結果（調高更精準、調低找回更多）。勾選「擴大搜尋」會以放大圖再辨識一次以補找較小文字。

## 離線與隱私

辨識引擎、模型與所有資源皆在本機（`models/` 與 `vendor/`）；圖片只在你的瀏覽器內處理，不會上傳任何伺服器。執行期間不會連到外部網站。

## 進階

- 刪除 `models/` 與 `vendor/` 後重跑 `啟動.bat` 會重新下載。
- 測試圖可執行 `test-images/生成測試圖.ps1` 產生。
```

- [ ] **Step 4: 驗證離線行為（斷網情境模擬）**

1. 刪除 `models/`。
2. 跑 `node server.js`。
   Expected: 嘗試下載並在失敗時印出「錯誤：…」「請確認網路連線後重新執行 啟動.bat。」，以非零代碼結束（`echo $?` 為 1）。
3. 重新下載完整資源後，正常啟動並完成一次辨識。
4. 在 DevTools 停用快取並重新整理，Network 面板再次確認**零外部請求**。
   Expected: 全部請求皆為 `127.0.0.1:8123`。

- [ ] **Step 5: Commit**

```bash
git add test-images/生成測試圖.ps1 test-images/樣本.png README.md
git commit -m "docs: 更新 README 並新增測試圖與回歸清單"
```

---

## 附錄：已知實作風險與對策

- **onnxruntime 單執行緒 wasm 檔名**：實測 1.22.0 的 dist 只含 `ort-wasm-simd-threaded.wasm`；官方 demo 在同版本（非 crossOriginIsolated、`numThreads: 1`）下正常，因此照此組合即可。若執行期出現 wasm 404，改在 `ortOptions` 加 `simd: false`，或在 `vendor/onnxruntime-web/dist/` 補放對應 wasm。
- **import map 瀏覽器支援**：Chrome/Edge 89+、Firefox 108+、Safari 16.4+。本工具為本機工具，無需考慮舊瀏覽器。
- **`cvModule instanceof Promise`**：已實測 SDK 程式碼路徑支援 Promise default export；shim 回傳 Promise 可正常被 await。
- **opencv.js 以 `<script>` 載入會設定 `window.cv`**：已實測確認（UMD 的 `root.cv = factory()` 分支）。
