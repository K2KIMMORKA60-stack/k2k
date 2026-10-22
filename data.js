// K2K : bougies de prix. BTC et or en direct via Binance (l'or via PAXG, un jeton adossé à l'once d'or),
// n'importe quel marché via un fichier exporté de MT5 ou TradingView.
(function (root) {
  'use strict';

  const LIVE = { BTC: 'BTCUSDT', XAUUSD: 'PAXGUSDT' };
  const HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

  async function fetchLive(symbol, interval, limit) {
    const pair = LIVE[symbol];
    if (!pair) return null;
    let lastErr;
    for (const h of HOSTS) {
      try {
        const res = await fetch(h + '/api/v3/klines?symbol=' + pair + '&interval=' + interval + '&limit=' + (limit || 500));
        if (!res.ok) throw new Error('Binance a répondu ' + res.status);
        const rows = await res.json();
        return rows.map(r => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }));
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // Lit un export TradingView (time,open,high,low,close,Volume) ou MT5 (<DATE> <TIME> <OPEN> … <TICKVOL>).
  function parseCsv(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('Le fichier est vide.');
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    const head = lines[0].split(sep).map(h => h.replace(/[<>"]/g, '').trim().toLowerCase());
    const col = names => head.findIndex(h => names.includes(h));
    const iDate = col(['date', 'time', 'datetime', 'timestamp']);
    const iTime = head[iDate] === 'date' ? col(['time']) : -1;
    const iO = col(['open']), iH = col(['high']), iL = col(['low']), iC = col(['close']);
    const iV = col(['volume', 'tickvol', 'vol', 'tick_volume']);
    if ([iDate, iO, iH, iL, iC].some(i => i < 0)) throw new Error('Colonnes introuvables. Il faut au moins date, open, high, low, close.');
    const out = [];
    for (const line of lines.slice(1)) {
      const p = line.split(sep).map(s => s.replace(/"/g, '').trim());
      const raw = iTime >= 0 ? p[iDate] + ' ' + p[iTime] : p[iDate];
      const t = toUnix(raw);
      if (!isFinite(t)) continue;
      out.push({ time: t, open: +p[iO], high: +p[iH], low: +p[iL], close: +p[iC], volume: iV >= 0 ? +p[iV] || 0 : 0 });
    }
    out.sort((a, b) => a.time - b.time);
    const uniq = out.filter((c, i) => i === 0 || c.time !== out[i - 1].time);
    if (uniq.length < 30) throw new Error('Il faut au moins 30 bougies pour analyser.');
    return uniq.slice(-1500);
  }

  function toUnix(s) {
    if (/^\d{9,10}$/.test(s)) return +s;
    if (/^\d{12,13}$/.test(s)) return Math.floor(+s / 1000);
    const m = s.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
    if (!m) return NaN;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000);
  }

  const api = { LIVE, fetchLive, parseCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Prices = api;
})(typeof self !== 'undefined' ? self : this);
