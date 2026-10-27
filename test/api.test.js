// Tests de l'API sur un Postgres embarqué en mémoire (PGlite).
process.env.PGLITE_DIR = 'memory://';
process.env.APP_PASSWORD = 'mot-de-passe-test';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;
delete process.env.CRM_LOCAL_DEV;

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { handler } = require('../lib/router');
const { resetDb } = require('../lib/db');
const repo = require('../lib/prospects');
const C = require('../public/src/logic.js');

let server;
let base;
let cookie = '';

async function call(method, path, body, opts) {
  const headers = Object.assign({}, cookie ? { cookie } : {}, (opts && opts.headers) || {});
  if (body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  const res = await fetch(base + '/api/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json(), setCookie };
}

test.before(async () => {
  server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  server.close();
  await resetDb();
});

test('accès refusé sans session, connexion par mot de passe', async () => {
  assert.strictEqual((await call('GET', 'bootstrap')).status, 401);
  assert.deepStrictEqual((await call('GET', 'session')).data, { authenticated: false, configured: true, authDisabled: false });
  assert.strictEqual((await call('POST', 'login', { password: 'faux' })).status, 401);
  const ok = await call('POST', 'login', { password: 'mot-de-passe-test' });
  assert.strictEqual(ok.status, 200);
  assert.match(ok.setCookie, /ntt_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
  cookie = ok.setCookie.split(';')[0];
  assert.strictEqual((await call('GET', 'session')).data.authenticated, true);
  // Forme réécrite par Vercel : /api?path=…
  const res = await fetch(base + '/api?path=bootstrap', { headers: { cookie } });
  assert.strictEqual(res.status, 200);
});

test('écriture refusée sans Content-Type JSON (CSRF)', async () => {
  const r = await call('POST', 'prospects', { company: 'X' }, { headers: { 'content-type': 'text/plain' } });
  assert.strictEqual(r.status, 415);
});

test('création, modification, historique, suppression', async () => {
  const created = await call('POST', 'prospects', { company: 'Alpha Conseil', headcount: '120', sizeVerified: true, sizeSource: 'Pappers' });
  assert.strictEqual(created.status, 201);
  const p = created.data.prospect;
  assert.strictEqual(p.headcount, 120);
  assert.strictEqual(p.sizeVerified, true);
  assert.match(p.createdAt, /^\d{4}-\d{2}-\d{2}$/);

  const upd = await call('PUT', `prospects/${p.id}`, { messageSentAt: '2026-10-01', channel: 'Email', signalType: 'Levée de fonds', sizeCheckedAt: 'pas une date' });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual(upd.data.prospect.messageSentAt, '2026-10-01');
  assert.strictEqual(upd.data.prospect.sizeCheckedAt, '');
  assert.strictEqual(upd.data.prospect.headcount, 120, 'les champs non envoyés sont conservés');

  await call('PUT', `prospects/${p.id}`, { response: 'RDV pris', responseNote: 'Jeudi 10h' });
  assert.strictEqual((await call('POST', `prospects/${p.id}/activities`, { text: 'Appel de qualification' })).status, 201);

  const hist = (await call('GET', `prospects/${p.id}/activities`)).data.activities.map((a) => a.kind);
  assert.deepStrictEqual(hist.slice().sort(), ['creation', 'message', 'note', 'qualification', 'reponse', 'signal']);
  const recent = (await call('GET', 'activities?limit=3')).data.activities;
  assert.strictEqual(recent.length, 3);
  assert.strictEqual(recent[0].company, 'Alpha Conseil');

  assert.strictEqual((await call('PUT', `prospects/${p.id}`, { company: ' ' })).status, 400);
  assert.strictEqual((await call('DELETE', `prospects/${p.id}`)).status, 200);
  assert.strictEqual((await call('GET', `prospects/${p.id}`)).status, 404);
  assert.strictEqual((await call('GET', 'activities')).data.activities.length, 0, 'historique supprimé avec la société');
});

test('import CSV : fusion par nom, puis sauvegarde et restauration', async () => {
  const first = await call('POST', 'import', { prospects: [{ company: 'Beta' }, { company: 'Gamma', headcount: 40 }] });
  assert.deepStrictEqual([first.data.added, first.data.updated], [2, 0]);
  const second = await call('POST', 'import', { prospects: [{ company: 'gamma ', headcount: 60 }, { company: '' }] });
  assert.deepStrictEqual([second.data.added, second.data.updated], [0, 1]);
  assert.strictEqual(second.data.prospects.find((p) => p.company === 'Gamma').headcount, 60);

  await call('PUT', 'settings', { sizeMin: 10, sizeMax: 300, followUpDays: 0, maxFollowUps: 3 });
  const backup = (await call('GET', 'backup')).data;
  assert.strictEqual(backup.prospects.length, 2);
  assert.strictEqual(backup.settings.followUpDays, 1, 'délai minimum 1 jour');
  assert.ok(backup.activities.length >= 2);

  await call('POST', 'prospects', { company: 'Delta' });
  const restored = await call('POST', 'restore', backup);
  assert.strictEqual(restored.status, 200);
  assert.deepStrictEqual(restored.data.prospects.map((p) => p.company).sort(), ['Beta', 'Gamma']);
  assert.strictEqual(restored.data.prospects.find((p) => p.company === 'Gamma').id, backup.prospects.find((p) => p.company === 'Gamma').id);
  const boot = (await call('GET', 'bootstrap')).data;
  assert.strictEqual(boot.settings.sizeMax, 300);
  assert.strictEqual((await call('GET', 'activities?limit=100')).data.activities.length, backup.activities.length);
});

test('déconnexion puis limitation des tentatives', async () => {
  const out = await call('POST', 'logout', {});
  assert.match(out.setCookie, /Max-Age=0/);
  cookie = '';
  for (let i = 0; i < 10; i++) await call('POST', 'login', { password: 'faux' });
  const blocked = await call('POST', 'login', { password: 'mot-de-passe-test' });
  assert.strictEqual(blocked.status, 429);
});

test('historique : changements notables uniquement', () => {
  const before = C.normalize({ company: 'A' });
  assert.deepStrictEqual(repo.describeChanges(before, C.normalize({ company: 'A', notes: 'x' })), []);
  const after = C.normalize({ company: 'A', followUps: 1, lastFollowUpAt: '2026-10-08', response: 'Plus tard' });
  assert.deepStrictEqual(repo.describeChanges(before, after).map(([k]) => k), ['relance', 'reponse']);
});
