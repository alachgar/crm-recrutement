/*
 * Serveur de développement local : fichiers de public/ + API (même code que sur Vercel).
 * Sans DATABASE_URL, les données sont stockées dans .data/pglite (Postgres embarqué).
 * Usage : npm run dev   puis http://localhost:3000
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.APP_PASSWORD) {
  process.env.CRM_LOCAL_DEV = '1';
  console.warn('⚠ APP_PASSWORD non défini : accès sans mot de passe (développement local uniquement).');
}

const { handler } = require('./lib/router');

const ROOT = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT, 10) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api' || pathname.startsWith('/api/')) return handler(req, res);
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
  if (!file.startsWith(ROOT + path.sep)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Introuvable'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`CRM Nova Tech Trust : http://localhost:${PORT}`));
