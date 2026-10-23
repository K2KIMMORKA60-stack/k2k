// K2K : robot d'alertes. Toutes les 5 minutes (GitHub Actions), il relit les bougies 4h et 1h et envoie un message
// Telegram dès qu'un order block encore valide est touché (avec le niveau touché), avec un lien qui ouvre le graphique dans TradingView.
// Secrets GitHub : TELEGRAM_TOKEN (obligatoire), TELEGRAM_CHAT_ID (facultatif : sinon, le dernier chat qui a écrit au bot).
'use strict';
const fs = require('fs');
const path = require('path');
const SMC = require('../smc.js');
const { LIVE, UNIVERSE, tvUrl } = require('../data.js');

const TFS = (process.env.ALERT_TFS || '4h,1h').split(',');
const STATE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
// Les serveurs de GitHub sont aux États-Unis, où api.binance.com refuse l'accès : on passe d'abord par le miroir public.
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

async function klines(pair, TF) {
  let err;
  for (const h of HOSTS) {
    try {
      const res = await fetch(h + '/api/v3/klines?symbol=' + pair + '&interval=' + TF + '&limit=500');
      if (!res.ok) throw new Error(h + ' a répondu ' + res.status);
      return (await res.json()).map(r => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }));
    } catch (e) { err = e; }
  }
  throw err;
}

const fmt = p => p.toFixed(p >= 1000 ? 2 : p >= 10 ? 3 : 5);

async function telegram(token, method, body) {
  const res = await fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await res.json();
  if (!j.ok) throw new Error('Telegram : ' + j.description);
  return j.result;
}

// Zones touchées : order block non invalidé dont la bougie en cours ou la précédente a traversé la zone.
// Niveau touché : le point le plus profond atteint dans la zone (le plus bas pour un achat, le plus haut pour une vente).
function touched(candles) {
  const smc = SMC.analyze(candles);
  if (!smc) return [];
  const out = [];
  for (const o of smc.orderBlocks) {
    if (o.status === 'invalidé') continue;
    const hits = candles.slice(-2).filter(k => k.low <= o.top && k.high >= o.bottom);
    if (!hits.length) continue;
    const at = o.dir > 0 ? Math.max(o.bottom, Math.min(...hits.map(k => k.low))) : Math.min(o.top, Math.max(...hits.map(k => k.high)));
    out.push({ ...o, at });
  }
  return out;
}

async function main() {
  // Le secret peut contenir tout le message de BotFather : on en extrait seulement le code (chiffres:lettres).
  const raw = process.env.TELEGRAM_TOKEN || '';
  const token = (raw.match(/\d{6,}:[A-Za-z0-9_-]{30,}/) || [raw.trim()])[0] || '';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { /* premier passage */ }
  state.sent = state.sent || {};
  let chat = process.env.TELEGRAM_CHAT_ID || state.chat;
  if (token && !chat) {
    // Pas d'identifiant fourni : on prend la personne qui a envoyé /start au bot.
    const ups = await telegram(token, 'getUpdates');
    const m = ups.reverse().find(u => u.message && u.message.chat);
    if (m) { chat = String(m.message.chat.id); state.chat = chat; }
  }
  const out = [];
  for (const TF of TFS) for (const m of UNIVERSE.filter(u => LIVE[u.sym])) {
    let c;
    try { c = await klines(LIVE[m.sym], TF); } catch (e) { console.log(m.sym, TF, 'indisponible :', e.message); continue; }
    const last = c[c.length - 1].close;
    for (const o of touched(c)) {
      const key = m.sym + '|' + TF + '|' + o.time + '|' + o.dir;
      if (state.sent[key]) continue;
      const url = tvUrl(m.sym, TF);
      const text = (o.dir > 0 ? '🟢 OB haussier touché' : '🔴 OB baissier touché') + ' — ' + m.sym + ' ' + TF + '\n'
        + 'Zone ' + fmt(o.bottom) + ' – ' + fmt(o.top) + '\n'
        + 'Touché à ' + fmt(o.at) + '\n'
        + 'Prix actuel ' + fmt(last) + '\n'
        + 'Qualité ' + '★'.repeat(o.stars || 1) + ' (' + (o.stars || 1) + '/5) · note ' + o.quality + '/100' + (m.sym === 'XAUUSD' ? ' (prix PAXG, proche de l\'or spot)' : '') + '\n'
        + url;
      out.push({ key, text, url });
    }
  }
  for (const a of out.slice(0, 10)) { // au plus 10 messages par passage, le reste part au suivant
    console.log(a.text.replace(/\n/g, ' | '));
    if (!token || !chat) continue;
    await telegram(token, 'sendMessage', {
      chat_id: chat, text: a.text, disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: 'Ouvrir dans TradingView', url: a.url }]] },
    });
    state.sent[a.key] = Date.now();
  }
  if (!token) console.log('TELEGRAM_TOKEN manquant : alertes affichées ici seulement.');
  else if (!chat) console.log('Aucun chat trouvé : envoie /start à ton bot dans Telegram.');
  // On oublie les alertes de plus de 30 jours.
  for (const k in state.sent) if (Date.now() - state.sent[k] > 30 * 864e5) delete state.sent[k];
  fs.writeFileSync(STATE, JSON.stringify(state));
}

main().catch(e => { console.error(e); process.exit(1); });
