// Meeting Bot protocol: strength, KDF, and structured messages. The UI is exercised in the browser suite.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;
let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + extra : ''));
  if (!c) failures++;
};

const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
const listing = JSON.parse(fs.readFileSync(path.join(APP, 'listing.json'), 'utf8'));
const help = fs.readFileSync(path.join(APP, 'help.md'), 'utf8');
const app = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

check('manifest declares meet and remote', manifest.capabilities && manifest.capabilities.meet === true && manifest.capabilities.remote === true);
check('minBuild is the 0.9.23 build that ships Meet', manifest.minBuild === 2723);
check('no network capability', !manifest.capabilities.network && !manifest.capabilities.api);
check('launch keys for headless start', !!(manifest.launch && manifest.launch.mode && manifest.launch.name && manifest.launch.password));
check('listing names the app', listing.tagline && listing.categories && listing.categories.indexOf('Utilities') >= 0);
check('help covers both modes', /RUN/.test(help) && /CONTROL/.test(help) && help.length > 400);
check('app does not fetch or open a socket', !/\bfetch\s*\(/.test(app) && !/WebSocket/.test(app) && !/\beval\s*\(/.test(app));
check('page has the launch form and the control panel', /id="mode-run"/.test(html) && /id="mode-control"/.test(html) && /id="rules"/.test(html) && /id="ctrl"/.test(html));

const sandbox = {
  console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, RegExp, Promise, Uint8Array, TextEncoder,
  crypto, atob, btoa
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'protocol.js'), 'utf8'), sandbox, { filename: 'protocol.js' });
const P = sandbox.BotProto;
check('protocol loaded', !!(P && P.strength && P.derive && P.encode && P.decode));

const weak = P.strength('bot', 'bot');
check('bot/bot is rejected', weak.ok === false, weak.reason);
check('short password is rejected', P.strength('harbor-maple', 'short').ok === false);
check('name equal to password is rejected', P.strength('harbor-maple', 'harbor-maple').ok === false);
let suggestion = P.suggest();
let guard = 0;
while (!P.strength(suggestion.name, suggestion.password).ok && guard++ < 8) suggestion = P.suggest();
check('a generated suggestion passes', P.strength(suggestion.name, suggestion.password).ok === true, JSON.stringify(suggestion));

const plain = 'join https://gifos.app/run.html#v=abc';
check('free-text join is not a protocol message', P.decode(plain) === null && P.looksLikeCommand(plain));
const encoded = P.encode({ role: 'controller', op: 'list', id: 'q1' });
const decoded = P.decode(encoded);
check('structured list round-trips with an explicit role', decoded && decoded.role === 'controller' && decoded.op === 'list' && decoded.v === 1);
check('a message without a role is ignored', P.decode('gb1 {"v":1,"op":"list"}') === null);
check('duplicate warning text is fixed', P.DUP.indexOf('already running') > 0 && P.DUP.indexOf('pick something unique') > 0);

P.derive('harbor-maple', suggestion.password).then(function (a) {
  return P.derive('harbor-maple', suggestion.password).then(function (b) {
    return P.derive('harbor-maple', suggestion.password + 'x').then(function (c) {
      check('KDF room is stable and 32 hex chars', a.room === b.room && /^[a-f0-9]{32}$/.test(a.room), a.room);
      check('KDF password is stable and not the room', a.password === b.password && a.password !== a.room && /^[a-f0-9]{32}$/.test(a.password));
      check('a different password derives a different room', c.room !== a.room);
      console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
      process.exit(failures ? 1 : 0);
    });
  });
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
