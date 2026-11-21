// alphaTab: WebAudio ignores the phone silent switch / can stay loud when the
// rocker is on a different stream. The app must expose mute + master volume.
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const boot = fs.readFileSync(path.join(root, 'boot.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failures = 0;
const check = (n, c, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (d !== undefined ? '  (' + JSON.stringify(d).slice(0, 200) + ')' : ''));
  if (!c) failures++;
};

check('player chrome has a Mute control', /id="mute"/.test(html) || /id='mute'/.test(html));
check('player chrome has a volume control', /id="volume"/.test(html) || /id='volume'/.test(html));
check('boot wires api.masterVolume for mute/volume', /masterVolume/.test(boot));
check('mute drives masterVolume to 0 (via muted flag or direct assign)',
  /masterVolume\s*=\s*0/.test(boot) || /muted\s*\?\s*0/.test(boot));
check('volume input writes masterVolume', /masterVolume\s*=/.test(boot) && /volume/.test(boot));

process.exit(failures ? 1 : 0);
