// K2K : positions des institutions d'après le rapport COT de la CFTC (publié chaque vendredi, données du mardi).
(function (root) {
  'use strict';

  const BASE = 'https://publicreporting.cftc.gov/resource/';
  // Disaggregated (matières premières) et TFF (financiers), « futures only ».
  const DATASETS = { disagg: '72hh-3qpy', tff: 'gpe5-46if' };

  const MARKETS = {
    XAUUSD: {
      label: 'Or (COMEX)', code: '088691', dataset: 'disagg',
      groups: [
        { id: 'banks', name: 'Banques (swap dealers)', long: 'swap_positions_long', short: 'swap_positions_short' },
        { id: 'funds', name: 'Fonds (managed money)', long: 'm_money_positions_long', short: 'm_money_positions_short' },
        { id: 'prod', name: 'Producteurs', long: 'prod_merc_positions_long', short: 'prod_merc_positions_short' },
      ],
    },
    NAS100: {
      label: 'E-mini Nasdaq-100 (CME)', code: '209742', dataset: 'tff',
      groups: [
        { id: 'banks', name: 'Banques (dealers)', long: 'dealer_positions_long', short: 'dealer_positions_short' },
        { id: 'funds', name: 'Gérants d\'actifs', long: 'asset_mgr_positions_long', short: 'asset_mgr_positions_short' },
        { id: 'hedge', name: 'Hedge funds', long: 'lev_money_positions_long', short: 'lev_money_positions_short' },
      ],
    },
    BTC: {
      label: 'Bitcoin (CME)', code: '133741', dataset: 'tff',
      groups: [
        { id: 'banks', name: 'Banques (dealers)', long: 'dealer_positions_long', short: 'dealer_positions_short' },
        { id: 'funds', name: 'Gérants d\'actifs', long: 'asset_mgr_positions_long', short: 'asset_mgr_positions_short' },
        { id: 'hedge', name: 'Hedge funds', long: 'lev_money_positions_long', short: 'lev_money_positions_short' },
      ],
    },
  };

  // Les noms de colonnes de la CFTC varient (« swap__positions_short_all », « asset_mgr_positions_long »…) :
  // on retrouve la colonne par son préfixe, en ignorant les underscores doublés et les variantes _old / _other.
  function pick(row, prefix) {
    const norm = k => k.replace(/_+/g, '_');
    const keys = Object.keys(row).filter(k => norm(k).startsWith(prefix) && !/_(old|other)$/.test(k) && !/spread/.test(k));
    const best = keys.find(k => /_all$/.test(k)) || keys[0];
    return best ? Number(row[best]) : NaN;
  }

  function dateOf(row) {
    const k = Object.keys(row).find(k => /^report_date_as_yyyy_mm_dd/.test(k));
    return k ? row[k].slice(0, 10) : '';
  }

  async function fetchMarket(symbol, weeks) {
    const m = MARKETS[symbol];
    const url = BASE + DATASETS[m.dataset] + '.json?' + new URLSearchParams({
      $where: "cftc_contract_market_code='" + m.code + "'",
      $order: 'report_date_as_yyyy_mm_dd DESC',
      $limit: String(weeks || 156),
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error('CFTC a répondu ' + res.status);
    const rows = await res.json();
    if (!rows.length) throw new Error('Aucune donnée COT pour ' + m.label);
    return parse(symbol, rows);
  }

  function parse(symbol, rows) {
    const m = MARKETS[symbol];
    const series = rows.map(r => {
      const o = { date: dateOf(r), oi: pick(r, 'open_interest') };
      for (const g of m.groups) {
        const L = pick(r, g.long), S = pick(r, g.short);
        o[g.id] = { long: L, short: S, net: L - S };
      }
      return o;
    }).filter(o => o.date).sort((a, b) => a.date.localeCompare(b.date));
    return { symbol, market: m, series, summary: summarize(m, series) };
  }

  // Indice COT : position nette actuelle comparée aux extrêmes des 3 dernières années (0 = plus vendeur, 100 = plus acheteur).
  function cotIndex(values) {
    const min = Math.min(...values), max = Math.max(...values);
    return max === min ? 50 : Math.round((values[values.length - 1] - min) / (max - min) * 100);
  }

  function summarize(m, s) {
    const last = s[s.length - 1], prev = s[s.length - 2], ago4 = s[Math.max(0, s.length - 5)];
    const groups = m.groups.map(g => {
      const nets = s.map(x => x[g.id].net);
      return {
        id: g.id, name: g.name,
        net: last[g.id].net, long: last[g.id].long, short: last[g.id].short,
        week: prev ? last[g.id].net - prev[g.id].net : 0,
        month: last[g.id].net - ago4[g.id].net,
        index: cotIndex(nets),
      };
    });
    // Biais institutionnel : on suit les fonds spéculatifs (managed money / gérants), qui portent la tendance.
    const lead = groups.find(g => g.id === 'funds');
    let bias = 0;
    if (lead.index >= 80) bias += 40; else if (lead.index <= 20) bias -= 40; else bias += (lead.index - 50) * 0.8;
    bias += Math.sign(lead.month) * 30 + Math.sign(lead.week) * 15;
    bias = Math.max(-100, Math.min(100, Math.round(bias)));
    return { date: last.date, oi: last.oi, groups, bias };
  }

  const api = { MARKETS, fetchMarket, parse, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.COT = api;
})(typeof self !== 'undefined' ? self : this);
