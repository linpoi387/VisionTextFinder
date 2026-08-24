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
  },
  {
    file: 'vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs',
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.mjs',
    minBytes: 30000
  },
  {
    file: 'vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.wasm',
    minBytes: 15000000
  },
  {
    file: 'vendor/js-yaml/js-yaml.mjs',
    url: 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.mjs',
    minBytes: 90000
  },
  {
    file: 'vendor/clipper-lib/clipper.mjs',
    url: 'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/+esm',
    minBytes: 90000
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
        res.on('aborted', () => {
          out.destroy();
          reject(new Error(`下載中斷：${destRel}`));
        });
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
    const immutable = [join(ROOT, 'models'), join(ROOT, 'vendor', 'onnxruntime-web'), join(ROOT, 'vendor', 'opencv-js'), join(ROOT, 'vendor', 'sdk'), join(ROOT, 'vendor', 'js-yaml'), join(ROOT, 'vendor', 'clipper-lib')]
      .some(base => abs === base || abs.startsWith(base + '\\') || abs.startsWith(base + '/'));
    const cacheControl = immutable ? 'public, max-age=604800, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': s.size, 'Cache-Control': cacheControl });
    const stream = createReadStream(abs);
    stream.on('error', () => { try { res.writeHead(500); res.end('Internal Error'); } catch {} });
    res.on('error', () => {});
    stream.pipe(res);
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
