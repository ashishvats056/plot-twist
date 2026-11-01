// Copies the shared pure modules for the isolated-world bridge.
// Chrome injects a file listed in two content_scripts entries only into the
// first world, so the bridge (isolated) and inject.js (MAIN) can't share files.
// Usage: node dev/tools/build-isolated.js [--check]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const SHARED = ['actions.js', 'channel.js'];
const check = process.argv.includes('--check');
// Git on Windows may check files out with CRLF line endings
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let stale = false;
for (const name of SHARED) {
  const src = read(path.join(root, 'src', name));
  const out = `// GENERATED from src/${name} by dev/tools/build-isolated.js. Do not edit.\n${src}`;
  const dest = path.join(root, 'src', 'isolated', name);
  const current = fs.existsSync(dest) ? read(dest) : null;
  if (current === out) continue;
  stale = true;
  if (!check) fs.writeFileSync(dest, out);
}
if (check && stale) {
  console.error('src/isolated/ is stale: run node dev/tools/build-isolated.js');
  process.exit(1);
}
