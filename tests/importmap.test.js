import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);

function bareSpecifiersFromSource(source) {
  const bare = new Set();
  const staticRe = /(?:^|\s)from\s*["']([^"'.][^"']*)["']/g;
  const dynamicRe = /import\s*\(\s*["']([^"'.][^"']*)["']\s*\)/g;
  for (const re of [staticRe, dynamicRe]) {
    let m;
    while ((m = re.exec(source)) !== null) bare.add(m[1]);
  }
  return [...bare];
}

function importMapKeys(html) {
  const script = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(script, 'index.html 應有 import map');
  const map = JSON.parse(script[1]);
  return Object.keys(map.imports);
}

test('import map 涵蓋 SDK 的所有裸模組 specifier', () => {
  const sdk = readFileSync(new URL('vendor/sdk/dist/index.mjs', ROOT), 'utf8');
  const html = readFileSync(new URL('index.html', ROOT), 'utf8');
  const bare = bareSpecifiersFromSource(sdk);
  assert.ok(bare.length >= 1, 'SDK 至少有一個裸模組 import');
  const keys = importMapKeys(html);
  for (const specifier of bare) {
    assert.ok(keys.includes(specifier), `import map 缺少裸模組：${specifier}`);
  }
});
