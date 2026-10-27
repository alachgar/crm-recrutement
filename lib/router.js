/*
 * API JSON du CRM. Une seule fonction Vercel (api/index.js) reçoit toutes les routes /api/*
 * (réécriture dans vercel.json) ; le serveur local (server.js) l'utilise aussi.
 */
'use strict';

const { getDb } = require('./db');
const auth = require('./auth');
const repo = require('./prospects');

const MAX_BODY = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body !== undefined && typeof req.body === 'object') return req.body || {};
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.');
      chunks.push(c);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new HttpError(400, 'JSON invalide.');
  }
}

/** Chemin de la route : /api/foo/bar ou /api?path=foo/bar (réécriture Vercel). */
function routePath(req) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.searchParams.get('path') || url.pathname.replace(/^\/api\/?/, '');
  return { parts: p.split('/').filter(Boolean), query: url.searchParams };
}

function requireProspectList(body) {
  if (!body || !Array.isArray(body.prospects)) throw new HttpError(400, 'Liste « prospects » attendue.');
  if (body.prospects.length > 5000) throw new HttpError(413, 'Maximum 5000 sociétés par envoi.');
  return body.prospects.filter((p) => p && typeof p === 'object' && String(p.company || '').trim());
}

async function handle(req, res) {
  const method = req.method;
  const { parts, query } = routePath(req);
  const route = parts.join('/');

  // Protection CSRF : un POST doit être du JSON (impossible depuis un formulaire d'un autre site sans preflight).
  // PUT et DELETE déclenchent toujours un preflight CORS, refusé faute d'en-têtes CORS.
  if (method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Content-Type application/json requis.');
  }

  // ----- Session -----
  if (route === 'session' && method === 'GET') {
    return send(res, 200, {
      authenticated: auth.isAuthenticated(req),
      configured: !!auth.password() || auth.authDisabled(),
      authDisabled: auth.authDisabled(),
    });
  }
  if (route === 'login' && method === 'POST') {
    if (!auth.password()) throw new HttpError(503, 'Mot de passe non configuré : ajoutez APP_PASSWORD dans les variables d\'environnement.');
    const db = await getDb();
    const ip = auth.clientIp(req);
    if (await auth.tooManyFailures(db, ip)) {
      throw new HttpError(429, `Trop de tentatives. Réessayez dans ${auth.FAILURE_WINDOW_MIN} minutes.`);
    }
    const body = await readBody(req);
    if (!auth.checkPassword(body.password || '')) {
      await auth.recordFailure(db, ip);
      throw new HttpError(401, 'Mot de passe incorrect.');
    }
    await auth.clearFailures(db, ip);
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(req, auth.createToken()) });
  }
  if (route === 'logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(req, '') });
  }

  if (!auth.isAuthenticated(req)) throw new HttpError(401, 'Session expirée : reconnectez-vous.');
  const db = await getDb();

  // ----- Données -----
  if (route === 'bootstrap' && method === 'GET') {
    const [settings, prospects] = await Promise.all([repo.getSettings(db), repo.list(db)]);
    return send(res, 200, { settings, prospects });
  }
  if (route === 'settings' && method === 'PUT') {
    return send(res, 200, { settings: await repo.saveSettings(db, await readBody(req)) });
  }
  if (route === 'activities' && method === 'GET') {
    const limit = Math.min(100, Math.max(1, parseInt(query.get('limit'), 10) || 15));
    return send(res, 200, { activities: await repo.recentActivities(db, limit) });
  }
  if (route === 'import' && method === 'POST') {
    const list = requireProspectList(await readBody(req));
    return send(res, 200, await repo.importMany(db, list));
  }
  if (route === 'backup' && method === 'GET') {
    const [settings, prospects, activities] = await Promise.all([repo.getSettings(db), repo.list(db), repo.allActivities(db)]);
    return send(res, 200, { app: 'crm-nova-tech-trust', version: 2, exportedAt: new Date().toISOString(), settings, prospects, activities });
  }
  if (route === 'restore' && method === 'POST') {
    const body = await readBody(req);
    const list = requireProspectList(body);
    const settings = repo.cleanSettings(Object.assign({}, body.settings));
    return send(res, 200, { settings, prospects: await repo.restore(db, Object.assign({}, body, { prospects: list }), settings) });
  }

  if (parts[0] === 'prospects') {
    const id = parts[1];
    if (!id && method === 'POST') {
      const body = await readBody(req);
      if (!String(body.company || '').trim()) throw new HttpError(400, 'Le nom de la société est obligatoire.');
      return send(res, 201, { prospect: await repo.create(db, body) });
    }
    if (id && parts.length === 2) {
      if (method === 'GET') {
        const p = await repo.get(db, id);
        if (!p) throw new HttpError(404, 'Société introuvable.');
        return send(res, 200, { prospect: p });
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        if ('company' in body && !String(body.company || '').trim()) throw new HttpError(400, 'Le nom de la société est obligatoire.');
        const p = await repo.update(db, id, body);
        if (!p) throw new HttpError(404, 'Société introuvable.');
        return send(res, 200, { prospect: p });
      }
      if (method === 'DELETE') {
        if (!(await repo.remove(db, id))) throw new HttpError(404, 'Société introuvable.');
        return send(res, 200, { ok: true });
      }
    }
    if (id && parts[2] === 'activities' && parts.length === 3) {
      if (method === 'GET') return send(res, 200, { activities: await repo.activities(db, id) });
      if (method === 'POST') {
        const text = String((await readBody(req)).text || '').trim();
        if (!text) throw new HttpError(400, 'Note vide.');
        const a = await repo.addNote(db, id, text);
        if (!a) throw new HttpError(404, 'Société introuvable.');
        return send(res, 201, { activity: a });
      }
    }
  }

  throw new HttpError(404, 'Route inconnue.');
}

async function handler(req, res) {
  try {
    await handle(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    send(res, status, { error: status >= 500 && !err.status ? 'Erreur serveur.' : err.message });
  }
}

module.exports = { handler, HttpError };
