/*
 * Authentification par mot de passe unique (variable APP_PASSWORD) et cookie de session signé.
 * Sans APP_PASSWORD, l'accès n'est ouvert qu'en développement local (CRM_LOCAL_DEV=1).
 */
'use strict';

const crypto = require('node:crypto');

const COOKIE = 'ntt_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 10;          // tentatives ratées autorisées…
const FAILURE_WINDOW_MIN = 15;    // …par adresse IP sur cette fenêtre

const password = () => process.env.APP_PASSWORD || '';
const authDisabled = () => !password() && process.env.CRM_LOCAL_DEV === '1';

function secret() {
  // Sans SESSION_SECRET, la clé dérive du mot de passe : le changer déconnecte tout le monde.
  return process.env.SESSION_SECRET || crypto.createHash('sha256').update('nova-tech-trust-crm|' + password()).digest('hex');
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function createToken(now) {
  const payload = b64(JSON.stringify({ exp: (now || Date.now()) + SESSION_DAYS * 86400000 }));
  return payload + '.' + sign(payload);
}

function verifyToken(token, now) {
  if (!token || !password()) return false;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > (now || Date.now());
  } catch (e) {
    return false;
  }
}

function checkPassword(candidate) {
  if (!password()) return false;
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(candidate), h(password()));
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function isSecure(req) {
  return process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https';
}

function sessionCookie(req, token) {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
}

const isAuthenticated = (req) => authDisabled() || verifyToken(readCookie(req, COOKIE));

function clientIp(req) {
  return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'inconnue')
    .split(',')[0].trim().slice(0, 64);
}

/** Limite les essais de mot de passe par IP (stockage en base, partagé entre instances). */
async function tooManyFailures(db, ip) {
  const rows = await db.query(
    `SELECT count(*)::int AS n FROM login_attempts WHERE ip = $1 AND at > now() - interval '${FAILURE_WINDOW_MIN} minutes'`, [ip]);
  return rows[0].n >= MAX_FAILURES;
}

async function recordFailure(db, ip) {
  await db.transaction([
    ['INSERT INTO login_attempts (ip) VALUES ($1)', [ip]],
    ["DELETE FROM login_attempts WHERE at < now() - interval '1 day'", []],
  ]);
}

const clearFailures = (db, ip) => db.query('DELETE FROM login_attempts WHERE ip = $1', [ip]);

module.exports = {
  password, authDisabled, createToken, verifyToken, checkPassword, sessionCookie, isAuthenticated,
  clientIp, tooManyFailures, recordFailure, clearFailures, FAILURE_WINDOW_MIN,
};
