const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');

test('src/isolated/ copies match their sources', () => {
  execFileSync(process.execPath, [path.join(root, 'dev/tools/build-isolated.js'), '--check']);
});

test('no file is listed in both the isolated and MAIN content scripts', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const seen = new Set();
  for (const cs of m.content_scripts) {
    for (const f of cs.js) {
      assert.ok(!seen.has(f), `${f} would only be injected into one world`);
      seen.add(f);
    }
  }
});
