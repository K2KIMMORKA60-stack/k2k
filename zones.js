// K2K : dessin des zones d'achat et de vente, commun au scanner et au grand graphique.
// Comme sur TradingView : OB haussier en vert, OB baissier en orange, rectangle précis de la mèche haute à la mèche basse
// de la bougie d'origine, prolongé vers la droite.
(function (root) {
  'use strict';

  const STYLE = {
    // Teintes pâles et bordure fine, comme les rectangles dessinés sur TradingView.
    buy: { fill: 'rgba(120,190,120,0.16)', stroke: 'rgba(60,120,64,0.75)', ink: '#2e7d32' },
    sell: { fill: 'rgba(240,140,120,0.16)', stroke: 'rgba(225,120,100,0.65)', ink: '#c9573a' },
    band: 3,
  };
  // Onglets « OB Touchés » (jaune) et « Réaction » (vert) : la zone concernée est surlignée.
  const HL = {
    touched: { fill: 'rgba(240,200,60,0.30)', stroke: '#d4a72c', ink: '#9a7410', suffix: ' · TOUCHÉE' },
    reaction: { fill: 'rgba(90,190,90,0.28)', stroke: '#4caf50', ink: '#2e7d32', suffix: ' ✓' },
  };

  // Niveau d'entrée d'une zone : le haut pour une zone d'achat, le bas pour une zone de vente.
  const level = o => (o.dir > 0 ? o.top : o.bottom);

  // Vraie hauteur de l'order block. uniform: true dessine plutôt une bande fine au niveau d'entrée.
  function draw(canvas, el, ch, series, obs, opts) {
    const o2 = opts || {};
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const ts = ch.timeScale();
    const plotW = r.width - series.priceScale().width();
    const labels = [];
    for (const o of obs) {
      const hl = HL[o.hl];
      let x = ts.timeToCoordinate(o.time);
      // Le rectangle part du bord gauche de la bougie d'origine.
      x = x == null ? 0 : Math.max(0, x - ts.options().barSpacing / 2);
      const st = o.dir > 0 ? STYLE.buy : STYLE.sell;
      if (x > plotW) continue;
      let y1, h;
      if (o2.uniform === true) {
        const y = series.priceToCoordinate(level(o));
        // Zone hors de l'écran : simple flèche au bord, comme sur le scanner de référence.
        if (y == null || y < 0 || y > r.height) { if (o2.labels === true) labels.push({ y: y == null || y < 0 ? 12 : r.height - 22, buy: o.dir > 0, arrow: y != null && y > r.height ? ' ▼' : ' ▲' }); continue; }
        h = STYLE.band; y1 = y - h / 2;
      } else {
        const a = series.priceToCoordinate(o.top), b = series.priceToCoordinate(o.bottom);
        if (a == null || b == null) continue;
        y1 = a; h = Math.max(STYLE.band, b - a);
      }
      ctx.fillStyle = hl ? hl.fill : st.fill; ctx.fillRect(x, y1, plotW - x, h);
      ctx.strokeStyle = hl ? hl.stroke : st.stroke; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y1) + 0.5, Math.max(1, Math.round(plotW - x) - 1), Math.round(h));
      if (o2.labels === true) labels.push({ y: y1, buy: o.dir > 0, hl, stars: o.stars });
    }
    // Étiquettes à droite, décalées si deux zones sont trop proches pour rester lisibles.
    ctx.font = '600 9px IBM Plex Mono, monospace';
    labels.sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const l of labels) {
      const y = Math.max(l.y - 3, prev + 11);
      prev = y;
      const text = (l.buy ? 'ZONE ACHAT' : 'ZONE VENTE') + (l.stars ? ' ' + '★'.repeat(l.stars) : '') + (l.hl ? l.hl.suffix : '') + (l.arrow || '');
      const w = ctx.measureText(text).width;
      const x = Math.max(2, plotW - w - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x - 3, y - 9, w + 6, 11);
      ctx.fillStyle = l.hl ? l.hl.ink : l.buy ? STYLE.buy.ink : STYLE.sell.ink;
      ctx.fillText(text, x, y);
    }
  }

  // Zones encore valides, les plus proches du prix d'abord.
  // Filtre d'étoiles choisi par l'utilisateur (5 = seulement les meilleurs), partagé par tous les écrans.
  let minStars = 5;
  try { minStars = +(localStorage.getItem('k2k.stars') || 5); } catch (e) { /* stockage indisponible */ }
  function setMinStars(v) { minStars = v; try { localStorage.setItem('k2k.stars', String(v)); } catch (e) { /* stockage indisponible */ } }

  function nearest(f, n, min) {
    const last = f.candles[f.candles.length - 1].close;
    const ms = min == null ? minStars : min;
    return f.smc.orderBlocks.filter(o => o.status !== 'invalidé' && (o.stars || 1) >= ms)
      .map(o => ({ ...o, level: level(o), dist: (last <= o.top && last >= o.bottom) ? 0 : Math.abs(level(o) - last) / last }))
      .sort((a, b) => a.dist - b.dist).slice(0, n || 5);
  }

  // Ouvre Claude (l'appli si elle est installée, sinon claude.ai) avec la question déjà écrite.
  // Le texte est aussi copié, au cas où la question n'apparaît pas toute seule.
  function askClaude(text) {
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } catch (e) { /* presse-papiers indisponible */ }
    window.open('https://claude.ai/new?q=' + encodeURIComponent(text.slice(0, 1800)), '_blank', 'noopener');
  }

  const api = { STYLE, level, draw, nearest, askClaude, setMinStars, get minStars() { return minStars; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Zones = api;
})(typeof self !== 'undefined' ? self : this);
