// K2K : journal de trading. Les trades restent sur le téléphone (stockage local du navigateur).
(function () {
  'use strict';

  const KEY = 'k2k-journal';
  const $ = id => document.getElementById(id);
  // Valeur d'un mouvement de 1 (en prix) pour 1 lot, standards MT5 ; à vérifier chez ton courtier.
  const PER = { XAUUSD: 100, NAS100: 1, BTCUSD: 1, US30: 1, EURUSD: 100000 };
  const MARKETS = ['XAUUSD', 'NAS100', 'BTCUSD'];

  // Premier trade, ajouté à la demande de Khaldor le 24/10/2026.
  const SEED = [{
    id: 't-20261024-btc', date: '2026-10-24T16:40', sym: 'BTCUSD', dir: -1, lot: 0.02,
    entry: 80305.16, sl: 80600.49, tp: 79600.28, exit: 80305.16,
    note: 'Stop remonté au break-even. Le prix est revenu et m\'a sorti à l\'entrée.',
  }];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) { save(SEED); return SEED.slice(); }
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) { return SEED.slice(); }
  }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* stockage indisponible */ } }

  let trades = load();
  let editing = null;

  const num = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
  const fmt = (v, d) => v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const digits = t => Math.max(...[t.entry, t.sl, t.tp, t.exit].filter(v => v != null).map(v => (String(v).split('.')[1] || '').length), 0);
  const money = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), 2) + ' $';
  const when = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };

  function stats(t) {
    const per = PER[t.sym] || 1;
    const pnl = t.exit != null ? (t.exit - t.entry) * t.dir * t.lot * per : null;
    const risk = t.sl != null ? Math.abs(t.entry - t.sl) * t.lot * per : null;
    const r = pnl != null && risk ? pnl / risk : null;
    const plan = t.sl != null && t.tp != null && t.entry !== t.sl ? Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl) : null;
    const out = pnl == null ? 'open' : Math.abs(r ?? 0) < 0.1 ? 'be' : pnl > 0 ? 'win' : 'loss';
    return { pnl, risk, r, plan, out };
  }
  const LABEL = { win: 'Gagné', loss: 'Perdu', be: 'Break-even', open: 'En cours' };

  function render() {
    const list = trades.slice().sort((a, b) => b.date.localeCompare(a.date));
    const all = list.map(t => ({ t, s: stats(t) }));
    const closed = all.filter(x => x.s.out !== 'open');
    const n = k => closed.filter(x => x.s.out === k).length;
    const total = closed.reduce((a, x) => a + x.s.pnl, 0);
    const decided = n('win') + n('loss');
    $('j-stats').innerHTML = [
      ['Trades', all.length],
      ['Gagnés · Perdus · BE', n('win') + ' · ' + n('loss') + ' · ' + n('be')],
      ['Réussite', decided ? Math.round(n('win') / decided * 100) + ' %' : '—'],
      ['Résultat', '<b class="' + (total > 0 ? 'up' : total < 0 ? 'down' : '') + '">' + money(total) + '</b>'],
    ].map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('');

    $('j-list').innerHTML = all.length ? all.map(({ t, s }) => {
      const d = digits(t);
      return '<li class="j-trade">' +
        '<div class="j-row"><b class="sym">' + t.sym + '</b><span class="badge ' + (t.dir > 0 ? 'buy' : 'sell') + '">' + (t.dir > 0 ? 'Achat' : 'Vente') + '</span>' +
        '<span class="badge tf">' + fmt(t.lot, 2) + ' lot</span><span class="j-out ' + s.out + '">' + LABEL[s.out] + '</span></div>' +
        '<p class="source">' + when(t.date) + '</p>' +
        '<dl class="j-levels">' +
          '<div><dt>Entrée</dt><dd>' + fmt(t.entry, d) + '</dd></div>' +
          '<div><dt>Stop</dt><dd>' + fmt(t.sl, d) + '</dd></div>' +
          '<div><dt>Objectif</dt><dd>' + fmt(t.tp, d) + '</dd></div>' +
          '<div><dt>Sortie</dt><dd>' + fmt(t.exit, d) + '</dd></div>' +
        '</dl>' +
        '<div class="j-row j-res"><b class="' + (s.pnl > 0 ? 'up' : s.pnl < 0 ? 'down' : '') + '">' + (s.pnl == null ? 'Trade ouvert' : money(s.pnl)) + '</b>' +
          (s.r != null ? '<span class="source">' + (s.r > 0.05 ? '+' : s.r < -0.05 ? '−' : '') + fmt(Math.abs(s.r), 1) + ' R</span>' : '') +
          (s.risk != null ? '<span class="source">risque ' + fmt(s.risk, 2) + ' $</span>' : '') +
          (s.plan != null ? '<span class="source">plan 1:' + fmt(s.plan, 1) + '</span>' : '') + '</div>' +
        (t.note ? '<p class="j-note">' + esc(t.note) + '</p>' : '') +
        '<div class="j-actions"><button type="button" class="j-link" data-edit="' + t.id + '">Modifier</button><button type="button" class="j-link" data-del="' + t.id + '">Supprimer</button></div>' +
      '</li>';
    }).join('') : '<li class="cards-note">Aucun trade pour l\'instant. Touche « Ajouter un trade ».</li>';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function openForm(t) {
    editing = t ? t.id : null;
    const f = $('j-form');
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    f.date.value = t ? t.date : now.toISOString().slice(0, 16);
    f.sym.value = t ? t.sym : MARKETS[0];
    f.dir.value = t ? String(t.dir) : '1';
    ['lot', 'entry', 'sl', 'tp', 'exit'].forEach(k => { f[k].value = t && t[k] != null ? String(t[k]).replace('.', ',') : ''; });
    f.note.value = t ? t.note || '' : '';
    $('j-form-title').textContent = t ? 'Modifier le trade' : 'Nouveau trade';
    f.hidden = false;
    $('j-add').hidden = true;
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeForm() { $('j-form').hidden = true; $('j-add').hidden = false; editing = null; }

  function init() {
    $('j-sym-list').innerHTML = MARKETS.map(m => '<option value="' + m + '">').join('');
    $('j-add').addEventListener('click', () => openForm(null));
    $('j-cancel').addEventListener('click', closeForm);
    $('j-form').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const t = {
        id: editing || 't-' + Date.now(), date: f.date.value, sym: f.sym.value.trim().toUpperCase(), dir: +f.dir.value,
        lot: num(f.lot.value), entry: num(f.entry.value), sl: num(f.sl.value), tp: num(f.tp.value), exit: num(f.exit.value), note: f.note.value.trim(),
      };
      if (!t.sym || t.lot == null || t.entry == null || !t.date) { $('j-error').hidden = false; return; }
      $('j-error').hidden = true;
      trades = trades.filter(x => x.id !== t.id).concat(t);
      save(trades);
      closeForm();
      render();
    });
    $('j-list').addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
      if (ed) openForm(trades.find(t => t.id === ed.dataset.edit));
      if (del && confirm('Supprimer ce trade du journal ?')) { trades = trades.filter(t => t.id !== del.dataset.del); save(trades); render(); }
    });
    render();
  }

  window.Journal = { init, render };
})();
