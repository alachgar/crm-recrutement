/*
 * Accès à la base Postgres.
 * - En production (Vercel) : Neon via HTTP, URL dans DATABASE_URL (ou POSTGRES_URL).
 * - En local sans DATABASE_URL : PGlite (Postgres embarqué), stocké dans .data/pglite.
 * Le schéma est créé automatiquement au premier accès.
 */
'use strict';

const { schemaStatements } = require('./prospects');

let dbPromise = null;

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

async function connectNeon(url) {
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(url);
  return {
    query: (text, params) => sql.query(text, params || []),
    transaction: (queries) => sql.transaction(queries.map(([text, params]) => sql.query(text, params || []))),
  };
}

async function connectPglite(dir) {
  // Import dynamique par variable : PGlite n'est qu'une dépendance de développement
  // et ne doit pas être embarqué dans la fonction Vercel.
  const name = '@electric-sql/pglite';
  const { PGlite } = await import(name);
  const pg = new PGlite(dir);
  return {
    query: async (text, params) => (await pg.query(text, params || [])).rows,
    transaction: (queries) => pg.transaction(async (tx) => {
      const out = [];
      for (const [text, params] of queries) out.push((await tx.query(text, params || [])).rows);
      return out;
    }),
    close: () => pg.close(),
  };
}

async function init() {
  const url = databaseUrl();
  let db;
  if (url) db = await connectNeon(url);
  else if (!process.env.VERCEL) db = await connectPglite(process.env.PGLITE_DIR || '.data/pglite');
  else throw Object.assign(new Error('Base de données non configurée : ajoutez DATABASE_URL (Neon) dans Vercel.'), { status: 503 });
  for (const stmt of schemaStatements()) await db.query(stmt);
  return db;
}

function getDb() {
  if (!dbPromise) dbPromise = init().catch((err) => { dbPromise = null; throw err; });
  return dbPromise;
}

/** Pour les tests : repart d'une connexion neuve. */
async function resetDb() {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    if (db && db.close) await db.close();
  }
  dbPromise = null;
}

module.exports = { getDb, resetDb };
