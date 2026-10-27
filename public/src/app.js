/*
 * Interface du CRM (navigateur). La logique métier est dans logic.js (window.CRM),
 * les données dans la base Postgres via l'API /api (lib/router.js).
 */
(function () {
  'use strict';
  const C = window.CRM;
  // Anciennes données de la version 100 % navigateur, proposées à l'import dans la base.
  const LEGACY_KEY = 'crm-esn-prospects-v1';
  const THEME_KEY = 'ntt-theme';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  let prospects = [];
  let settings = Object.assign({}, C.DEFAULT_SETTINGS);
  let sort = { key: 'status', dir: 1 };
  let started = false;

  // ---------- API ----------
  class AuthError extends Error {}

  async function api(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch('api/' + path, opts);
    } catch (e) {
      throw new Error('Serveur injoignable : vérifiez votre connexion.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== 'login') {
      showLogin('Session expirée : reconnectez-vous.');
      throw new AuthError(data.error || 'Non connecté.');
    }
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  /** Exécute une action serveur et affiche l'erreur éventuelle. */
  async function run(fn, btn) {
    if (btn) btn.disabled = true;
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof AuthError)) toast(err.message);
      return undefined;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function upsertLocal(p) {
    const idx = prospects.findIndex((x) => x.id === p.id);
    if (idx >= 0) prospects[idx] = C.normalize(p);
    else prospects.push(C.normalize(p));
  }

  async function loadAll() {
    const data = await api('GET', 'bootstrap');
    prospects = data.prospects.map(C.normalize);
    settings = Object.assign({}, C.DEFAULT_SETTINGS, data.settings);
    render();
    loadRecent();
  }

  async function loadRecent() {
    try {
      const { activities } = await api('GET', 'activities?limit=12');
      $('#recent').innerHTML = activities.length
        ? `<ul class="timeline">${activities.map((a) => `<li class="k-${esc(a.kind)}">
            <span class="tl-when">${esc(fmtDateTime(a.createdAt))}</span>
            <a href="#" data-edit="${esc(a.prospectId)}">${esc(a.company)}</a> — ${esc(a.text)}</li>`).join('')}</ul>`
        : '<p class="muted">Aucune activité pour l\'instant.</p>';
    } catch (e) {
      if (!(e instanceof AuthError)) $('#recent').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  // ---------- Utilitaires ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function safeUrl(u) {
    return /^https?:\/\//i.test(u || '') ? u : '';
  }
  function slug(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function options(list, withEmpty) {
    return (withEmpty ? '<option value="">—</option>' : '') + list.map((o) => `<option>${esc(o)}</option>`).join('');
  }

  // ---------- Rendu ----------
  function withStatus() {
    const now = C.today();
    return prospects.map((p) => Object.assign({}, p, { status: C.computeStatus(p, settings, now) }));
  }

  function renderKpis(st) {
    const items = [
      ['Sociétés', st.total, `${st.verifiedRate}% taille vérifiée`],
      ['Prêtes à contacter', st.ready, 'taille + signal OK'],
      ['Messages envoyés', st.contacted, `${st.contactRate}% des sociétés`],
      ['Taux de réponse', st.responseRate + '%', `${st.answered} réponse(s)`],
      ['Réponses positives', st.positive, `${st.positiveRate}% des envois`],
      ['RDV diagnostic', st.meetings, `${st.meetingRate}% des envois`],
      ['Relances à faire', st.followUpsDue, `après ${settings.followUpDays} j sans réponse`],
    ];
    $('#kpis').innerHTML = items.map(([label, value, sub]) => `
      <div class="kpi"><div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div><div class="kpi-sub">${esc(sub)}</div></div>`).join('');
  }

  function renderFunnel(st) {
    const max = Math.max(1, ...Object.values(st.byStatus));
    $('#funnel').innerHTML = C.STATUSES.map((s) => `
      <button class="bar-row" data-status="${esc(s)}" title="Filtrer sur ce statut">
        <span class="bar-label"><span class="badge ${'s-' + slug(s)}">${esc(s)}</span></span>
        <span class="bar"><span style="width:${(st.byStatus[s] / max) * 100}%"></span></span>
        <span class="bar-value">${st.byStatus[s]}</span>
      </button>`).join('');
  }

  function renderRates(el, rows) {
    if (!rows.length) {
      el.innerHTML = '<p class="muted">Pas encore de message envoyé.</p>';
      return;
    }
    el.innerHTML = `<table class="mini"><thead><tr><th></th><th>Envoyés</th><th>Réponse</th><th>Positif / RDV</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.sent}</td>
        <td><span class="pill">${r.rate}%</span></td><td><span class="pill ok">${r.positiveRate}%</span></td></tr>`).join('')
    }</tbody></table>`;
  }

  function renderTodo(list) {
    const now = C.today();
    const followUps = list.filter((p) => p.status === 'Relance à faire')
      .sort((a, b) => C.nextFollowUpDate(a, settings).localeCompare(C.nextFollowUpDate(b, settings)));
    const ready = list.filter((p) => p.status === 'Prête à contacter');
    const toQualify = list.filter((p) => p.status === 'À qualifier');
    const item = (p, extra) => `<li><a href="#" data-edit="${esc(p.id)}">${esc(p.company)}</a> <span class="muted">${extra}</span></li>`;
    const block = (title, arr, fn) => arr.length
      ? `<h3>${title} <span class="muted">(${arr.length})</span></h3><ul>${arr.slice(0, 6).map(fn).join('')}</ul>${arr.length > 6 ? `<p class="muted">… et ${arr.length - 6} autre(s)</p>` : ''}`
      : '';
    const html =
      block('Relancer', followUps, (p) => {
        const late = C.daysBetween(C.nextFollowUpDate(p, settings), now);
        return item(p, `relance ${p.followUps + 1} · ${esc(p.channel || '')}${late > 0 ? ` · en retard de ${late} j` : ''}`);
      }) +
      block('Envoyer le premier message', ready, (p) => item(p, esc(p.signalType))) +
      block('Qualifier', toQualify, (p) => item(p, esc(C.missingQualification(p, settings).join(', '))));
    $('#todo').innerHTML = html || '<p class="muted">Rien à faire pour le moment 🎉</p>';
  }

  function filtered(list) {
    const q = $('#f-search').value.trim().toLowerCase();
    const fs = $('#f-status').value;
    const fsig = $('#f-signal').value;
    const fr = $('#f-response').value;
    return list.filter((p) =>
      (!fs || p.status === fs) &&
      (!fsig || p.signalType === fsig) &&
      (!fr || p.response === fr) &&
      (!q || [p.company, p.city, p.contactName, p.contactRole, p.signalDetail, p.notes].join(' ').toLowerCase().includes(q)));
  }

  function sorted(list) {
    const k = sort.key;
    const val = (p) => (k === 'status' ? C.STATUSES.indexOf(p.status) : p[k]);
    return list.slice().sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === vb) return a.company.localeCompare(b.company);
      if (va === '' || va == null) return 1;
      if (vb === '' || vb == null) return -1;
      return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
  }

  function renderTable(list) {
    const rows = sorted(filtered(list));
    $('#count').textContent = `(${rows.length}${rows.length !== list.length ? ' / ' + list.length : ''})`;
    $('#empty').hidden = list.length > 0;
    $('#table tbody').innerHTML = rows.map((p) => {
      const target = C.inTarget(p, settings);
      const size = p.headcount == null ? '<span class="muted">?</span>' : esc(p.headcount);
      const sizeFlag = p.sizeVerified
        ? `<span class="tag ok" title="${esc(p.sizeSource)} ${esc(fmtDate(p.sizeCheckedAt))}">✓ vérifiée</span>`
        : '<span class="tag warn">à vérifier</span>';
      const off = target === false ? '<span class="tag bad">hors cible</span>' : '';
      const site = safeUrl(p.website);
      const sigUrl = safeUrl(p.signalUrl);
      const due = C.nextFollowUpDate(p, settings);
      return `<tr data-id="${esc(p.id)}">
        <td><strong>${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(p.company)}</a>` : esc(p.company)}</strong>
          <div class="muted">${esc(p.city)}</div></td>
        <td>${size} ${sizeFlag} ${off}</td>
        <td>${p.signalType ? esc(p.signalType) : '<span class="muted">—</span>'}
          <div class="muted">${esc(p.signalDetail)} ${sigUrl ? `<a href="${esc(sigUrl)}" target="_blank" rel="noopener">↗</a>` : ''}</div></td>
        <td>${esc(p.contactName)}<div class="muted">${esc(p.contactRole)}</div></td>
        <td>${p.messageSentAt ? `${esc(fmtDate(p.messageSentAt))} <span class="muted">· ${esc(p.channel)}</span>
          <div class="muted">${[p.followUps ? p.followUps + ' relance(s)' : '', due ? `relance le ${esc(fmtDate(due))}` : ''].filter(Boolean).join(' · ')}</div>` : '<span class="muted">—</span>'}</td>
        <td><span class="badge r-${slug(p.response)}">${esc(p.response)}</span>
          <div class="muted">${esc(fmtDate(p.responseAt))}</div></td>
        <td><span class="badge s-${slug(p.status)}">${esc(p.status)}</span></td>
        <td class="row-actions">
          ${p.messageSentAt && p.response === 'Aucune' ? `<button data-followup="${esc(p.id)}" title="Marquer une relance faite aujourd'hui">+ Relance</button>` : ''}
          ${!p.messageSentAt && p.status === 'Prête à contacter' ? `<button data-sent="${esc(p.id)}" title="Marquer le message envoyé aujourd'hui">Envoyé</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    $$('#table th[data-sort]').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === sort.key);
      th.dataset.dir = th.dataset.sort === sort.key ? (sort.dir > 0 ? '▲' : '▼') : '';
    });
  }

  function render() {
    const list = withStatus();
    const st = C.computeStats(prospects, settings);
    renderKpis(st);
    renderFunnel(st);
    renderTodo(list);
    renderRates($('#by-signal'), st.bySignal);
    renderRates($('#by-channel'), st.byChannel);
    renderTable(list);
  }

  // ---------- Fiche société ----------
  const dlg = $('#dlg-prospect');
  const form = $('#form-prospect');

  function openProspect(id) {
    const p = id ? prospects.find((x) => x.id === id) : C.normalize({ company: '' });
    form.reset();
    for (const el of form.elements) {
      if (!el.name || !(el.name in p)) continue;
      if (el.type === 'checkbox') el.checked = !!p[el.name];
      else el.value = p[el.name] == null ? '' : p[el.name];
    }
    form.elements.id.value = id || '';
    $('#dlg-title').textContent = id ? p.company : 'Nouvelle société';
    $('#btn-delete').hidden = !id;
    $('#history').hidden = !id;
    $('#history-list').innerHTML = '';
    $('#note-text').value = '';
    updateSizeHint();
    dlg.showModal();
    form.elements.company.focus();
    if (id) loadHistory(id);
  }

  async function loadHistory(id) {
    const list = $('#history-list');
    list.innerHTML = '<li class="muted">Chargement…</li>';
    try {
      const { activities } = await api('GET', `prospects/${encodeURIComponent(id)}/activities`);
      if (form.elements.id.value !== id) return;
      list.innerHTML = activities.length
        ? activities.map((a) => `<li class="k-${esc(a.kind)}"><span class="tl-when">${esc(fmtDateTime(a.createdAt))}</span> ${esc(a.text)}</li>`).join('')
        : '<li class="muted">Aucun événement.</li>';
    } catch (e) {
      if (!(e instanceof AuthError)) list.innerHTML = `<li class="muted">${esc(e.message)}</li>`;
    }
  }

  async function addNote() {
    const id = form.elements.id.value;
    const input = $('#note-text');
    const text = input.value.trim();
    if (!id || !text) return;
    const ok = await run(() => api('POST', `prospects/${encodeURIComponent(id)}/activities`, { text }), $('#btn-note'));
    if (!ok) return;
    input.value = '';
    loadHistory(id);
    loadRecent();
  }
  $('#btn-note').addEventListener('click', addNote);
  $('#note-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addNote(); }
  });

  function updateSizeHint() {
    const n = parseInt(form.elements.headcount.value, 10);
    const hint = $('#size-hint');
    if (Number.isNaN(n)) hint.textContent = `Cible : ${settings.sizeMin}–${settings.sizeMax} salariés.`;
    else if (n < settings.sizeMin || n > settings.sizeMax) hint.textContent = `⚠ Hors cible (${settings.sizeMin}–${settings.sizeMax} salariés).`;
    else hint.textContent = '✓ Dans la cible.';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    if (!data.company.trim()) return;
    if (data.sizeVerified && !data.sizeCheckedAt) data.sizeCheckedAt = C.today();
    if (data.response !== 'Aucune' && !data.responseAt) data.responseAt = C.today();
    const dup = prospects.find((p) => p.id !== data.id && p.company.trim().toLowerCase() === data.company.trim().toLowerCase());
    if (dup && !confirm(`« ${dup.company} » existe déjà. Enregistrer quand même ?`)) return;
    const id = data.id;
    delete data.id;
    const res = await run(() => (id
      ? api('PUT', `prospects/${encodeURIComponent(id)}`, data)
      : api('POST', 'prospects', data)), $('button[type=submit]', form));
    if (!res) return;
    upsertLocal(res.prospect);
    dlg.close();
    render();
    loadRecent();
    toast('Enregistré.');
  });

  form.elements.headcount.addEventListener('input', updateSizeHint);
  $('#btn-cancel').addEventListener('click', () => dlg.close());
  $('#btn-delete').addEventListener('click', async () => {
    const id = form.elements.id.value;
    const p = prospects.find((x) => x.id === id);
    if (!p || !confirm(`Supprimer « ${p.company} » et son historique ?`)) return;
    const ok = await run(() => api('DELETE', `prospects/${encodeURIComponent(id)}`), $('#btn-delete'));
    if (!ok) return;
    prospects = prospects.filter((x) => x.id !== id);
    dlg.close();
    render();
    loadRecent();
    toast('Société supprimée.');
  });

  // ---------- Réglages ----------
  const dlgS = $('#dlg-settings');
  const formS = $('#form-settings');
  $('#btn-settings').addEventListener('click', () => {
    for (const k of Object.keys(C.DEFAULT_SETTINGS)) formS.elements[k].value = settings[k];
    dlgS.showModal();
  });
  $('#btn-settings-cancel').addEventListener('click', () => dlgS.close());
  formS.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = {};
    for (const k of Object.keys(C.DEFAULT_SETTINGS)) {
      const v = parseInt(formS.elements[k].value, 10);
      next[k] = Number.isNaN(v) ? C.DEFAULT_SETTINGS[k] : v;
    }
    const res = await run(() => api('PUT', 'settings', next), $('button[type=submit]', formS));
    if (!res) return;
    settings = Object.assign({}, C.DEFAULT_SETTINGS, res.settings);
    dlgS.close();
    render();
    toast('Réglages enregistrés.');
  });

  /** Envoie des sociétés à la base (fusion par ID ou nom de société). */
  async function importList(list, btn) {
    const res = await run(() => api('POST', 'import', { prospects: list }), btn);
    if (!res) return null;
    prospects = res.prospects.map(C.normalize);
    render();
    loadRecent();
    return res;
  }

  $('#btn-demo').addEventListener('click', async () => {
    if (prospects.length && !confirm('Ajouter les données de démo à vos données existantes ?')) return;
    let list;
    try {
      list = C.fromCSV(await (await fetch('data/demo.csv')).text());
    } catch (err) {
      return toast('Impossible de charger data/demo.csv.');
    }
    const res = await importList(list, $('#btn-demo'));
    if (!res) return;
    dlgS.close();
    toast(`Démo : ${res.added} ajoutée(s), ${res.updated} mise(s) à jour.`);
  });

  // ---------- Import / export ----------
  $('#btn-export').addEventListener('click', () => {
    download(`prospection-esn-${C.today()}.csv`, '﻿' + C.toCSV(prospects), 'text/csv;charset=utf-8');
  });
  $('#btn-backup').addEventListener('click', async () => {
    const data = await run(() => api('GET', 'backup'), $('#btn-backup'));
    if (data) download(`crm-nova-tech-trust-sauvegarde-${C.today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  });
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const incoming = C.fromCSV(await file.text());
    if (!incoming.length) return toast('Aucune ligne reconnue (colonne « Société » requise).');
    const res = await importList(incoming);
    if (res) toast(`Import : ${res.added} ajoutée(s), ${res.updated} mise(s) à jour.`);
  });
  $('#file-restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
      if (!Array.isArray(data.prospects)) throw new Error('format');
    } catch (err) {
      return toast('Fichier de sauvegarde invalide.');
    }
    if (!confirm(`Remplacer les ${prospects.length} société(s) de la base par les ${data.prospects.length} de la sauvegarde ?`)) return;
    const res = await run(() => api('POST', 'restore', data));
    if (!res) return;
    prospects = res.prospects.map(C.normalize);
    settings = Object.assign({}, C.DEFAULT_SETTINGS, res.settings);
    render();
    loadRecent();
    toast('Sauvegarde restaurée.');
  });

  // ---------- Événements ----------
  $('#btn-add').addEventListener('click', () => openProspect(null));
  ['#f-search', '#f-status', '#f-signal', '#f-response'].forEach((s) => $(s).addEventListener('input', () => renderTable(withStatus())));

  $$('#table th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : 1 };
    renderTable(withStatus());
  }));

  async function markToday(id, changes, msg, btn) {
    const res = await run(() => api('PUT', `prospects/${encodeURIComponent(id)}`, changes), btn);
    if (!res) return;
    upsertLocal(res.prospect);
    render();
    loadRecent();
    toast(msg);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-edit],[data-followup],[data-sent],[data-status],#table tbody tr');
    if (!t) return;
    if (t.dataset.followup) {
      const p = prospects.find((x) => x.id === t.dataset.followup);
      if (p) markToday(p.id, { followUps: (p.followUps || 0) + 1, lastFollowUpAt: C.today() }, 'Relance enregistrée.', t);
    } else if (t.dataset.sent) {
      const p = prospects.find((x) => x.id === t.dataset.sent);
      if (p) markToday(p.id, { messageSentAt: C.today(), channel: p.channel || 'LinkedIn' }, 'Message marqué envoyé.', t);
    } else if (t.dataset.status) {
      $('#f-status').value = t.dataset.status;
      renderTable(withStatus());
      $('#table').scrollIntoView({ behavior: 'smooth' });
    } else if (t.dataset.edit) {
      e.preventDefault();
      openProspect(t.dataset.edit);
    } else if (t.dataset.id && !e.target.closest('a,button')) {
      openProspect(t.dataset.id);
    }
  });

  // ---------- Thème ----------
  const THEMES = [['auto', 'auto'], ['light', 'clair'], ['dark', 'sombre']];
  function currentTheme() {
    return document.documentElement.dataset.theme || 'auto';
  }
  function applyTheme(t) {
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      if (t === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch (e) { /* préférence non mémorisée */ }
    $('#btn-theme').textContent = 'Thème : ' + THEMES.find(([k]) => k === t)[1];
  }
  $('#btn-theme').addEventListener('click', () => {
    const i = THEMES.findIndex(([k]) => k === currentTheme());
    applyTheme(THEMES[(i + 1) % THEMES.length][0]);
  });

  // ---------- Connexion ----------
  function showLogin(msg) {
    $('#loading').hidden = true;
    $('#app').hidden = true;
    $('#login').hidden = false;
    $$('dialog[open]').forEach((d) => d.close());
    if (msg) $('#login-msg').textContent = msg;
    $('#form-login').elements.password.focus();
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    const btn = $('button[type=submit]', e.target);
    err.hidden = true;
    btn.disabled = true;
    try {
      await api('POST', 'login', { password: e.target.elements.password.value });
      e.target.reset();
      await start();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await run(() => api('POST', 'logout', {}));
    prospects = [];
    showLogin('Vous êtes déconnecté.');
  });

  // ---------- Données de l'ancienne version (navigateur) ----------
  function legacyData() {
    try {
      const list = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      return Array.isArray(list) ? list.filter((p) => p && p.company) : [];
    } catch (e) {
      return [];
    }
  }
  function checkLegacy() {
    const list = legacyData();
    $('#local-banner').hidden = !list.length;
    $('#local-banner-text').textContent =
      `${list.length} société(s) sont encore enregistrées dans ce navigateur (ancienne version). Les importer dans la base partagée ?`;
  }
  function forgetLegacy() {
    try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* rien à nettoyer */ }
    checkLegacy();
  }
  $('#btn-local-import').addEventListener('click', async () => {
    const res = await importList(legacyData().map(C.normalize), $('#btn-local-import'));
    if (!res) return;
    forgetLegacy();
    toast(`Import : ${res.added} ajoutée(s), ${res.updated} mise(s) à jour.`);
  });
  $('#btn-local-dismiss').addEventListener('click', () => {
    if (confirm('Supprimer définitivement ces données du navigateur sans les importer ?')) forgetLegacy();
  });

  // ---------- Initialisation ----------
  async function start() {
    try {
      await loadAll();
    } catch (e) {
      if (e instanceof AuthError) return;
      $('#loading').textContent = e.message;
      $('#loading').hidden = false;
      return;
    }
    $('#loading').hidden = true;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#btn-logout').hidden = !!start.authDisabled;
    checkLegacy();
    started = true;
  }

  // Rafraîchit les données (autre onglet, autre poste) quand on revient sur la page, et chaque minute.
  async function refresh() {
    if (!started || $('#app').hidden || document.hidden || $$('dialog[open]').length) return;
    try {
      await loadAll();
    } catch (e) { /* nouvel essai au prochain rafraîchissement */ }
  }
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 60000);

  $$('select[data-options]', form).forEach((s) => { s.innerHTML = options(C[s.dataset.options], !('noEmpty' in s.dataset)); });
  $('#f-status').innerHTML += options(C.STATUSES);
  $('#f-signal').innerHTML += options(C.SIGNAL_TYPES);
  $('#f-response').innerHTML += options(C.RESPONSES);
  applyTheme(currentTheme());

  (async function init() {
    try {
      const s = await api('GET', 'session');
      start.authDisabled = s.authDisabled;
      if (!s.configured) return showLogin('Mot de passe non configuré : ajoutez APP_PASSWORD dans les variables d\'environnement Vercel.');
      if (!s.authenticated) return showLogin();
      await start();
    } catch (e) {
      $('#loading').textContent = e.message;
    }
  })();
})();
