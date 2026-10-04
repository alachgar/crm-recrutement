/*
 * Logique métier du CRM de prospection ESN (sans dépendance au DOM).
 * Utilisable dans le navigateur (window.CRM) et dans Node (module.exports) pour les tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CRM = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIGNAL_TYPES = [
    'Offres d\'emploi en volume',
    'Levée de fonds',
    'Croissance des effectifs',
    'Nouveau DRH / Talent Acquisition',
    'Turnover élevé (avis Glassdoor…)',
    'Nouvelle agence / implantation',
    'Gain d\'un gros contrat',
    'Post LinkedIn sur difficultés de recrutement',
    'Autre',
  ];

  const SIZE_SOURCES = ['LinkedIn', 'Pappers', 'Societe.com', 'Site web', 'Échange direct', 'Autre'];

  const CHANNELS = ['LinkedIn', 'Email', 'Téléphone', 'Autre'];

  const RESPONSES = ['Aucune', 'Positive', 'RDV pris', 'Plus tard', 'Négative'];

  // Statuts du pipeline, dans l'ordre d'avancement.
  const STATUSES = [
    'À qualifier',
    'Prête à contacter',
    'En attente de réponse',
    'Relance à faire',
    'À recontacter plus tard',
    'Intéressée',
    'RDV diagnostic',
    'Perdue',
  ];

  const DEFAULT_SETTINGS = {
    sizeMin: 20,       // effectif minimum de la cible
    sizeMax: 500,      // effectif maximum de la cible
    followUpDays: 5,   // délai avant relance (jours)
    maxFollowUps: 2,   // nombre de relances maximum avant d'abandonner
  };

  const FIELDS = [
    // Société
    'id', 'company', 'website', 'city',
    // Taille vérifiée
    'headcount', 'sizeVerified', 'sizeSource', 'sizeCheckedAt',
    // Signal
    'signalType', 'signalDetail', 'signalDate', 'signalUrl',
    // Contact
    'contactName', 'contactRole', 'contactUrl',
    // Message envoyé
    'messageSentAt', 'channel', 'messageText', 'followUps', 'lastFollowUpAt',
    // Réponse
    'response', 'responseAt', 'responseNote',
    // Divers
    'notes', 'createdAt', 'updatedAt',
  ];

  const CSV_HEADERS = {
    id: 'ID',
    company: 'Société',
    website: 'Site web',
    city: 'Ville',
    headcount: 'Effectif',
    sizeVerified: 'Taille vérifiée',
    sizeSource: 'Source taille',
    sizeCheckedAt: 'Date vérification taille',
    signalType: 'Type de signal',
    signalDetail: 'Détail signal',
    signalDate: 'Date signal',
    signalUrl: 'Lien signal',
    contactName: 'Contact',
    contactRole: 'Poste contact',
    contactUrl: 'LinkedIn / email contact',
    messageSentAt: 'Date message envoyé',
    channel: 'Canal',
    messageText: 'Message envoyé',
    followUps: 'Nb relances',
    lastFollowUpAt: 'Date dernière relance',
    response: 'Réponse',
    responseAt: 'Date réponse',
    responseNote: 'Commentaire réponse',
    notes: 'Notes',
    createdAt: 'Créé le',
    updatedAt: 'Modifié le',
  };

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function toBool(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return ['oui', 'yes', 'true', '1', 'x', 'vrai'].includes(s);
  }

  function toInt(v) {
    if (v === '' || v == null) return null;
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  /** Normalise un prospect (valeurs par défaut, types). */
  function normalize(p) {
    const out = {};
    for (const f of FIELDS) out[f] = p && p[f] != null ? p[f] : '';
    out.id = out.id || uid();
    out.company = String(out.company).trim();
    out.headcount = toInt(out.headcount);
    out.sizeVerified = toBool(out.sizeVerified);
    out.followUps = toInt(out.followUps) || 0;
    if (!RESPONSES.includes(out.response)) out.response = 'Aucune';
    out.createdAt = out.createdAt || today();
    out.updatedAt = out.updatedAt || out.createdAt;
    return out;
  }

  function daysBetween(fromIso, toIso) {
    const a = Date.parse(fromIso);
    const b = Date.parse(toIso);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.floor((b - a) / 86400000);
  }

  /** La taille est-elle dans la cible définie dans les réglages ? (null si inconnue) */
  function inTarget(p, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings);
    if (p.headcount == null) return null;
    return p.headcount >= s.sizeMin && p.headcount <= s.sizeMax;
  }

  /** Date du dernier contact (message initial ou dernière relance). */
  function lastTouch(p) {
    return [p.lastFollowUpAt, p.messageSentAt].filter(Boolean).sort().pop() || '';
  }

  /** Date à laquelle la prochaine relance est due ('' si aucune). */
  function nextFollowUpDate(p, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings);
    if (!p.messageSentAt || p.response !== 'Aucune') return '';
    if ((p.followUps || 0) >= s.maxFollowUps) return '';
    const d = new Date(Date.parse(lastTouch(p)) + s.followUpDays * 86400000);
    return d.toISOString().slice(0, 10);
  }

  /** Déduit le statut pipeline à partir des données saisies. */
  function computeStatus(p, settings, now) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings);
    now = now || today();
    switch (p.response) {
      case 'RDV pris': return 'RDV diagnostic';
      case 'Positive': return 'Intéressée';
      case 'Négative': return 'Perdue';
      case 'Plus tard': return 'À recontacter plus tard';
    }
    if (p.messageSentAt) {
      const due = nextFollowUpDate(p, s);
      if (due && due <= now) return 'Relance à faire';
      if (!due && (p.followUps || 0) >= s.maxFollowUps) {
        // Toutes les relances faites et toujours rien après le délai : on abandonne.
        const silent = daysBetween(lastTouch(p), now);
        if (silent != null && silent >= s.followUpDays) return 'Perdue';
      }
      return 'En attente de réponse';
    }
    if (p.sizeVerified && inTarget(p, s) !== false && p.signalType) return 'Prête à contacter';
    return 'À qualifier';
  }

  /** Ce qui manque pour qualifier un prospect. */
  function missingQualification(p, settings) {
    const missing = [];
    if (!p.sizeVerified) missing.push('taille non vérifiée');
    else if (inTarget(p, settings) === false) missing.push('hors cible taille');
    if (!p.signalType) missing.push('pas de signal');
    if (!p.contactName) missing.push('pas de contact');
    return missing;
  }

  /** Indicateurs de pilotage. */
  function computeStats(prospects, settings, now) {
    const list = prospects.map((p) => Object.assign({}, p, { status: computeStatus(p, settings, now) }));
    const total = list.length;
    const verified = list.filter((p) => p.sizeVerified).length;
    const withSignal = list.filter((p) => p.signalType).length;
    const contacted = list.filter((p) => p.messageSentAt).length;
    const answered = list.filter((p) => p.messageSentAt && p.response !== 'Aucune').length;
    const positive = list.filter((p) => p.response === 'Positive' || p.response === 'RDV pris').length;
    const meetings = list.filter((p) => p.response === 'RDV pris').length;
    const followUpsDue = list.filter((p) => p.status === 'Relance à faire').length;
    const ready = list.filter((p) => p.status === 'Prête à contacter').length;

    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

    const byStatus = {};
    for (const st of STATUSES) byStatus[st] = 0;
    for (const p of list) byStatus[p.status]++;

    // Taux de réponse par type de signal et par canal : quels angles fonctionnent ?
    const groupRate = (key) => {
      const g = {};
      for (const p of list) {
        if (!p.messageSentAt) continue;
        const k = p[key] || 'Non renseigné';
        g[k] = g[k] || { sent: 0, answered: 0, positive: 0 };
        g[k].sent++;
        if (p.response !== 'Aucune') g[k].answered++;
        if (p.response === 'Positive' || p.response === 'RDV pris') g[k].positive++;
      }
      return Object.entries(g)
        .map(([name, v]) => Object.assign({ name, rate: pct(v.answered, v.sent), positiveRate: pct(v.positive, v.sent) }, v))
        .sort((a, b) => b.sent - a.sent);
    };

    return {
      total, verified, withSignal, contacted, answered, positive, meetings, followUpsDue, ready,
      verifiedRate: pct(verified, total),
      contactRate: pct(contacted, total),
      responseRate: pct(answered, contacted),
      positiveRate: pct(positive, contacted),
      meetingRate: pct(meetings, contacted),
      byStatus,
      bySignal: groupRate('signalType'),
      byChannel: groupRate('channel'),
    };
  }

  // ---------- CSV (séparateur « ; » pour Excel FR) ----------

  function csvEscape(v, sep) {
    const s = v == null ? '' : String(v);
    return /["\n\r]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(prospects, sep) {
    sep = sep || ';';
    const cols = FIELDS.concat(['status']);
    const header = cols.map((c) => csvEscape(c === 'status' ? 'Statut' : CSV_HEADERS[c], sep)).join(sep);
    const rows = prospects.map((p) => cols.map((c) => {
      let v = c === 'status' ? computeStatus(p) : p[c];
      if (c === 'sizeVerified') v = p.sizeVerified ? 'Oui' : 'Non';
      return csvEscape(v, sep);
    }).join(sep));
    return [header].concat(rows).join('\r\n');
  }

  function parseCSVRows(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cell += c;
      } else if (c === '"') inQuotes = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  /** Importe un CSV (en-têtes français de l'export, ou noms de champs internes). */
  function fromCSV(text) {
    const rows = parseCSVRows(text);
    if (!rows.length) return [];
    const labelToField = {};
    for (const f of FIELDS) {
      labelToField[CSV_HEADERS[f].toLowerCase()] = f;
      labelToField[f.toLowerCase()] = f;
    }
    const map = rows[0].map((h) => labelToField[h.trim().toLowerCase()] || null);
    return rows.slice(1)
      .map((r) => {
        const p = {};
        map.forEach((f, i) => { if (f) p[f] = (r[i] || '').trim(); });
        return p;
      })
      .filter((p) => p.company)
      .map(normalize);
  }

  /** Fusionne des prospects importés : même ID ou même nom de société => mise à jour. */
  function merge(existing, incoming) {
    const out = existing.slice();
    const key = (p) => p.company.trim().toLowerCase();
    let added = 0;
    let updated = 0;
    for (const p of incoming) {
      const idx = out.findIndex((e) => e.id === p.id || key(e) === key(p));
      if (idx >= 0) { out[idx] = normalize(Object.assign({}, out[idx], p, { id: out[idx].id })); updated++; }
      else { out.push(normalize(p)); added++; }
    }
    return { list: out, added, updated };
  }

  return {
    SIGNAL_TYPES, SIZE_SOURCES, CHANNELS, RESPONSES, STATUSES, DEFAULT_SETTINGS, FIELDS, CSV_HEADERS,
    today, uid, normalize, inTarget, lastTouch, nextFollowUpDate, computeStatus, missingQualification,
    computeStats, toCSV, fromCSV, parseCSVRows, merge, daysBetween,
  };
});
