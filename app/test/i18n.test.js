'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, Client } = require('./helpers');
const i18n = require('../i18n');

// ---- the dictionaries stay in step ----

function flatten(o, prefix, out) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix + k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key + '.', out); else out[key] = v;
  }
  return out;
}
const placeholders = (v) => (typeof v === 'string' ? (v.match(/\{\w+\}/g) || []).sort().join(',') : '');

test('English has exactly the keys of the Romanian master dictionary, with the same {placeholders}', () => {
  const ro = flatten(i18n.raw.ro, '', {});
  const en = flatten(i18n.raw.en, '', {});
  const missing = Object.keys(ro).filter((k) => !(k in en));
  const extra = Object.keys(en).filter((k) => !(k in ro));
  assert.deepEqual(missing, [], 'keys missing in English');
  assert.deepEqual(extra, [], 'English keys that Romanian does not have');
  for (const k of Object.keys(ro)) {
    assert.equal(Array.isArray(en[k]), Array.isArray(ro[k]), `${k}: list vs text`);
    if (Array.isArray(ro[k])) assert.equal(en[k].length, ro[k].length, `${k}: same number of lines`);
    else {
      assert.equal(placeholders(en[k]), placeholders(ro[k]), `${k}: placeholders differ`);
      if (ro[k] !== '' && ro[k] !== '—') assert.notEqual(en[k], '', `${k}: empty English text`);
    }
  }
});

test('English texts are not left in Romanian (no Romanian diacritics in the English dictionary)', () => {
  const en = flatten(i18n.raw.en, '', {});
  const bad = Object.entries(en).filter(([, v]) => typeof v === 'string' && /[ăîșțâĂÎȘȚÂ]/.test(v)).map(([k]) => k);
  assert.deepEqual(bad, []);
});

test('the accessor follows the language of the running request and falls back to Romanian', () => {
  assert.equal(i18n.T.nav.home, 'Acasă');
  i18n.run('en', () => { assert.equal(i18n.T.nav.home, 'Home'); assert.equal(i18n.S.nav.home, 'Home'); assert.equal(i18n.opt('nav', 'home', 'x'), 'Home'); });
  i18n.run('xx', () => assert.equal(i18n.T.nav.home, 'Acasă'));
  assert.equal(i18n.S.nav.nope, undefined);
  assert.throws(() => i18n.T.nav.nope, /missing i18n key nav.nope/);
});

// ---- the application ----

let app, admin;
test.before(async () => { app = await startApp(); admin = await adminClient(app); });
test.after(async () => { await app.cleanup(); });

const switchTo = (c, lang, back) => c.postForm(back || '/', '/limba', { lang, back: back || '/' });

test('a user switches language from the header; it is stored on the account and follows them to the next login', async () => {
  const u = await makeUser(app, admin, 'ctc.en', 'personal', 'English CTC');
  const other = await makeUser(app, admin, 'ctc.ro', 'personal', 'Romanian CTC');
  let home = await u.get('/');
  assert.ok(home.text.includes('lang="ro"') && home.text.includes('Măsurătoare nouă'));
  assert.ok(home.text.includes('name="lang" value="en"'));
  const r = await switchTo(u, 'en', '/masuratori');
  assert.equal(r.status, 303);
  assert.equal(r.location, '/masuratori');
  assert.equal(app.db.value("SELECT language FROM users WHERE username = 'ctc.en'"), 'en');
  home = await u.get('/');
  assert.ok(home.text.includes('lang="en"') && home.text.includes('New measurement') && home.text.includes('Start the first measurement'));
  assert.ok(!/Măsurătoare nouă|Acasă/.test(home.text));
  // another user is not affected
  assert.ok((await other.get('/')).text.includes('Măsurătoare nouă'));
  // a fresh login (new browser) gets English again
  const again = new Client(app.base);
  assert.equal((await again.login('ctc.en', u.password)).status, 303);
  assert.ok((await again.get('/')).text.includes('New measurement'));
});

test('invalid language and hostile return addresses are ignored', async () => {
  const u = await makeUser(app, admin, 'ctc.x', 'personal', 'X');
  let r = await switchTo(u, 'xx');
  assert.equal(r.status, 303);
  assert.equal(app.db.value("SELECT language FROM users WHERE username = 'ctc.x'"), null);
  r = await u.postForm('/', '/limba', { lang: 'en', back: '//evil.example/' });
  assert.equal(r.location, '/');
  r = await u.postForm('/', '/limba', { lang: 'ro', back: 'https://evil.example/' });
  assert.equal(r.location, '/');
  // the change needs the session's form token
  const res = await fetch(`${app.base}/limba`, { method: 'POST', headers: { Cookie: u.cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'lang=en', redirect: 'manual' });
  assert.equal(res.status, 403);
});

test('the login page has the switch too (cookie only) and the choice reaches the login form', async () => {
  const c = new Client(app.base);
  let page = await c.get('/login');
  assert.ok(page.text.includes('Autentificare') && page.text.includes('name="lang" value="en"'));
  const r = await c.postForm('/login', '/limba/login', { lang: 'en', back: '/login' });
  assert.equal(r.status, 303);
  assert.equal(r.location, '/login');
  page = await c.get('/login');
  assert.ok(page.text.includes('lang="en"') && page.text.includes('Log in') && page.text.includes('User name'));
});

test('every main screen renders in English without a missing key or a leftover Romanian UI string', async () => {
  const eng = await makeUser(app, admin, 'eng.viewer', 'inginer', 'Eng Viewer');
  await switchTo(eng, 'en');
  await switchTo(admin, 'en');
  const screens = ['/', '/masuratori/nou', '/masuratori', '/fise', '/liste', '/liste/familii', '/liste/tinte', '/liste/iec', '/liste/utilaje', '/liste/materiale', '/admin/utilizatori', '/admin/setari', '/admin/jurnal', '/parola', '/loturi', '/analize/tendinta', '/analize/control'];
  const ro = /Măsurătoare|Înapoi|Salvează|Caută|Registru|Fișe tehnice|Date de bază|Utilizatori|Setări|Jurnal de audit|Renunță|Acasă|Ieșire/;
  for (const url of screens) {
    const c = ['/admin/utilizatori', '/admin/setari', '/admin/jurnal', '/loturi', '/analize/tendinta', '/analize/control'].includes(url) ? admin : eng;
    const r = await c.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(r.text.includes('lang="en"'), url);
    assert.ok(!r.text.includes('⟦'), `${url} has a missing key`);
    // pages that list stored product data (sheet titles, machine names ...) keep that data in Romanian: check their header and title only
    const dataPage = /^\/(fise|liste\/|loturi|analize)/.test(url);
    const shown = dataPage ? (/<header[\s\S]*?<\/header>/.exec(r.text)[0] + (/<h1[\s\S]*?<\/h1>/.exec(r.text) || [''])[0]) : r.text.replace(/<script[\s\S]*?<\/script>/g, '');
    assert.ok(!ro.test(shown), `${url} still shows Romanian UI text: ${(ro.exec(shown) || [])[0]}`);
  }
});
