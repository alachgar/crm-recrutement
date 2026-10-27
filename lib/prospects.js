/*
 * Prospects en base : schéma, conversion ligne <-> objet, validation, historique.
 * Les règles métier (statut, normalisation, fusion) restent dans public/src/logic.js.
 */
'use strict';

const C = require('../public/src/logic.js');

// Type de chaque champ du prospect (les autres sont du texte).
const TYPES = {
  headcount: 'int',
  followUps: 'int',
  sizeVerified: 'bool',
  sizeCheckedAt: 'date',
  signalDate: 'date',
  messageSentAt: 'date',
  lastFollowUpAt: 'date',
  responseAt: 'date',
};

// Champs stockés dans des colonnes « métier » (id, createdAt, updatedAt gérés à part).
const DATA_FIELDS = C.FIELDS.filter((f) => !['id', 'createdAt', 'updatedAt'].includes(f));
const MAX_TEXT = 10000;

const col = (f) => f.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

function columnDef(f) {
  switch (TYPES[f]) {
    case 'int': return f === 'followUps' ? 'integer NOT NULL DEFAULT 0' : 'integer';
    case 'bool': return 'boolean NOT NULL DEFAULT false';
    case 'date': return 'date';
    default:
      if (f === 'company') return 'text NOT NULL';
      if (f === 'response') return "text NOT NULL DEFAULT 'Aucune'";
      return "text NOT NULL DEFAULT ''";
  }
}

function schemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS prospects (
      id text PRIMARY KEY,
      ${DATA_FIELDS.map((f) => `${col(f)} ${columnDef(f)}`).join(',\n      ')},
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id integer PRIMARY KEY CHECK (id = 1),
      data jsonb NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS activities (
      id bigserial PRIMARY KEY,
      prospect_id text NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      kind text NOT NULL,
      text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    'CREATE INDEX IF NOT EXISTS activities_prospect_idx ON activities (prospect_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS activities_created_idx ON activities (created_at DESC)',
    `CREATE TABLE IF NOT EXISTS login_attempts (
      ip text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    )`,
  ];
}

// Colonnes lues : dates en texte ISO pour que Neon et PGlite renvoient la même chose.
const SELECT = [
  'id',
  ...DATA_FIELDS.map((f) => (TYPES[f] === 'date' ? `${col(f)}::text AS "${f}"` : `${col(f)} AS "${f}"`)),
  `to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS "createdAt"`,
  `to_char(updated_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS "updatedAt"`,
].join(', ');

function fromRow(r) {
  const p = {};
  for (const f of C.FIELDS) p[f] = r[f] == null ? '' : r[f];
  return C.normalize(p);
}

function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}

/** Normalise et borne un prospect reçu du client avant écriture. */
function clean(input) {
  const p = C.normalize(input || {});
  for (const f of DATA_FIELDS) {
    const t = TYPES[f];
    if (t === 'date') p[f] = validDate(p[f]);
    else if (t === 'int') p[f] = p[f] == null ? null : Math.max(0, Math.min(f === 'followUps' ? 50 : 10000000, p[f]));
    else if (t !== 'bool') p[f] = String(p[f]).slice(0, MAX_TEXT);
  }
  p.company = p.company.slice(0, 300);
  p.id = String(p.id).slice(0, 64);
  p.createdAt = validDate(p.createdAt);
  return p;
}

const values = (p) => DATA_FIELDS.map((f) => (f === 'followUps' ? p[f] || 0 : p[f]));

function insertQuery(p) {
  const params = [p.id, ...values(p), p.createdAt];
  const n = DATA_FIELDS.length;
  return [
    `INSERT INTO prospects (id, ${DATA_FIELDS.map(col).join(', ')}, created_at)
     VALUES ($1, ${DATA_FIELDS.map((_, i) => '$' + (i + 2)).join(', ')}, COALESCE($${n + 2}::date::timestamptz, now()))
     RETURNING ${SELECT}`,
    params,
  ];
}

function updateQuery(p) {
  return [
    `UPDATE prospects SET ${DATA_FIELDS.map((f, i) => `${col(f)} = $${i + 2}`).join(', ')}, updated_at = now()
     WHERE id = $1 RETURNING ${SELECT}`,
    [p.id, ...values(p)],
  ];
}

const activityQuery = (prospectId, kind, text) => [
  'INSERT INTO activities (prospect_id, kind, text) VALUES ($1, $2, $3)',
  [prospectId, kind, String(text).slice(0, MAX_TEXT)],
];

const fmt = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/** Événements à inscrire dans l'historique quand une fiche change. */
function describeChanges(before, after) {
  const out = [];
  if (!before.sizeVerified && after.sizeVerified) {
    out.push(['qualification', `Taille vérifiée${after.headcount != null ? ` : ${after.headcount} salariés` : ''}${after.sizeSource ? ` (${after.sizeSource})` : ''}`]);
  }
  if (after.signalType && after.signalType !== before.signalType) {
    out.push(['signal', `Signal : ${after.signalType}${after.signalDetail ? ` — ${after.signalDetail}` : ''}`]);
  }
  if (after.messageSentAt && !before.messageSentAt) {
    out.push(['message', `Message envoyé${after.channel ? ` via ${after.channel}` : ''} le ${fmt(after.messageSentAt)}`]);
  }
  if ((after.followUps || 0) > (before.followUps || 0)) {
    out.push(['relance', `Relance n°${after.followUps}${after.lastFollowUpAt ? ` le ${fmt(after.lastFollowUpAt)}` : ''}`]);
  }
  if (after.response !== before.response) {
    out.push(['reponse', `Réponse : ${after.response}${after.responseNote ? ` — ${after.responseNote}` : ''}`]);
  }
  return out;
}

