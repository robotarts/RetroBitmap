'use strict';
/* =========================================================================
   Physics Lab — shared helpers
   ========================================================================= */

const COLOR = {
  series1: getCss('--series-1'), series2: getCss('--series-2'),
  series3: getCss('--series-3'), series4: getCss('--series-4'),
  text: getCss('--text-primary'), sub: getCss('--text-secondary'),
  muted: getCss('--text-muted'), grid: getCss('--grid'),
  baseline: getCss('--baseline'), surface: getCss('--surface-1'),
  good: getCss('--status-good'), warn: getCss('--status-warning'),
};
function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}
// Colors are read once; re-read on theme change so charts follow light/dark.
function refreshColors() {
  COLOR.series1 = getCss('--series-1'); COLOR.series2 = getCss('--series-2');
  COLOR.series3 = getCss('--series-3'); COLOR.series4 = getCss('--series-4');
  COLOR.text = getCss('--text-primary'); COLOR.sub = getCss('--text-secondary');
  COLOR.muted = getCss('--text-muted'); COLOR.grid = getCss('--grid');
  COLOR.baseline = getCss('--baseline'); COLOR.surface = getCss('--surface-1');
  COLOR.good = getCss('--status-good'); COLOR.warn = getCss('--status-warning');
}
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    refreshColors();
    redrawAll();
  });
}

