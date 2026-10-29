// K2K : bougies de prix. BTC et or en direct via Binance (l'or via PAXG, un jeton adossé à l'once d'or),
// n'importe quel marché via un fichier exporté de MT5 ou TradingView.
(function (root) {
  'use strict';

  const LIVE = { XAUUSD: 'PAXGUSDT', BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT', EURUSD: 'EURUSDT' };
  // Univers du scanner. Seuls les marchés avec un flux Binance gratuit sont scannés en direct ;
  // NAS100 passe par un fichier importé. Forex : seul l'euro existe sur Binance (paire EUR/USDT).
  const UNIVERSE = [
    { sym: 'XAUUSD', name: 'Or', cls: 'Métaux' },
    { sym: 'BTC', name: 'Bitcoin', cls: 'Crypto' },
    { sym: 'ETH', name: 'Ethereum', cls: 'Crypto' },
    { sym: 'SOL', name: 'Solana', cls: 'Crypto' },
    { sym: 'BNB', name: 'BNB', cls: 'Crypto' },
    { sym: 'XRP', name: 'XRP', cls: 'Crypto' },
    { sym: 'EURUSD', name: 'Euro / dollar', cls: 'Forex' },
    { sym: 'NAS100', name: 'Nasdaq 100', cls: 'Indices', fileOnly: true },
  ];
  const HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

  // L'or vient d'abord du contrat perpétuel Binance XAUUSDT, qui suit l'or au comptant (comme OANDA XAUUSD)
  // à un ou deux dollars près. Si ce flux ne répond pas, K2K se rabat sur le PAXG, un jeton dont l'écart
  // avec l'or change d'un jour à l'autre (+14 $ le 26/10, −12 $ le 29/10).
  const FUT = { XAUUSD: 'XAUUSDT' };
  const FUT_HOST = 'https://fapi.binance.com';
  const used = {}, spotAt = {}; // source réellement utilisée par marché : 'fut' ou 'spot'
  const source = symbol => used[symbol] || (FUT[symbol] ? 'fut' : 'spot');
  function sourceName(symbol) {
    if (REF[symbol] && isAuto(symbol)) return 'Or au comptant · prix calé chaque minute sur le marché au comptant (comme OANDA)';
    return source(symbol) === 'fut' ? 'Binance Futures ' + FUT[symbol] + ' (or au comptant)' : 'Binance ' + LIVE[symbol] + (symbol === 'XAUUSD' ? ' (jeton adossé à l\'or, flux de secours)' : '');
  }
  // Flux en direct (WebSocket) correspondant à la source utilisée.
  function wsInfo(symbol) {
    return source(symbol) === 'fut'
      ? { pair: FUT[symbol], hosts: ['wss://fstream.binance.com'] }
      : { pair: LIVE[symbol], hosts: ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'] };
  }

  // Recalage sur le prix du courtier (bouton « Recaler ») : rapport « prix courtier / prix Binance »,
  // gardé sur l'appareil pour chaque source.
  // Or : calage automatique chaque minute sur le prix de l'or au comptant (gold-api.com, proche d'OANDA XAUUSD).
  // Les bougies gardent la forme de Binance, mais leur niveau suit l'or au comptant.
  const AUTO = {}, autoAt = {};
  const REF = { XAUUSD: 'https://api.gold-api.com/price/XAU' };
  const key = symbol => 'k2k.recal.' + symbol + (source(symbol) === 'fut' ? '.fut' : '');
  // Version 44 : les anciens recalages manuels de l'or sont effacés une fois (le calage auto les remplace).
  try { if (!localStorage.getItem('k2k.recalReset44')) { localStorage.removeItem('k2k.recal.XAUUSD'); localStorage.removeItem('k2k.recal.XAUUSD.fut'); localStorage.setItem('k2k.recalReset44', '1'); } } catch (e) { /* stockage indisponible */ }
  function stored(symbol) { try { const v = +localStorage.getItem(key(symbol)); return v > 0 ? v : null; } catch (e) { return null; } }
  function factor(symbol) { return stored(symbol) || AUTO[symbol] || 1; }
  function isAuto(symbol) { return !stored(symbol) && !!AUTO[symbol]; }
  function setFactor(symbol, v) { try { if (v > 0 && v !== 1) localStorage.setItem(key(symbol), String(v)); else localStorage.removeItem(key(symbol)); } catch (e) { /* stockage indisponible */ } }
  function scale(symbol, b) {
    const f = factor(symbol);
    if (f === 1) return b;
    return { time: b.time, open: b.open * f, high: b.high * f, low: b.low * f, close: b.close * f, volume: b.volume };
  }
  // Prix Binance brut du moment (contrat ou au comptant, selon la source utilisée).
  async function rawPrice(symbol) {
    if (source(symbol) === 'fut') {
      const r = await fetch(FUT_HOST + '/fapi/v1/ticker/price?symbol=' + FUT[symbol], { cache: 'no-store' });
      if (!r.ok) throw new Error('Binance Futures a répondu ' + r.status);
      return +(await r.json()).price;
    }
    for (const h of HOSTS) {
      try {
        const r = await fetch(h + '/api/v3/ticker/price?symbol=' + LIVE[symbol], { cache: 'no-store' });
        if (r.ok) return +(await r.json()).price;
      } catch (e) { /* hôte suivant */ }
    }
    throw new Error('Binance ne répond pas');
  }
  // Met à jour le calage automatique (au plus une fois par minute). En cas d'échec, garde le dernier calage.
  async function refreshAuto(symbol, force) {
    if (!REF[symbol] || typeof fetch === 'undefined') return;
    if (!force && Date.now() - (autoAt[symbol] || 0) < 60000) return;
    autoAt[symbol] = Date.now();
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl && setTimeout(() => ctl.abort(), 6000);
      const [refRes, raw] = await Promise.all([fetch(REF[symbol], { cache: 'no-store', signal: ctl && ctl.signal }), rawPrice(symbol)]);
      if (timer) clearTimeout(timer);
      const ref = +(await refRes.json()).price;
      const f = ref / raw;
      if (ref > 0 && raw > 0 && Math.abs(f - 1) < 0.03) AUTO[symbol] = f; // écart de plus de 3 % : donnée douteuse, ignorée
    } catch (e) { /* source de référence indisponible : on garde le dernier calage */ }
  }
  if (typeof document !== 'undefined' && typeof fetch !== 'undefined') setInterval(() => { for (const s in REF) refreshAuto(s); }, 60000);
  const toBar = r => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] });

  // Une page de bougies brutes : contrat XAUUSDT d'abord pour l'or, sinon Binance au comptant.
  async function page(symbol, interval, limit, end) {
    const q = '?interval=' + interval + '&limit=' + limit + (end ? '&endTime=' + end : '');
    // Après un échec du contrat, on retente sa lecture au bout de 10 minutes.
    if (used[symbol] === 'spot' && Date.now() - (spotAt[symbol] || 0) > 600000 && !end) delete used[symbol];
    if (FUT[symbol] && used[symbol] !== 'spot') {
      try {
        const res = await fetch(FUT_HOST + '/fapi/v1/klines' + q + '&symbol=' + FUT[symbol]);
        if (!res.ok) throw new Error('Binance Futures a répondu ' + res.status);
        const rows = await res.json();
        if (!Array.isArray(rows) || !rows.length) throw new Error('pas de bougies');
        used[symbol] = 'fut';
        return rows;
      } catch (e) {
        if (used[symbol] === 'fut' && end) return []; // historique du contrat épuisé : on s'arrête là
        used[symbol] = 'spot'; spotAt[symbol] = Date.now();
        delete AUTO[symbol]; autoAt[symbol] = 0; // la source change : le calage doit être refait
      }
    }
    let lastErr;
    for (const h of HOSTS) {
      try {
        const res = await fetch(h + '/api/v3/klines' + q + '&symbol=' + LIVE[symbol]);
        if (!res.ok) throw new Error('Binance a répondu ' + res.status);
        return await res.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  async function fetchLive(symbol, interval, limit) {
    if (!LIVE[symbol]) return null;
    const rows = await page(symbol, interval, limit || 500);
    await refreshAuto(symbol);
    return rows.map(r => scale(symbol, toBar(r)));
  }

  // Historique long (plusieurs pages de 1 000 bougies) pour mesurer les taux de réussite passés.
  async function fetchHistory(symbol, interval, total) {
    if (!LIVE[symbol]) return null;
    let out = [], end = null;
    await refreshAuto(symbol);
    while (out.length < (total || 3000)) {
      const rows = await page(symbol, interval, 1000, end);
      if (!rows.length) break;
      out = rows.map(r => scale(symbol, toBar(r))).concat(out);
      end = rows[0][0] - 1;
      if (rows.length < 1000) break;
    }
    return out;
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

  // Lien vers le même marché dans TradingView (s'ouvre dans l'appli TradingView si elle est installée).
  const TV = { XAUUSD: 'OANDA:XAUUSD', NAS100: 'OANDA:NAS100USD', BTC: 'BINANCE:BTCUSDT', ETH: 'BINANCE:ETHUSDT', SOL: 'BINANCE:SOLUSDT', BNB: 'BINANCE:BNBUSDT', XRP: 'BINANCE:XRPUSDT', EURUSD: 'OANDA:EURUSD' };
  const TV_TF = { '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' };
  const tvUrl = (sym, tf) => 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(TV[sym] || sym) + '&interval=' + (TV_TF[tf] || '60');

  const api = { LIVE, UNIVERSE, TV, tvUrl, fetchLive, fetchHistory, parseCsv, factor, isAuto, setFactor, scale, refreshAuto, source, sourceName, wsInfo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Prices = api;
})(typeof self !== 'undefined' ? self : this);
