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
let ran = 0;
for (const slug of apps) {
  const dir = path.join(root, slug);
  const suites = fs.readdirSync(dir).filter((name) => /^test(-[a-z0-9-]+)?\.js$/.test(name)).sort();
  if (!suites.length) { missing.push(slug); continue; }
  for (const name of suites) {
    ran++;
    process.stdout.write('\n===== ' + slug + '/' + name + ' =====\n');
    const r = spawnSync(process.execPath, [path.join(dir, name)], { stdio: 'inherit' });
    if (r.status) failed++;
  }
}
process.stdout.write('\n' + ran + ' suites, ' + missing.length + ' apps with no test.js\n');
for (const slug of missing) process.stdout.write('  no suite  ' + slug + '\n');
process.exit(failed ? 1 : 0);
