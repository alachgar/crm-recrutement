const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../public/src/logic.js');

const base = (o) => C.normalize(Object.assign({ company: 'ESN Test' }, o));

test('statut : à qualifier puis prête à contacter', () => {
  assert.strictEqual(C.computeStatus(base({})), 'À qualifier');
  assert.strictEqual(C.computeStatus(base({ headcount: 80, sizeVerified: true })), 'À qualifier');
  assert.strictEqual(C.computeStatus(base({ headcount: 80, sizeVerified: true, signalType: 'Levée de fonds' })), 'Prête à contacter');
});

test('statut : hors cible taille reste à qualifier', () => {
  const p = base({ headcount: 5000, sizeVerified: true, signalType: 'Levée de fonds' });
  assert.strictEqual(C.computeStatus(p), 'À qualifier');
  assert.deepStrictEqual(C.missingQualification(p), ['hors cible taille', 'pas de contact']);
});

test('statut : attente, relance, abandon', () => {
  const p = base({ messageSentAt: '2026-10-01' });
  assert.strictEqual(C.computeStatus(p, {}, '2026-10-03'), 'En attente de réponse');
  assert.strictEqual(C.nextFollowUpDate(p), '2026-10-06');
  assert.strictEqual(C.computeStatus(p, {}, '2026-10-06'), 'Relance à faire');
  const relancee = base({ messageSentAt: '2026-10-01', followUps: 1, lastFollowUpAt: '2026-10-06' });
  assert.strictEqual(C.computeStatus(relancee, {}, '2026-10-08'), 'En attente de réponse');
  const epuisee = base({ messageSentAt: '2026-10-01', followUps: 2, lastFollowUpAt: '2026-10-11' });
  assert.strictEqual(C.computeStatus(epuisee, {}, '2026-10-12'), 'En attente de réponse');
  assert.strictEqual(C.computeStatus(epuisee, {}, '2026-10-16'), 'Perdue');
});

test('statut : la réponse prime', () => {
  assert.strictEqual(C.computeStatus(base({ messageSentAt: '2026-10-01', response: 'RDV pris' })), 'RDV diagnostic');
  assert.strictEqual(C.computeStatus(base({ messageSentAt: '2026-10-01', response: 'Positive' })), 'Intéressée');
  assert.strictEqual(C.computeStatus(base({ messageSentAt: '2026-10-01', response: 'Négative' })), 'Perdue');
  assert.strictEqual(C.computeStatus(base({ messageSentAt: '2026-10-01', response: 'Plus tard' })), 'À recontacter plus tard');
});

test('statistiques', () => {
  const list = [
    base({ company: 'A', sizeVerified: true, signalType: 'Levée de fonds', messageSentAt: '2026-10-01', channel: 'Email', response: 'RDV pris' }),
    base({ company: 'B', sizeVerified: true, signalType: 'Levée de fonds', messageSentAt: '2026-10-01', channel: 'LinkedIn' }),
    base({ company: 'C' }),
  ];
  const s = C.computeStats(list, {}, '2026-10-02');
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.contacted, 2);
  assert.strictEqual(s.responseRate, 50);
  assert.strictEqual(s.meetings, 1);
  assert.strictEqual(s.bySignal[0].name, 'Levée de fonds');
  assert.strictEqual(s.bySignal[0].positiveRate, 50);
});

test('CSV : aller-retour avec ; guillemets et retours ligne', () => {
  const p = base({ company: 'Alpha; "Beta"', messageText: 'Bonjour,\nligne 2', sizeVerified: true, headcount: 42 });
  const back = C.fromCSV(C.toCSV([p]));
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].company, 'Alpha; "Beta"');
  assert.strictEqual(back[0].messageText, 'Bonjour,\nligne 2');
  assert.strictEqual(back[0].sizeVerified, true);
  assert.strictEqual(back[0].headcount, 42);
  assert.strictEqual(back[0].id, p.id);
});

test('CSV : séparateur virgule et fichiers fournis', () => {
  assert.strictEqual(C.fromCSV('Société,Effectif\nFoo,12\n')[0].headcount, 12);
  for (const f of ['modele-import.csv', 'demo.csv']) {
    const list = C.fromCSV(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', f), 'utf8'));
    assert.ok(list.length >= 1, f);
  }
});

test('fusion : même société mise à jour, nouvelle ajoutée', () => {
  const existing = [base({ company: 'Alpha', headcount: 10 })];
  const r = C.merge(existing, [base({ company: 'alpha ', headcount: 50 }), base({ company: 'Beta' })]);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.list[0].headcount, 50);
  assert.strictEqual(r.list[0].id, existing[0].id);
});
