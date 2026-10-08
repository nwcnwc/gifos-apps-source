// Run every app suite in this repository. An app with no test.js is listed
// and does not fail the run. A suite that exits non-zero does.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const apps = fs.readdirSync(root).filter((name) => {
  if (name.startsWith('.')) return false;
  return fs.existsSync(path.join(root, name, 'listing.json'));
}).sort();

let failed = 0;
const missing = [];
for (const slug of apps) {
  const suite = path.join(root, slug, 'test.js');
  if (!fs.existsSync(suite)) { missing.push(slug); continue; }
  process.stdout.write('\n===== ' + slug + ' =====\n');
  const r = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  if (r.status) failed++;
}
process.stdout.write('\n' + (apps.length - missing.length) + ' suites, ' + missing.length + ' apps with no test.js\n');
for (const slug of missing) process.stdout.write('  no suite  ' + slug + '\n');
process.exit(failed ? 1 : 0);
