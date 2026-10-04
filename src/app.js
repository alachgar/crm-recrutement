/* Interface du CRM (navigateur). La logique métier est dans logic.js (window.CRM). */
(function () {
  'use strict';
  const C = window.CRM;
  const STORE_KEY = 'crm-esn-prospects-v1';
  const SETTINGS_KEY = 'crm-esn-settings-v1';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  let prospects = load(STORE_KEY, []).map(C.normalize);
  let settings = Object.assign({}, C.DEFAULT_SETTINGS, load(SETTINGS_KEY, {}));
  let sort = { key: 'status', dir: 1 };

  // ---------- Persistance ----------
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(prospects));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      toast('Impossible d\'enregistrer localement : pensez à exporter vos données.');
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
    updateSizeHint();
    dlg.showModal();
    form.elements.company.focus();
  }

  function updateSizeHint() {
    const n = parseInt(form.elements.headcount.value, 10);
    const hint = $('#size-hint');
    if (Number.isNaN(n)) hint.textContent = `Cible : ${settings.sizeMin}–${settings.sizeMax} salariés.`;
    else if (n < settings.sizeMin || n > settings.sizeMax) hint.textContent = `⚠ Hors cible (${settings.sizeMin}–${settings.sizeMax} salariés).`;
    else hint.textContent = '✓ Dans la cible.';
  }

  form.addEventListener('submit', (e) => {
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
    const idx = prospects.findIndex((p) => p.id === data.id);
    if (idx >= 0) {
      prospects[idx] = C.normalize(Object.assign({}, prospects[idx], data, { updatedAt: C.today() }));
    } else {
      delete data.id;
      prospects.push(C.normalize(data));
    }
    save();
    dlg.close();
    render();
    toast('Enregistré.');
  });

  form.elements.headcount.addEventListener('input', updateSizeHint);
  $('#btn-cancel').addEventListener('click', () => dlg.close());
  $('#btn-delete').addEventListener('click', () => {
    const id = form.elements.id.value;
    const p = prospects.find((x) => x.id === id);
    if (p && confirm(`Supprimer « ${p.company} » ?`)) {
      prospects = prospects.filter((x) => x.id !== id);
      save();
      dlg.close();
      render();
    }
  });

  // ---------- Réglages ----------
  const dlgS = $('#dlg-settings');
  const formS = $('#form-settings');
  $('#btn-settings').addEventListener('click', () => {
    for (const k of Object.keys(C.DEFAULT_SETTINGS)) formS.elements[k].value = settings[k];
    dlgS.showModal();
  });
  $('#btn-settings-cancel').addEventListener('click', () => dlgS.close());
  formS.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const k of Object.keys(C.DEFAULT_SETTINGS)) {
      const v = parseInt(formS.elements[k].value, 10);
      settings[k] = Number.isNaN(v) ? C.DEFAULT_SETTINGS[k] : v;
    }
    save();
    dlgS.close();
    render();
  });
  $('#btn-demo').addEventListener('click', async () => {
    if (prospects.length && !confirm('Ajouter les données de démo à vos données existantes ?')) return;
    try {
      const res = await fetch('data/demo.csv');
      const { list, added, updated } = C.merge(prospects, C.fromCSV(await res.text()));
      prospects = list;
      save();
      dlgS.close();
      render();
      toast(`Démo : ${added} ajoutée(s), ${updated} mise(s) à jour.`);
    } catch (err) {
      toast('Impossible de charger data/demo.csv (ouvrez l\'app via un serveur local).');
    }
  });

  // ---------- Import / export ----------
  $('#btn-export').addEventListener('click', () => {
    download(`prospection-esn-${C.today()}.csv`, '﻿' + C.toCSV(prospects), 'text/csv;charset=utf-8');
  });
  $('#btn-backup').addEventListener('click', () => {
    download(`crm-esn-sauvegarde-${C.today()}.json`, JSON.stringify({ settings, prospects }, null, 2), 'application/json');
  });
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const incoming = C.fromCSV(await file.text());
    if (!incoming.length) return toast('Aucune ligne reconnue (colonne « Société » requise).');
    const { list, added, updated } = C.merge(prospects, incoming);
    prospects = list;
    save();
    render();
    toast(`Import : ${added} ajoutée(s), ${updated} mise(s) à jour.`);
  });
  $('#file-restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.prospects)) throw new Error('format');
      if (!confirm(`Remplacer les ${prospects.length} société(s) actuelles par les ${data.prospects.length} de la sauvegarde ?`)) return;
      prospects = data.prospects.map(C.normalize);
      settings = Object.assign({}, C.DEFAULT_SETTINGS, data.settings);
      save();
      render();
      toast('Sauvegarde restaurée.');
    } catch (err) {
      toast('Fichier de sauvegarde invalide.');
    }
  });

  // ---------- Événements ----------
  $('#btn-add').addEventListener('click', () => openProspect(null));
  ['#f-search', '#f-status', '#f-signal', '#f-response'].forEach((s) => $(s).addEventListener('input', () => renderTable(withStatus())));

  $$('#table th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : 1 };
    renderTable(withStatus());
  }));

  function markToday(id, fn) {
    const p = prospects.find((x) => x.id === id);
    if (!p) return;
    fn(p);
    p.updatedAt = C.today();
    save();
    render();
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-edit],[data-followup],[data-sent],[data-status],#table tbody tr');
    if (!t) return;
    if (t.dataset.followup) {
      markToday(t.dataset.followup, (p) => { p.followUps = (p.followUps || 0) + 1; p.lastFollowUpAt = C.today(); });
      toast('Relance enregistrée.');
    } else if (t.dataset.sent) {
      markToday(t.dataset.sent, (p) => { p.messageSentAt = C.today(); p.channel = p.channel || 'LinkedIn'; });
      toast('Message marqué envoyé.');
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

  // ---------- Initialisation ----------
  $$('select[data-options]', form).forEach((s) => { s.innerHTML = options(C[s.dataset.options], !('noEmpty' in s.dataset)); });
  $('#f-status').innerHTML += options(C.STATUSES);
  $('#f-signal').innerHTML += options(C.SIGNAL_TYPES);
  $('#f-response').innerHTML += options(C.RESPONSES);
  render();
})();