// ---------- Accès aux données ----------

async function list(db) {
  return (await db.query(`SELECT ${SELECT} FROM prospects ORDER BY created_at, company`)).map(fromRow);
}

async function get(db, id) {
  const rows = await db.query(`SELECT ${SELECT} FROM prospects WHERE id = $1`, [id]);
  return rows.length ? fromRow(rows[0]) : null;
}

async function create(db, input, kind) {
  const p = clean(Object.assign({}, input, { id: C.uid() }));
  const label = kind === 'import' ? 'Société importée' : 'Société ajoutée';
  const [rows] = await db.transaction([
    insertQuery(p),
    activityQuery(p.id, 'creation', label),
    ...describeChanges(C.normalize({ company: p.company }), p).map(([k, t]) => activityQuery(p.id, k, t)),
  ]);
  return fromRow(rows[0]);
}

async function update(db, id, input) {
  const before = await get(db, id);
  if (!before) return null;
  const p = clean(Object.assign({}, before, input, { id }));
  const [rows] = await db.transaction([
    updateQuery(p),
    ...describeChanges(before, p).map(([k, t]) => activityQuery(id, k, t)),
  ]);
  return fromRow(rows[0]);
}

async function remove(db, id) {
  return (await db.query('DELETE FROM prospects WHERE id = $1 RETURNING id', [id])).length > 0;
}

/** Import CSV : même ID ou même nom de société => mise à jour, sinon ajout. */
async function importMany(db, incoming) {
  const existing = await list(db);
  const byId = new Map(existing.map((p) => [p.id, p]));
  const { list: merged, added, updated } = C.merge(existing, incoming.map((p) => C.normalize(p)));
  const queries = [];
  for (const m of merged) {
    const before = byId.get(m.id);
    if (before) {
      const p = clean(m);
      queries.push(updateQuery(p), ...describeChanges(before, p).map(([k, t]) => activityQuery(p.id, k, t)));
    } else {
      const p = clean(Object.assign({}, m, { id: C.uid() }));
      queries.push(insertQuery(p), activityQuery(p.id, 'creation', 'Société importée'),
        ...describeChanges(C.normalize({ company: p.company }), p).map(([k, t]) => activityQuery(p.id, k, t)));
    }
  }
  if (queries.length) await db.transaction(queries);
  return { added, updated, prospects: await list(db) };
}

/** Restauration d'une sauvegarde : remplace toutes les données. */
async function restore(db, backup, settings) {
  const prospects = backup.prospects.map(clean);
  const ids = new Set(prospects.map((p) => p.id));
  const activities = (Array.isArray(backup.activities) ? backup.activities : [])
    .filter((a) => a && ids.has(a.prospectId) && a.text);
  await db.transaction([
    ['DELETE FROM prospects', []],
    ['INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [JSON.stringify(settings)]],
    ...prospects.map(insertQuery),
    ...activities.map((a) => [
      'INSERT INTO activities (prospect_id, kind, text, created_at) VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))',
      [a.prospectId, String(a.kind || 'note').slice(0, 40), String(a.text).slice(0, MAX_TEXT),
        Number.isNaN(Date.parse(a.createdAt)) ? null : a.createdAt],
    ]),
  ]);
  return list(db);
}

const ACTIVITY_SELECT = `a.id::text AS id, a.prospect_id AS "prospectId", a.kind, a.text,
  to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`;

function activities(db, prospectId) {
  return db.query(`SELECT ${ACTIVITY_SELECT} FROM activities a WHERE a.prospect_id = $1 ORDER BY a.created_at DESC, a.id DESC`, [prospectId]);
}

function recentActivities(db, limit) {
  return db.query(`SELECT ${ACTIVITY_SELECT}, p.company FROM activities a JOIN prospects p ON p.id = a.prospect_id
    ORDER BY a.created_at DESC, a.id DESC LIMIT $1`, [limit]);
}

function allActivities(db) {
  return db.query(`SELECT ${ACTIVITY_SELECT} FROM activities a ORDER BY a.created_at, a.id`);
}

async function addNote(db, prospectId, text) {
  const rows = await db.query(`INSERT INTO activities (prospect_id, kind, text) SELECT id, 'note', $2 FROM prospects WHERE id = $1
    RETURNING id::text AS id, prospect_id AS "prospectId", kind, text,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`, [prospectId, String(text).slice(0, MAX_TEXT)]);
  return rows[0] || null;
}

// ---------- Réglages ----------

function cleanSettings(input) {
  const out = {};
  for (const k of Object.keys(C.DEFAULT_SETTINGS)) {
    const v = parseInt(input && input[k], 10);
    out[k] = Number.isNaN(v) || v < 0 ? C.DEFAULT_SETTINGS[k] : Math.min(v, 1000000);
  }
  if (out.followUpDays < 1) out.followUpDays = 1;
  return out;
}

async function getSettings(db) {
  const rows = await db.query('SELECT data FROM settings WHERE id = 1');
  const data = rows.length ? (typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data) : {};
  return cleanSettings(Object.assign({}, C.DEFAULT_SETTINGS, data));
}

async function saveSettings(db, input) {
  const s = cleanSettings(input);
  await db.query('INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [JSON.stringify(s)]);
  return s;
}

module.exports = {
  schemaStatements, clean, describeChanges, cleanSettings,
  list, get, create, update, remove, importMany, restore,
  activities, recentActivities, allActivities, addNote, getSettings, saveSettings,
};