function fmt(n, d) {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Sets up a canvas for crisp rendering at devicePixelRatio; returns a state
 *  object {ctx, w, h}. Calls onResize(ctx, w, h) on every resize *except* the
 *  very first, synchronous one — at that point the caller's own `const cv =
 *  makeCanvas(...)` hasn't finished assigning yet, so a draw() that closures
 *  over `cv` would throw (TDZ). The caller does its own first draw() right
 *  after construction; later ResizeObserver callbacks fire asynchronously,
 *  by which time `cv` exists and onResize (draw) can use it safely. */
function makeCanvas(canvas, onResize) {
  const ctx = canvas.getContext('2d');
  const state = { w: 0, h: 0, ctx };
  let first = true;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.w = w; state.h = h;
    if (onResize && !first) onResize(ctx, w, h);
    first = false;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  return state;
}

/** KaTeX render with a plain-text fallback if the CDN didn't load
 *  (e.g. offline) — never leaves the box empty. */
function renderEq(el, tex, fallback) {
  try {
    if (window.katex) {
      window.katex.render(tex, el, { throwOnError: false, displayMode: true });
      return;
    }
  } catch (e) { /* fall through */ }
  el.innerHTML = '<span class="katex-fallback"></span>';
  el.querySelector('span').textContent = fallback;
}

function drawGrid(ctx, w, h, pad) {
  ctx.strokeStyle = COLOR.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cols = 6, rows = 4;
  for (let i = 0; i <= cols; i++) {
    const x = pad.l + (w - pad.l - pad.r) * (i / cols);
    ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b);
  }
  for (let j = 0; j <= rows; j++) {
    const y = pad.t + (h - pad.t - pad.b) * (j / rows);
    ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y);
  }
  ctx.stroke();
}

function clear(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLOR.surface;
  ctx.fillRect(0, 0, w, h);
}

/* ---------- tabs ---------- */
const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = {
  proj: document.getElementById('panel-proj'),
  horizon: document.getElementById('panel-horizon'),
  pursuit: document.getElementById('panel-pursuit'),
  gauss: document.getElementById('panel-gauss'),
};
let activeTab = 'proj';
tabs.forEach(btn => btn.addEventListener('click', () => {
  const id = btn.dataset.tab;
  if (id === activeTab) return;
  tabs.forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
  Object.entries(panels).forEach(([k, el]) => el.classList.toggle('on', k === id));
  activeTab = id;
  // trigger a resize/redraw for the panel that just became visible
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}));

function redrawAll() {
  if (window.__projDraw) window.__projDraw();
  if (window.__horizonDraw) window.__horizonDraw();
  if (window.__pursuitDraw) window.__pursuitDraw();
  if (window.__gaussDraw) window.__gaussDraw();
}

/* =========================================================================
   PANEL 1 — Projectile motion with altitude-dependent drag
   m dv/dt = m g - 1/2 rho(h) Cd A |v| v
   ========================================================================= */
(function projectileDemo() {
  const G = 9.81, RHO0 = 1.225, H_SCALE = 8500;
  const els = {
    v0: document.getElementById('proj-v0'), v0v: document.getElementById('proj-v0-v'),
    ang: document.getElementById('proj-ang'), angv: document.getElementById('proj-ang-v'),
    m: document.getElementById('proj-m'), mv: document.getElementById('proj-m-v'),
    cd: document.getElementById('proj-cd'), cdv: document.getElementById('proj-cd-v'),
    a: document.getElementById('proj-a'), av: document.getElementById('proj-a-v'),
    play: document.getElementById('proj-play'), reset: document.getElementById('proj-reset'),
    alt: document.getElementById('proj-alt'), spd: document.getElementById('proj-spd'), t: document.getElementById('proj-t'),
  };
  const canvas = document.getElementById('cv-proj');

  function params() {
    return {
      v0: +els.v0.value, ang: +els.ang.value * Math.PI / 180,
      mass: +els.m.value, cd: +els.cd.value / 100, area: +els.a.value / 100,
    };
  }

  function simulate(p) {
    const dt = 0.02;
    const pts = [{ x: 0, y: 0, t: 0, v: p.v0 }];
    let x = 0, y = 0, vx = p.v0 * Math.cos(p.ang), vy = p.v0 * Math.sin(p.ang), t = 0;
    const k0 = 0.5 * p.cd * p.area / p.mass;
    function deriv(s) {
      const h = Math.max(s.y, 0);
      const rho = RHO0 * Math.exp(-h / H_SCALE);
      const speed = Math.hypot(s.vx, s.vy);
      const k = k0 * rho;
      return { dx: s.vx, dy: s.vy, dvx: -k * speed * s.vx, dvy: -G - k * speed * s.vy };
    }
    for (let i = 0; i < 20000; i++) {
      const s = { x, y, vx, vy };
      const k1 = deriv(s);
      const k2 = deriv({ x: x + k1.dx * dt / 2, y: y + k1.dy * dt / 2, vx: vx + k1.dvx * dt / 2, vy: vy + k1.dvy * dt / 2 });
      const k3 = deriv({ x: x + k2.dx * dt / 2, y: y + k2.dy * dt / 2, vx: vx + k2.dvx * dt / 2, vy: vy + k2.dvy * dt / 2 });
      const k4 = deriv({ x: x + k3.dx * dt, y: y + k3.dy * dt, vx: vx + k3.dvx * dt, vy: vy + k3.dvy * dt });
      x += (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx) * dt / 6;
      y += (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy) * dt / 6;
      vx += (k1.dvx + 2 * k2.dvx + 2 * k3.dvx + k4.dvx) * dt / 6;
      vy += (k1.dvy + 2 * k2.dvy + 2 * k3.dvy + k4.dvy) * dt / 6;
      t += dt;
      if (y < 0) { y = 0; pts.push({ x, y, t, v: Math.hypot(vx, vy) }); break; }
      pts.push({ x, y, t, v: Math.hypot(vx, vy) });
    }
    return pts;
  }

  function vacuumTrajectory(p, xMax, n) {
    const g = G, v0 = p.v0, th = p.ang;
    const rangeVac = (v0 * v0 * Math.sin(2 * th)) / g;
    const pts = [];
    const maxX = Math.min(xMax, rangeVac);
    for (let i = 0; i <= n; i++) {
      const x = maxX * (i / n);
      const y = x * Math.tan(th) - (g * x * x) / (2 * v0 * v0 * Math.cos(th) * Math.cos(th));
      pts.push({ x, y: Math.max(y, -1) });
    }
    return { pts, range: rangeVac };
  }

  let dragPts = [], vacPts = [], bounds = { xMax: 100, yMax: 50 };
  let playing = false, animT = 0, playbackRate = 1;

  function recompute() {
    const p = params();
    dragPts = simulate(p);
    const last = dragPts[dragPts.length - 1];
    const peakAlt = dragPts.reduce((m, q) => Math.max(m, q.y), 0);
    const vac = vacuumTrajectory(p, Math.max(last.x, 10) * 1.4, 80);
    vacPts = vac.pts;
    const peakVac = vacPts.reduce((m, q) => Math.max(m, q.y), 0);
    bounds.xMax = Math.max(last.x, vac.range, 10) * 1.08;
    bounds.yMax = Math.max(peakAlt, peakVac, 5) * 1.2;
    const totalT = last.t;
    playbackRate = Math.max(1, totalT / 5.5);
    animT = 0;
  }

  function project(x, y, w, h, pad) {
    const px = pad.l + (x / bounds.xMax) * (w - pad.l - pad.r);
    const py = (h - pad.b) - (y / bounds.yMax) * (h - pad.t - pad.b);
    return [px, py];
  }

  function pathAt(pts, tCap) {
    const out = [];
    for (const q of pts) { if (q.t > tCap) break; out.push(q); }
    return out;
  }
  function sampleAt(pts, tCap) {
    let last = pts[0];
    for (const q of pts) { if (q.t > tCap) break; last = q; }
    return last;
  }

  const cv = makeCanvas(canvas, draw);
  function draw() {
    const { ctx, w, h } = cv;
    clear(ctx, w, h);
    const pad = { l: 8, r: 14, t: 14, b: 20 };
    drawGrid(ctx, w, h, pad);

    // ground
    ctx.strokeStyle = COLOR.baseline; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let [gx0, gy0] = project(0, 0, w, h, pad);
    let [gx1, gy1] = project(bounds.xMax, 0, w, h, pad);
    ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy1); ctx.stroke();

    const tCap = playing ? animT : Infinity;

    // vacuum reference (dashed, orange)
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = COLOR.series2; ctx.lineWidth = 2;
    ctx.beginPath();
    const vShown = playing ? pathAt(vacPts, tCap * (vacPts.length ? vacPts[vacPts.length - 1].t / (dragPts[dragPts.length - 1].t || 1) : 1)) : vacPts;
    vShown.forEach((q, i) => { const [x, y] = project(q.x, q.y, w, h, pad); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);

    // drag trajectory (solid, blue)
    ctx.strokeStyle = COLOR.series1; ctx.lineWidth = 2.5;
    ctx.beginPath();
    const shown = playing ? pathAt(dragPts, tCap) : dragPts;
    shown.forEach((q, i) => { const [x, y] = project(q.x, q.y, w, h, pad); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();

    // moving marker
    if (playing) {
      const s = sampleAt(dragPts, tCap);
      const [mx, my] = project(s.x, s.y, w, h, pad);
      ctx.fillStyle = COLOR.series1;
      ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
      els.alt.textContent = fmt(s.y, 0) + ' m';
      els.spd.textContent = fmt(s.v, 0) + ' m/s';
      els.t.textContent = fmt(s.t, 1) + ' s';
    }
  }
  window.__projDraw = draw;

  function tick(dt) {
    if (!playing) return;
    animT += dt * playbackRate;
    const totalT = dragPts[dragPts.length - 1].t;
    if (animT >= totalT) {
      animT = totalT;
      playing = false;
      els.play.textContent = '▶ 발사';
    }
    draw();
  }
  window.__projTick = () => activeTab === 'proj' && tick(lastDt);

  els.play.addEventListener('click', () => {
    if (playing) { playing = false; els.play.textContent = '▶ 발사'; draw(); return; }
    recompute();
    playing = true;
    els.play.textContent = '⏸ 진행 중';
  });
  els.reset.addEventListener('click', () => {
    playing = false; els.play.textContent = '▶ 발사'; animT = 0;
    els.alt.textContent = '0 m'; els.spd.textContent = '0 m/s'; els.t.textContent = '0.0 s';
    recompute(); draw();
  });

  [['v0', v => v + ' m/s'], ['ang', v => v + '°'], ['m', v => v + ' kg'],
   ['cd', v => (v / 100).toFixed(2)], ['a', v => (v / 100).toFixed(2) + ' m²']]
    .forEach(([key, f]) => {
      els[key].addEventListener('input', () => {
        els[key + 'v'].textContent = f(+els[key].value);
        if (!playing) { recompute(); draw(); }
      });
    });

  renderEq(document.getElementById('eq-proj'),
    'm\\frac{d\\vec v}{dt} = m\\vec g - \\tfrac12\\rho(h)\\,C_d A\\,|\\vec v|\\,\\vec v \\qquad \\rho(h)=\\rho_0 e^{-h/H}',
    'm dv/dt = mg − ½ρ(h) Cd A |v| v ,  ρ(h) = ρ₀ e^(−h/H)');

  recompute(); draw();
})();

/* =========================================================================
   PANEL 2 — Horizon distance over a curved surface + echo attenuation
   D = sqrt(2 Re h1) + sqrt(2 Re h2)         (Re, h in km -> D in km)
   P ∝ sigma / R^4  (generic inverse-fourth-power echo/reflection falloff)
   ========================================================================= */
(function horizonDemo() {
  const els = {
    h1: document.getElementById('hz-h1'), h1v: document.getElementById('hz-h1-v'),
    h2: document.getElementById('hz-h2'), h2v: document.getElementById('hz-h2-v'),
    D: document.getElementById('hz-D'),
    sigma: document.getElementById('hz-sigma'), sigmav: document.getElementById('hz-sigma-v'),
  };
  let Re = 6371; // km
  document.querySelectorAll('#planet-seg .segbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#planet-seg .segbtn').forEach(b => b.classList.toggle('on', b === btn));
      Re = +btn.dataset.re;
      draw(); drawEcho();
    });
  });

  const canvas = document.getElementById('cv-horizon');
  const cv = makeCanvas(canvas, draw);
  const echoCanvas = document.getElementById('cv-echo');
  const ecv = makeCanvas(echoCanvas, drawEcho);

  function heightPx(h_m, maxPx) {
    // sqrt scale so a 500m tower and a 20,000m object both stay legible
    return Math.min(maxPx, maxPx * Math.sqrt(h_m / 20000));
  }

  function draw() {
    const { ctx, w, h } = cv;
    clear(ctx, w, h);
    const h1 = +els.h1.value, h2 = +els.h2.value;
    const D = Math.sqrt(2 * Re * (h1 / 1000)) + Math.sqrt(2 * Re * (h2 / 1000));
    els.D.textContent = fmt(D, 1) + ' km';

    const baseY = h - 34, marginX = 46;
    const sagitta = Math.min(h - 56, (h - 34) * 0.62 * (6371 / Re)); // more curvature for smaller bodies
    const towerMaxPx = Math.max(30, h - sagitta - 46);

    // curved surface (parabolic approximation of the arc, purely illustrative)
    ctx.strokeStyle = COLOR.baseline; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const x = marginX + (w - 2 * marginX) * (i / 60);
      const u = (i / 60) * 2 - 1;
      const y = baseY - sagitta * (1 - u * u);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = COLOR.grid;
    ctx.beginPath();
    ctx.moveTo(marginX, baseY - sagitta);
    for (let i = 0; i <= 60; i++) {
      const x = marginX + (w - 2 * marginX) * (i / 60);
      const u = (i / 60) * 2 - 1;
      const y = baseY - sagitta * (1 - u * u);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w - marginX, h); ctx.lineTo(marginX, h); ctx.closePath(); ctx.fill();

    // tangent / split point between the towers, weighted by sqrt(h1):sqrt(h2)
    const s1 = Math.sqrt(Math.max(h1, 1)), s2 = Math.sqrt(Math.max(h2, 1));
    const frac = s1 / (s1 + s2);
    const tx = marginX + (w - 2 * marginX) * frac;
    const tu = frac * 2 - 1;
    const ty = baseY - sagitta * (1 - tu * tu);

    const ax = marginX, ay = baseY; // curve touches baseline at both ends (u=±1)
    const bx = w - marginX, by = baseY;
    const aTopY = ay - heightPx(h1, towerMaxPx);
    const bTopY = by - heightPx(h2, towerMaxPx);

    // towers
    ctx.strokeStyle = COLOR.series1; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, aTopY); ctx.stroke();
    ctx.fillStyle = COLOR.series1; ctx.beginPath(); ctx.arc(ax, aTopY, 4, 0, 7); ctx.fill();

    ctx.strokeStyle = COLOR.series3; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, bTopY); ctx.stroke();
    ctx.fillStyle = COLOR.series3; ctx.beginPath(); ctx.arc(bx, bTopY, 4, 0, 7); ctx.fill();

    // tangent line-of-sight (two segments meeting at the horizon point)
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = COLOR.series2; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(ax, aTopY); ctx.lineTo(tx, ty); ctx.lineTo(bx, bTopY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLOR.series2;
    ctx.beginPath(); ctx.arc(tx, ty, 3, 0, 7); ctx.fill();

    ctx.fillStyle = COLOR.sub; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('A', ax - 4, aTopY - 8);
    ctx.textAlign = 'right'; ctx.fillText('B', bx + 4, bTopY - 8);
    ctx.fillStyle = COLOR.muted;
    const minGap = 34;
    let labelX = tx, labelAlign = 'center';
    if (tx < ax + minGap) { labelAlign = 'left'; labelX = ax + minGap - 20; }
    else if (tx > bx - minGap) { labelAlign = 'right'; labelX = bx - minGap + 20; }
    ctx.textAlign = labelAlign;
    ctx.fillText('가시선 접점', labelX, Math.max(14, ty - 10));
  }
  window.__horizonDraw = draw;

  function drawEcho() {
    const { ctx, w, h } = ecv;
    clear(ctx, w, h);
    const pad = { l: 6, r: 8, t: 10, b: 18 };
    drawGrid(ctx, w, h, pad);
    const sigma = +els.sigma.value / 10;
    els.sigmav.textContent = sigma.toFixed(1);

    const xMin = 1, xMax = 50, yMin = -8, yMax = 0; // log10(P), normalized so sigma=10 at R=1 -> P=1
    function toXY(R, sigmaVal) {
      const logP = Math.log10(sigmaVal) - 4 * Math.log10(R) - Math.log10(10); // normalize vs reference sigma=10
      const px = pad.l + (w - pad.l - pad.r) * ((R - xMin) / (xMax - xMin));
      const cl = Math.max(yMin, Math.min(yMax, logP));
      const py = pad.t + (h - pad.t - pad.b) * (1 - (cl - yMin) / (yMax - yMin));
      return [px, py];
    }
    function plot(sigmaVal, color, dashed) {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const R = xMin + (xMax - xMin) * (i / 100);
        const [x, y] = toXY(R, sigmaVal);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    plot(10, COLOR.series2, true);   // reference sigma
    plot(sigma * 10, COLOR.series1, false); // current sigma (slider 1..10 maps to 10..100 relative)

    ctx.fillStyle = COLOR.muted; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('거리 R →  (신호세기, 로그축, σ∝반사체 크기)', pad.l, h - 4);
  }
  window.__horizonEchoDraw = drawEcho;

  els.h1.addEventListener('input', () => { els.h1v.textContent = els.h1.value + ' m'; draw(); });
  els.h2.addEventListener('input', () => { els.h2v.textContent = (+els.h2.value).toLocaleString('ko-KR') + ' m'; draw(); });
  els.sigma.addEventListener('input', drawEcho);

  renderEq(document.getElementById('eq-horizon'),
    'D=\\sqrt{2R_e h_1}+\\sqrt{2R_e h_2}',
    'D = √(2·Re·h₁) + √(2·Re·h₂)');
  renderEq(document.getElementById('eq-echo'),
    'P \\propto \\dfrac{\\sigma}{R^{4}}',
    'P ∝ σ / R⁴  (반사파 세기의 역제곱-4승 감쇠)');

  draw(); drawEcho();
})();

/* =========================================================================
   PANEL 3 — Pursuit geometry: Pure Pursuit vs Proportional Navigation
   a_c = N * Vc * lambda_dot
   ========================================================================= */
(function pursuitDemo() {
  const els = {
    play: document.getElementById('pur-play'), reset: document.getElementById('pur-reset'),
    n: document.getElementById('pur-n'), nv: document.getElementById('pur-n-v'),
    spd: document.getElementById('pur-spd'), spdv: document.getElementById('pur-spd-v'),
    miss: document.getElementById('pur-miss'), t: document.getElementById('pur-t'),
  };
  let pathType = 'line';
  document.querySelectorAll('#pur-path-seg .segbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pur-path-seg .segbtn').forEach(b => b.classList.toggle('on', b === btn));
      pathType = btn.dataset.path;
      recompute(); draw();
    });
  });

  const TARGET_SPEED = 40; // m/s, arbitrary generic unit scale — held constant
  const WORLD = { x0: -50, y0: -50 }; // pursuer origin offset from target start

  // "Weave" needs a lookup table: heading oscillates while *speed* stays
  // pinned at TARGET_SPEED (unlike a naive "constant forward vx + independent
  // sinusoidal vy", which lets instantaneous speed balloon well past
  // TARGET_SPEED at the turn peaks and silently breaks the "pursuer is
  // faster than target" assumption the whole demo depends on).
  const WEAVE_MAX_T = 46, WEAVE_DT = 0.02;
  let weaveTable = null;
  function buildWeaveTable() {
    const table = [];
    let x = 0, y = 0;
    for (let i = 0; i * WEAVE_DT <= WEAVE_MAX_T; i++) {
      const t = i * WEAVE_DT;
      const heading = 0.65 * Math.sin(0.45 * t);
      const vx = TARGET_SPEED * Math.cos(heading), vy = TARGET_SPEED * Math.sin(heading);
      table.push({ t, x, y, vx, vy });
      x += vx * WEAVE_DT; y += vy * WEAVE_DT;
    }
    return table;
  }
  function weaveSample(t) {
    if (!weaveTable) weaveTable = buildWeaveTable();
    const idx = Math.max(0, Math.min(weaveTable.length - 1, Math.round(t / WEAVE_DT)));
    return weaveTable[idx];
  }

  function targetPos(t) {
    switch (pathType) {
      case 'weave': { const s = weaveSample(t); return { x: s.x, y: s.y }; }
      case 'circle': {
        const R = 260, w = TARGET_SPEED / R;
        return { x: R * Math.sin(w * t), y: R * (1 - Math.cos(w * t)) };
      }
      default: // line — constant heading, constant speed
        return { x: TARGET_SPEED * t * 0.94, y: TARGET_SPEED * t * 0.34 };
    }
  }
  function targetVel(t, dt) {
    if (pathType === 'weave') { const s = weaveSample(t); return { vx: s.vx, vy: s.vy }; }
    const a = targetPos(t), b = targetPos(t + dt);
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  function runSim(mode, N, pursuerSpeed) {
    const dt = 0.02, maxT = 40;
    let px = WORLD.x0, py = WORLD.y0;
    let ang = Math.atan2(-py, -px); // start pointed roughly at target
    let vx = pursuerSpeed * Math.cos(ang), vy = pursuerSpeed * Math.sin(ang);
    const pts = [{ x: px, y: py, t: 0 }];
    let minMiss = Infinity, hitT = null;
    for (let i = 0; i < maxT / dt; i++) {
      const t = i * dt;
      const tp = targetPos(t), tv = targetVel(t, dt);
      const rx = tp.x - px, ry = tp.y - py;
      const dist = Math.hypot(rx, ry);
      if (dist < minMiss) minMiss = dist;
      if (dist < 4 && hitT === null) hitT = t;

      if (mode === 'pure') {
        const desiredAng = Math.atan2(ry, rx);
        let da = desiredAng - ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const maxTurn = 2.2 * dt; // rad, turn-rate limited
        ang += Math.max(-maxTurn, Math.min(maxTurn, da));
        vx = pursuerSpeed * Math.cos(ang); vy = pursuerSpeed * Math.sin(ang);
      } else {
        const vrelx = tv.vx - vx, vrely = tv.vy - vy;
        const r2 = rx * rx + ry * ry || 1e-6;
        const Vc = -(rx * vrelx + ry * vrely) / Math.sqrt(r2);
        const lambdaDot = (rx * vrely - ry * vrelx) / r2;
        // clamp: raw a_c = N*Vc*lambdaDot diverges as r->0 (lambdaDot ~ 1/r
        // near intercept) — a real seeker/airframe has a max-g limit, so cap
        // the command the same way rather than let Euler integration blow up.
        const maxAccel = pursuerSpeed * 8;
        const aCmd = Math.max(-maxAccel, Math.min(maxAccel, N * Vc * lambdaDot));
        const speed = Math.hypot(vx, vy) || pursuerSpeed;
        const nx = -vy / speed, ny = vx / speed; // left-normal of velocity
        vx += nx * aCmd * dt; vy += ny * aCmd * dt;
        const s = Math.hypot(vx, vy) || 1;
        vx = vx / s * pursuerSpeed; vy = vy / s * pursuerSpeed;
        ang = Math.atan2(vy, vx);
      }
      px += vx * dt; py += vy * dt;
      pts.push({ x: px, y: py, t: t + dt });
      if (hitT !== null && t > hitT + 1.5) break;
    }
    return { pts, minMiss, hitT };
  }

  let pureRun, pnRun, targetPts, bounds = { xMin: -60, xMax: 300, yMin: -60, yMax: 300 };
  let playing = false, animT = 0, playbackRate = 1;

  function recompute() {
    const N = +els.n.value / 10;
    const ratio = +els.spd.value / 100;
    const pspd = TARGET_SPEED * ratio;
    pureRun = runSim('pure', N, pspd);
    pnRun = runSim('pn', N, pspd);
    const maxT = Math.max(pureRun.pts[pureRun.pts.length - 1].t, pnRun.pts[pnRun.pts.length - 1].t);
    targetPts = [];
    for (let t = 0; t <= maxT; t += 0.05) targetPts.push({ x: targetPos(t).x, y: targetPos(t).y, t });

    const all = [...pureRun.pts, ...pnRun.pts, ...targetPts];
    bounds.xMin = Math.min(...all.map(p => p.x)) - 20;
    bounds.xMax = Math.max(...all.map(p => p.x)) + 20;
    bounds.yMin = Math.min(...all.map(p => p.y)) - 20;
    bounds.yMax = Math.max(...all.map(p => p.y)) + 20;
    playbackRate = Math.max(1, maxT / 7);
    animT = 0;
  }

  function proj(x, y, w, h, pad) {
    const spanX = bounds.xMax - bounds.xMin || 1, spanY = bounds.yMax - bounds.yMin || 1;
    const scale = Math.min((w - pad.l - pad.r) / spanX, (h - pad.t - pad.b) / spanY);
    const drawW = spanX * scale, drawH = spanY * scale;
    const ox = pad.l + ((w - pad.l - pad.r) - drawW) / 2;
    const oy = pad.t + ((h - pad.t - pad.b) - drawH) / 2;
    return [ox + (x - bounds.xMin) * scale, oy + drawH - (y - bounds.yMin) * scale];
  }

  function pathAt(pts, tCap) { const out = []; for (const p of pts) { if (p.t > tCap) break; out.push(p); } return out; }
  function sampleAt(pts, tCap) { let last = pts[0]; for (const p of pts) { if (p.t > tCap) break; last = p; } return last; }

  const canvas = document.getElementById('cv-pursuit');
  const cv = makeCanvas(canvas, draw);
  function draw() {
    const { ctx, w, h } = cv;
    clear(ctx, w, h);
    const pad = { l: 10, r: 10, t: 10, b: 10 };
    drawGrid(ctx, w, h, pad);
    if (!pureRun) return;
    const tCap = playing ? animT : Infinity;

    function stroke(pts, color, dashed, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width || 2.5;
      ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.beginPath();
      const shown = playing ? pathAt(pts, tCap) : pts;
      shown.forEach((p, i) => { const [x, y] = proj(p.x, p.y, w, h, pad); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    stroke(targetPts, COLOR.series3, false, 2);
    stroke(pureRun.pts, COLOR.series2, true, 2);
    stroke(pnRun.pts, COLOR.series1, false, 2.5);

    if (playing) {
      [[targetPts, COLOR.series3], [pureRun.pts, COLOR.series2], [pnRun.pts, COLOR.series1]].forEach(([pts, color]) => {
        const s = sampleAt(pts, tCap);
        const [x, y] = proj(s.x, s.y, w, h, pad);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
      });
      els.t.textContent = fmt(Math.min(tCap, pnRun.pts[pnRun.pts.length - 1].t), 1) + ' s';
      const curMiss = Math.min(
        Math.hypot(sampleAt(pnRun.pts, tCap).x - sampleAt(targetPts, tCap).x, sampleAt(pnRun.pts, tCap).y - sampleAt(targetPts, tCap).y)
      );
      els.miss.textContent = fmt(curMiss, 1) + ' m (PN)';
    }
  }
  window.__pursuitDraw = draw;

  function tick(dt) {
    if (!playing) return;
    animT += dt * playbackRate;
    const maxT = Math.max(pureRun.pts[pureRun.pts.length - 1].t, pnRun.pts[pnRun.pts.length - 1].t);
    if (animT >= maxT) {
      animT = maxT; playing = false; els.play.textContent = '▶ 시작';
      els.miss.textContent = 'PN ' + fmt(pnRun.minMiss, 1) + ' m · 단순추적 ' + fmt(pureRun.minMiss, 1) + ' m';
    }
    draw();
  }
  window.__pursuitTick = () => activeTab === 'pursuit' && tick(lastDt);

  els.play.addEventListener('click', () => {
    if (playing) { playing = false; els.play.textContent = '▶ 시작'; draw(); return; }
    recompute(); playing = true; els.play.textContent = '⏸ 진행 중';
  });
  els.reset.addEventListener('click', () => {
    playing = false; els.play.textContent = '▶ 시작'; animT = 0;
    els.miss.textContent = '— m'; els.t.textContent = '0.0 s';
    recompute(); draw();
  });
  els.n.addEventListener('input', () => { els.nv.textContent = (+els.n.value / 10).toFixed(1); if (!playing) { recompute(); draw(); } });
  els.spd.addEventListener('input', () => { els.spdv.textContent = (+els.spd.value / 100).toFixed(1) + '×'; if (!playing) { recompute(); draw(); } });

  renderEq(document.getElementById('eq-pursuit'),
    '\\vec a_c = N\\,V_c\\,\\dot\\lambda',
    'a_c = N · Vc · λ̇  (항법상수 × 접근속도 × 시선각변화율)');

  recompute(); draw();
})();

/* =========================================================================
   PANEL 4 — Gaussian precision model
   P(d) = exp( -d^2 / (2 sigma^2) )
   ========================================================================= */
(function gaussDemo() {
  const els = {
    sigma: document.getElementById('ga-sigma'), sigmav: document.getElementById('ga-sigma-v'),
    r50: document.getElementById('ga-r50'),
    reroll: document.getElementById('ga-reroll'),
    rate: document.getElementById('ga-rate'), rateTheory: document.getElementById('ga-rate-theory'),
  };
  const xMax = 350;

  function sigma() { return +els.sigma.value; }

  const canvas = document.getElementById('cv-gauss');
  const cv = makeCanvas(canvas, draw);
  function draw() {
    const { ctx, w, h } = cv;
    clear(ctx, w, h);
    const pad = { l: 8, r: 10, t: 12, b: 18 };
    drawGrid(ctx, w, h, pad);
    const s = sigma();
    els.sigmav.textContent = s.toFixed(1) + ' m';
    const r50 = s * Math.sqrt(2 * Math.LN2);
    els.r50.textContent = fmt(r50, 1) + ' m';

    function toXY(d, p) {
      const x = pad.l + (w - pad.l - pad.r) * (d / xMax);
      const y = (h - pad.b) - (h - pad.t - pad.b) * p;
      return [x, y];
    }
    // P = 0.5 reference line
    ctx.setLineDash([5, 4]); ctx.strokeStyle = COLOR.warn; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let [lx0, ly0] = toXY(0, 0.5), [lx1, ly1] = toXY(xMax, 0.5);
    ctx.moveTo(lx0, ly0); ctx.lineTo(lx1, ly1); ctx.stroke();
    ctx.beginPath();
    const [rx, ry0] = toXY(r50, 0), [, ry1] = toXY(r50, 1);
    ctx.moveTo(rx, ry0); ctx.lineTo(rx, ry1); ctx.stroke();
    ctx.setLineDash([]);

    // Gaussian curve
    ctx.strokeStyle = COLOR.series1; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const d = xMax * (i / 200);
      const p = Math.exp(-(d * d) / (2 * s * s));
      const [x, y] = toXY(d, p);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = COLOR.warn; ctx.beginPath(); ctx.arc(rx, ry1, 4, 0, 7); ctx.fill();
  }
  window.__gaussDraw = draw;

  /* ---- target board scatter ---- */
  const boardCanvas = document.getElementById('cv-board');
  const bcv = makeCanvas(boardCanvas, drawBoard);
  let shots = [];
  function boxMuller() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function reroll() {
    const s = sigma();
    shots = [];
    for (let i = 0; i < 200; i++) shots.push({ x: boxMuller() * s, y: boxMuller() * s });
    drawBoard();
  }
  function drawBoard() {
    const { ctx, w, h } = bcv;
    clear(ctx, w, h);
    const s = sigma();
    const r50 = s * Math.sqrt(2 * Math.LN2);
    const cx = w / 2, cy = h / 2;
    const worldMax = Math.max(r50 * 2.6, 40);
    const scale = Math.min(w, h) / 2 / worldMax * 0.92;

    // rings
    ctx.strokeStyle = COLOR.grid; ctx.lineWidth = 1;
    [1, 2, 3].forEach(k => { ctx.beginPath(); ctx.arc(cx, cy, r50 * k * scale, 0, 7); ctx.stroke(); });
    ctx.strokeStyle = COLOR.warn; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r50 * scale, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COLOR.muted; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 7); ctx.fill();

    let hits = 0;
    shots.forEach(pt => {
      const d = Math.hypot(pt.x, pt.y);
      const good = d <= r50;
      if (good) hits++;
      ctx.fillStyle = good ? COLOR.good : COLOR.muted;
      ctx.globalAlpha = good ? 0.9 : 0.5;
      ctx.beginPath(); ctx.arc(cx + pt.x * scale, cy - pt.y * scale, 3.2, 0, 7); ctx.fill();
    });
    ctx.globalAlpha = 1;

    const rate = shots.length ? hits / shots.length : 0;
    els.rate.textContent = (rate * 100).toFixed(1) + '%';
    els.rateTheory.textContent = '50.0%';
  }
  window.__gaussBoardDraw = drawBoard;

  els.sigma.addEventListener('input', () => { draw(); drawBoard(); });
  els.reroll.addEventListener('click', reroll);

  renderEq(document.getElementById('eq-gauss'),
    'P(d) = \\exp\\!\\left(-\\dfrac{d^2}{2\\sigma^2}\\right)',
    'P(d) = exp( −d² / (2σ²) )');

  reroll(); draw();
})();

/* =========================================================================
   Global animation loop (drives only proj/pursuit "play" ticks)
   ========================================================================= */
let lastDt = 0, lastTs = null;
function raf(ts) {
  if (lastTs === null) lastTs = ts;
  lastDt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;
  if (window.__projTick) window.__projTick();
  if (window.__pursuitTick) window.__pursuitTick();
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
