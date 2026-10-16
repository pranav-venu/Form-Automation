const $ = s => document.querySelector(s);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ---------- storage ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
let cfg = load('cfg', { autoSubmit: false });
let profile = load('profile', {});
let account = load('account', {});
function paintAccount() {
  $('#acEmail').textContent = account.email || 'Google account';
  const d = account.at ? new Date(account.at) : null;
  $('#acTime').textContent = d ? 'Logged in at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' · ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}
profile = { displayName: profile.displayName ?? profile.name ?? '', formName: profile.formName ?? profile.name ?? '', image: profile.image || '' };
// ---------- theme (accent colour) ----------
const THEMES = [
  { id: 'sky', name: 'Sky', hex: '#7fe0ef', rgb: '127,224,239', dark: '#2a8da3' },
  { id: 'violet', name: 'Violet', hex: '#b8a1ff', rgb: '184,161,255', dark: '#6a4fd1' },
  { id: 'mint', name: 'Mint', hex: '#7ce3a6', rgb: '124,227,166', dark: '#2e9e62' },
  { id: 'rose', name: 'Rose', hex: '#ff94b5', rgb: '255,148,181', dark: '#c4416f' },
  { id: 'amber', name: 'Amber', hex: '#f2c14e', rgb: '242,193,78', dark: '#b88a1c' },
  { id: 'coral', name: 'Coral', hex: '#ff9f6e', rgb: '255,159,110', dark: '#d1692f' }
];
let themeId = load('theme', 'sky'), customHex = load('themeCustom', '#7fe0ef');
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function customTheme(hex) {
  const [r, g, b] = hexRgb(hex), lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255, k = 0.62;
  const dark = '#' + [r, g, b].map(v => Math.round(v * k).toString(16).padStart(2, '0')).join('');
  return { id: 'custom', name: 'Custom', hex, rgb: `${r},${g},${b}`, dark, on: lum > 0.6 ? '#06242b' : '#ffffff' };
}
let ACC = THEMES[0];
function applyTheme(id, persistIt) {
  ACC = id === 'custom' ? customTheme(customHex) : THEMES.find(t => t.id === id) || THEMES[0]; themeId = ACC.id;
  const r = document.documentElement.style;
  r.setProperty('--acc', ACC.rgb); r.setProperty('--teal', ACC.hex); r.setProperty('--teal-d', ACC.dark); r.setProperty('--on', ACC.on || '#06242b');
  if (persistIt) { save('theme', themeId); save('themeCustom', customHex); }
  try { window.api.themeWrite({ hex: ACC.hex, on: ACC.on || '#06242b' }); } catch {}
}
applyTheme(themeId);

let signedIn = load('signedIn', false);
let auto = load('auto', { on: false, h: 18, m: 0, lastRun: '' });
let entries = window.api.readStore() || load('entries2', {});   // { 'YYYY-MM-DD': { tasks:[{id,text,mins}], sent, sentAt } }

if (!Array.isArray(auto.days)) auto.days = [0, 1, 2, 3, 4, 5, 6];   // 0 = Sunday
if (!auto.dayWeeks) auto.dayWeeks = {};   // per weekday: which occurrences in the month (1-5, 6 = last); missing/empty = all
if (Array.isArray(auto.weeks)) { if (auto.weeks.length) auto.days.forEach(d => auto.dayWeeks[d] = auto.weeks.map(w => w === 5 ? 6 : w)); delete auto.weeks; save('auto', auto); }
if (auto.time) { const [h, m] = auto.time.split(':').map(Number); auto = { ...auto, h, m }; delete auto.time; save('auto', auto); }

// ---------- helpers ----------
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const tasksOf = k => entries[k]?.tasks || [];
const minsOf = k => tasksOf(k).reduce((s, t) => s + t.mins, 0);
const fmt = m => { const h = Math.floor(m / 60), r = Math.round(m % 60); return !m ? '0h' : !h ? `${r}m` : !r ? `${h}h` : `${h}h ${r}m`; };
const durText = m => { const h = Math.floor(m / 60), r = m % 60; const a = []; if (h) a.push(`${h} ${h === 1 ? 'Hour' : 'Hours'}`); if (r) a.push(`${r} Mins`); return a.join(' '); };
const formLines = k => tasksOf(k).map(t => `${t.text.trim().replace(/[,.]+$/, '').replace(/,/g, ' ')} - ${durText(t.mins)}`);
const persist = () => { save('entries2', entries); window.api.writeStore(entries); };
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), 2600); }

// ---------- stepper (hour / minute selector) ----------
function stepper(el, { label, max, min = 0, step = 1, wrap = false, value = 0 }) {
  el.innerHTML = `<button class="sb" data-d="-1">−</button><input class="sv" inputmode="numeric" maxlength="2"><button class="sb" data-d="1">+</button><span class="sl">${label}</span>`;
  const inp = el.querySelector('.sv'); let v = value;
  const show = () => { inp.value = pad(v); };
  const set = (n, silent) => { const size = max - min + 1; v = wrap ? ((((n - min) % size) + size) % size) + min : Math.min(max, Math.max(min, n)); show(); if (!silent) el.dispatchEvent(new Event('change')); };
  el.querySelectorAll('.sb').forEach(b => b.onclick = () => set(v + step * Number(b.dataset.d)));
  inp.onfocus = () => { inp.value = ''; };                       // click = clear, so typing starts fresh
  inp.oninput = () => {                                          // digits only, never above max
    const t = inp.value.replace(/\D/g, '').slice(0, 2);
    v = t === '' ? min : Math.min(max, Math.max(min, parseInt(t, 10))); inp.value = t === '' ? '' : String(v);
    el.dispatchEvent(new Event('change'));
  };
  inp.onblur = show;
  inp.onkeydown = e => { if (e.key === 'ArrowUp') { e.preventDefault(); set(v + step); } if (e.key === 'ArrowDown') { e.preventDefault(); set(v - step); } if (e.key === 'Enter') inp.blur(); };
  show();
  return { get: () => v, set };
}
const sH = stepper($('#stH'), { label: 'hours', max: 23 });
const sM = stepper($('#stM'), { label: 'minutes', max: 59, step: 5 });
const aH = stepper($('#atH'), { label: 'hour', min: 1, max: 12, wrap: true, value: auto.h % 12 || 12 });
const aM = stepper($('#atM'), { label: 'minute', max: 59, step: 5, wrap: true, value: auto.m });

// ---------- navigation / breadcrumbs ----------
let view = 'dash', selected = key(new Date());
const VIEW_IDS = { dash: 'v-dash', ana: 'v-ana', day: 'v-day', form: 'v-form', prof: 'v-prof' };

function go(v) {
  if (view === 'form' && v !== 'form') window.api.hide();
  view = v;
  Object.entries(VIEW_IDS).forEach(([n, id]) => $('#' + id).hidden = n !== v);
  const inCal = ['dash', 'day', 'form'].includes(v);
  $('#btnCal').classList.toggle('on', inCal); $('#btnAna').classList.toggle('on', v === 'ana');
  $('#btnProf').classList.toggle('on', v === 'prof');
  try { moveBlob(); } catch {}
  const dl = fromKey(selected).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const NAMES = { dash: 'Calendar', ana: 'Analytics', prof: 'Settings' };
  const parts = { day: [['Calendar', 'dash'], [dl]], form: [['Calendar', 'dash'], [dl, 'day'], ['Submit']] }[v] || [[NAMES[v]]];
  $('#crumbs').innerHTML = parts.map((p, i) => i === parts.length - 1 ? `<b>${p[0]}</b>` : `<a data-go="${p[1]}">${p[0]}</a>`).join('<span>›</span>');
  $('#crumbs').querySelectorAll('a').forEach(a => a.onclick = () => go(a.dataset.go));
  if (v !== 'day') $('#sendBtn').hidden = true;
  if (v === 'dash') renderDash();
  if (v === 'day') renderDay();
  if (v === 'ana') renderAna();
  if (v === 'prof') { paintProfile(); setTab('profile'); }
  if (v === 'form') requestAnimationFrame(() => requestAnimationFrame(sendBounds));
  document.querySelector('.shell').scrollTop = 0;
}
// liquid highlight: stretches out of the old button and settles into the new one
let blobAt = null;
function moveBlob() {
  const on = document.querySelector('.tool.on'), blob = $('#blob');
  if (!on) { blob.style.opacity = 0; blobAt = null; return; }
  const to = on.offsetLeft, W = on.offsetWidth, rest = `translateX(${to}px)`;
  blob.style.width = W + 'px'; blob.style.opacity = 1;
  if (blobAt === null) blob.style.transform = rest;
  else if (blobAt !== to) {   // glide: the pill stretches toward the new button, then its trailing edge catches up
    const from = blobAt, lo = Math.min(from, to), span = Math.abs(to - from) + W;
    blob.getAnimations().forEach(a => a.cancel());
    blob.style.transform = rest;
    blob.animate([
      { transform: `translateX(${from}px)`, width: W + 'px', offset: 0 },
      { transform: `translateX(${lo}px)`, width: span + 'px', offset: .42, easing: 'cubic-bezier(.45,0,.2,1)' },
      { transform: `translateX(${to}px)`, width: W + 'px', offset: 1 }
    ], { duration: 560, easing: 'cubic-bezier(.4,0,.2,1)' });
  }
  blobAt = to;
}
window.addEventListener('resize', () => { blobAt = null; moveBlob(); });
$('#btnCal').onclick = () => go('dash'); $('#btnAna').onclick = () => go('ana');
$('#btnProf').onclick = () => go('prof'); $('#ava').onclick = () => go('prof');
function openDay(k) { selected = k; renderedDay = null; resetForm(); go('day'); setTimeout(() => $('#tName').focus(), 50); }
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('#confirm').hidden) $('#confirm').hidden = true; else if (!$('#logoutConfirm').hidden) $('#logoutConfirm').hidden = true; else if (!$('#crop').hidden) $('#crop').hidden = true; });

// ---------- header ----------
function paintAvatar(el, name, image) {
  el.style.backgroundImage = image ? `url(${image})` : '';
  el.textContent = image ? '' : (name.trim()[0] || '?').toUpperCase();
}
function greeting() {
  const h = new Date().getHours(), n = profile.displayName.trim();
  const g = h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : h >= 17 && h < 21 ? 'Good evening' : 'Hey';
  return n ? `${g}, ${n}` : g;
}
function paintHeader() {
  paintAvatar($('#ava'), profile.displayName || profile.formName, profile.image);
  $('#hello').textContent = greeting();
}
setInterval(paintHeader, 60000);

// ---------- dashboard: chart ----------
let chart = { mode: 'week', anchor: new Date() };
function chartData() {
  const a = chart.anchor, out = [];
  if (chart.mode === 'week') {
    const mon = mondayOf(a);
    for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); out.push({ d, label: d.toLocaleDateString(undefined, { weekday: 'short' }), mins: minsOf(key(d)) }); }
    const end = new Date(mon); end.setDate(mon.getDate() + 6);
    return { pts: out, label: `${mon.getDate()} ${MONTHS[mon.getMonth()].slice(0, 3)} – ${end.getDate()} ${MONTHS[end.getMonth()].slice(0, 3)}` };
  }
  const n = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  for (let i = 1; i <= n; i++) { const d = new Date(a.getFullYear(), a.getMonth(), i); out.push({ d, label: String(i), mins: minsOf(key(d)) }); }
  return { pts: out, label: `${MONTHS[a.getMonth()]} ${a.getFullYear()}` };
}
function smoothPath(p, top, bot) {
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const cl = y => Math.min(bot, Math.max(top, y));
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${cl(p1[1] + (p2[1] - p0[1]) / 6)} ${p2[0] - (p3[0] - p1[0]) / 6},${cl(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
  }
  return d;
}
function renderChart() {
  const { pts, label } = chartData();
  $('#cLabel').textContent = label;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.m === chart.mode));
  const total = pts.reduce((s, p) => s + p.mins, 0), worked = pts.filter(p => p.mins).length;
  $('#chartTotal').textContent = fmt(total);
  $('#chartSub').textContent = worked ? `${worked} day${worked > 1 ? 's' : ''} logged · avg ${fmt(total / worked)}/day` : 'Nothing logged in this period';

  const plot = $('#plot'), W = plot.clientWidth || 700, H = plot.clientHeight || 230;
  const L = 34, R = 8, T = 14, B = 26, iw = W - L - R, ih = H - T - B;
  const maxH = Math.max(1, Math.ceil(Math.max(...pts.map(p => p.mins)) / 60 / 2) * 2);
  const step = iw / pts.length, X = i => L + step * (i + .5), Y = m => T + ih - (m / 60 / maxH) * ih;
  const line = pts.map((p, i) => [X(i), Y(p.mins)]);
  const bw = Math.max(2, Math.min(10, step * .32));
  const every = pts.length > 14 ? 3 : 1;
  const svg = `<svg viewBox="0 0 ${W} ${H}" id="svg">
    <defs>
      <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ACC.hex}" stop-opacity=".35"/><stop offset="1" stop-color="${ACC.hex}" stop-opacity="0"/></linearGradient>
      <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ACC.hex}" stop-opacity=".55"/><stop offset="1" stop-color="${ACC.hex}" stop-opacity=".05"/></linearGradient>
    </defs>
    ${[0, .5, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${T + ih * f}" y2="${T + ih * f}" stroke="rgba(255,255,255,.06)"/><text x="${L - 8}" y="${T + ih * f + 4}" text-anchor="end" fill="#7d8c95" font-size="11">${Math.round(maxH * (1 - f))}h</text>`).join('')}
    ${pts.map((p, i) => `<rect x="${X(i) - bw / 2}" y="${Y(p.mins)}" width="${bw}" height="${Math.max(0, T + ih - Y(p.mins))}" rx="${bw / 2}" fill="url(#gB)"/>`).join('')}
    <path d="${smoothPath(line, T, T + ih)} L${X(pts.length - 1)},${T + ih} L${X(0)},${T + ih} Z" fill="url(#gA)"/>
    <path d="${smoothPath(line, T, T + ih)}" fill="none" stroke="${ACC.hex}" stroke-width="2.2" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(127,224,239,.6))"/>
    ${pts.map((p, i) => i % every ? '' : `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" fill="#7d8c95" font-size="11">${p.label}</text>`).join('')}
    <g id="hov" hidden><line id="hl" y1="${T}" y2="${T + ih}" stroke="${ACC.hex}" stroke-width="1.5"/><circle id="hd" r="5" fill="#06242b" stroke="${ACC.hex}" stroke-width="2"/></g>
  </svg><div class="tip" id="tip" hidden></div>`;
  plot.innerHTML = svg;
  const tip = $('#tip'), hov = plot.querySelector('#hov');
  plot.onmousemove = e => {
    const r = plot.getBoundingClientRect(), i = Math.min(pts.length - 1, Math.max(0, Math.floor((e.clientX - r.left - L) / step)));
    hov.removeAttribute('hidden'); tip.hidden = false;
    plot.querySelector('#hl').setAttribute('x1', X(i)); plot.querySelector('#hl').setAttribute('x2', X(i));
    plot.querySelector('#hd').setAttribute('cx', X(i)); plot.querySelector('#hd').setAttribute('cy', Y(pts[i].mins));
    tip.style.left = X(i) + 'px'; tip.style.top = Y(pts[i].mins) + 'px';
    tip.textContent = `${pts[i].d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${fmt(pts[i].mins)}`;
  };
  plot.onmouseleave = () => { hov.setAttribute('hidden', ''); tip.hidden = true; };
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { chart.mode = b.dataset.m; renderAna(); });
const shiftChart = dir => { if (chart.mode === 'week') chart.anchor.setDate(chart.anchor.getDate() + 7 * dir); else chart.anchor = new Date(chart.anchor.getFullYear(), chart.anchor.getMonth() + dir, 1); renderAna(); };
$('#cPrev').onclick = () => shiftChart(-1); $('#cNext').onclick = () => shiftChart(1);

// ---------- dashboard: stats + calendar ----------
let calView = new Date(); calView.setDate(1);
function renderCal() {
  $('#calLabel').textContent = `${MONTHS[calView.getMonth()]} ${calView.getFullYear()}`;
  const g = $('#cells'); g.innerHTML = '';
  const first = new Date(calView.getFullYear(), calView.getMonth(), 1).getDay();
  const count = new Date(calView.getFullYear(), calView.getMonth() + 1, 0).getDate(), tk = key(new Date());
  for (let i = 0; i < first; i++) g.insertAdjacentHTML('beforeend', '<div class="cell empty"></div>');
  for (let d = 1; d <= count; d++) {
    const k = key(new Date(calView.getFullYear(), calView.getMonth(), d)), has = tasksOf(k).length;
    const c = document.createElement('div'), sent = !!entries[k]?.sent;
    c.style.setProperty('--i', first + d - 1);
    c.className = 'cell' + (k === tk ? ' today' : '') + (entries[k]?.sent ? ' sent' : has ? ' draft' : '');
    c.innerHTML = `<div class="top"><span class="n">${d}</span>${has && !sent ? `<button class="cell-send" title="Send to form"><svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button>` : ''}</div><span class="h">${has ? fmt(minsOf(k)) + (entries[k].sent ? ' · sent' : '') : ''}</span>`;
    c.onclick = () => openDay(k);
    const sb = c.querySelector('.cell-send');
    if (sb) sb.onclick = e => { e.stopPropagation(); selected = k; sendNow(); };
    g.appendChild(c);
  }
}
$('#calPrev').onclick = () => { calView.setMonth(calView.getMonth() - 1); renderCal(); };
$('#calNext').onclick = () => { calView.setMonth(calView.getMonth() + 1); renderCal(); };
$('#calToday').onclick = () => { calView = new Date(); calView.setDate(1); renderCal(); };
function renderDash() { renderCal(); }
function renderAna() { renderChart(); renderInsights(); }


let actYear = new Date().getFullYear();
$('#yPrev').onclick = () => { actYear--; renderInsights(); };
$('#yNext').onclick = () => { if (actYear < new Date().getFullYear()) { actYear++; renderInsights(); } };

function renderInsights() {
  const { pts } = chartData(), keys = pts.map(p => key(p.d));
  const total = pts.reduce((s, p) => s + p.mins, 0), active = pts.filter(p => p.mins);
  const all = keys.flatMap(k => tasksOf(k)), best = pts.reduce((b, p) => p.mins > b.mins ? p : b, pts[0]);
  const per = chart.mode === 'week' ? 'this week' : 'this month';

  // KPI tiles
  $('#kTotal').textContent = fmt(total); $('#kTotalS').textContent = `${active.length} active day${active.length === 1 ? '' : 's'} ${per}`;
  $('#kAvg').textContent = active.length ? fmt(total / active.length) : '0h'; $('#kAvgS').textContent = `per active day`;
  $('#kBest').textContent = best.mins ? fmt(best.mins) : '—'; $('#kBestS').textContent = best.mins ? best.d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) : 'No data yet';
  $('#kTasks').textContent = all.length; $('#kTasksS').textContent = all.length ? `avg ${fmt(total / all.length)} per task` : 'Nothing logged';

  // activity heatmap: one calendar year (Jan-Dec), Mon-first week columns
  const yr = actYear, jan1 = new Date(yr, 0, 1), dec31 = new Date(yr, 11, 31);
  const start = mondayOf(jan1), WEEKS = Math.round((mondayOf(dec31) - start) / (7 * 864e5)) + 1;
  let cells = '', months = '', lastM = -1;
  $('#heatMonths').style.gridTemplateColumns = `repeat(${WEEKS}, 1fr)`; $('#heatMonths').style.columnGap = '4px';
  for (let w = 0; w < WEEKS; w++) {
    const d = new Date(start); d.setDate(start.getDate() + w * 7 + 6);          // month of the week's Sunday
    const m = d.getFullYear() === yr ? d.getMonth() : (d.getFullYear() < yr ? 0 : 11);
    if (m !== lastM && !(w === WEEKS - 1 && m === lastM)) { lastM = m; months += `<span style="grid-column:${w + 1}">${MONTHS[m].slice(0, 3)}</span>`; }
  }
  $('#heatMonths').innerHTML = months;
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = key(d);
    if (d.getFullYear() !== yr) { cells += '<i style="visibility:hidden"></i>'; continue; }
    const m = minsOf(k), a = (.2 + .8 * Math.min(m / 360, 1)).toFixed(2);   // more hours = stronger colour
    cells += `<i ${m ? `style="background:rgba(${ACC.rgb},${a})"` : ''} title="${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(m)}"></i>`;
  }
  $('#heat').innerHTML = cells;
  $('#yLabel').textContent = yr; $('#yNext').disabled = yr >= new Date().getFullYear();

  // submission status
  const withTasks = keys.filter(k => tasksOf(k).length), sent = withTasks.filter(k => entries[k].sent).length, pend = withTasks.length - sent;
  const R = 66, C = 2 * Math.PI * R, frac = withTasks.length ? sent / withTasks.length : 0;
  $('#donut').innerHTML = `<svg width="180" height="180" viewBox="0 0 180 180"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7ce3a6"/><stop offset="1" stop-color="${ACC.hex}"/></linearGradient></defs>
    <circle cx="90" cy="90" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="16"/>
    <circle cx="90" cy="90" r="${R}" fill="none" stroke="url(#rg)" stroke-width="16" stroke-linecap="round" stroke-opacity="${frac ? 1 : 0}" stroke-dasharray="${C * frac} ${C}" transform="rotate(-90 90 90)"/>
    <text x="90" y="91" text-anchor="middle" fill="#eef4f7" font-size="28" font-weight="600" letter-spacing="-.5">${Math.round(frac * 100)}%</text>
    <text x="90" y="110" text-anchor="middle" fill="#7d8c95" font-size="11">${sent} of ${withTasks.length} sent</text></svg>`;
  const svg = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const ICON = {
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    wait: svg('<path d="M7 3h10M7 21h10M8 3v3.5a4 4 0 0 0 1.6 3.2L12 12l-2.4 2.3A4 4 0 0 0 8 17.5V21M16 3v3.5a4 4 0 0 1-1.6 3.2L12 12l2.4 2.3A4 4 0 0 1 16 17.5V21"/>'),
    flame: svg('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.2.8 2 1.6 2.4C10.2 8.5 10.7 5.5 12 3z"/>'),
    trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H4.5A3 3 0 0 0 8 10M16 6h3.5A3 3 0 0 1 16 10M12 13v4M8.5 21h7M10 17h4"/>'),
    dot: svg('<circle cx="12" cy="12" r="3" fill="currentColor"/>'), dash: svg('<path d="M7 12h10"/>')
  };
  const tile = (c, ic, n, l) => `<div class="mt" style="--c:${c}"><div class="ic">${ic}</div><b>${n}</b><small>${l}</small></div>`;
  $('#dlegend').innerHTML = tile('#7ce3a6', ICON.check, sent, 'Sent days') + tile('#ff9f6e', ICON.wait, pend, 'Waiting to send');
}
new ResizeObserver(() => { if (view === 'ana') renderChart(); }).observe($('#plot'));

// ---------- day view ----------
let editing = null;
const CHIPS = [[15, '15m'], [30, '30m'], [45, '45m'], [60, '1h'], [120, '2h'], [180, '3h'], [240, '4h'], [300, '5h'], [360, '6h']];
let picked = new Set();
$('#quick').innerHTML = CHIPS.map(([m, l], i) => `<button data-i="${i}">${l}</button>`).join('');
const paintChips = () => $('#quick').querySelectorAll('button').forEach(b => b.classList.toggle('on', picked.has(Number(b.dataset.i))));
function setDur(m, silent) { sH.set(Math.floor(m / 60), silent); sM.set(m % 60, silent); }
const getDur = () => sH.get() * 60 + sM.get();
$('#quick').querySelectorAll('button').forEach(b => b.onclick = () => {   // chips add up
  const i = Number(b.dataset.i); picked.has(i) ? picked.delete(i) : picked.add(i);
  setDur([...picked].reduce((t, j) => t + CHIPS[j][0], 0), true); paintChips();
});
['#stH', '#stM'].forEach(id => $(id).addEventListener('change', () => { picked.clear(); paintChips(); })); // typing / stepping overrides chips
const fmtHM = m => `${Math.floor(m / 60)}h ${pad(m % 60)}m`;

let renderedDay = null;
function renderDay() {
  $('#dayTitle').textContent = fromKey(selected).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const list = tasksOf(selected), e = entries[selected], box = $('#tasks');
  const firstTop = new Map([...box.querySelectorAll('.task')].map(el => [el.dataset.id, el.getBoundingClientRect().top]));
  const animate = renderedDay === selected; renderedDay = selected;
  const shown = list.slice().reverse();   // newest on top
  box.innerHTML = shown.map(t => `<div class="task" data-id="${t.id}"><span class="nm"></span><span class="tm">${fmtHM(t.mins)}</span>
    ${e?.sent ? '' : '<button class="ib ed" title="Edit">✎</button><button class="ib del" title="Delete">✕</button>'}</div>`).join('');
  box.querySelectorAll('.task').forEach((el, i) => {
    const t = shown[i];
    el.querySelector('.nm').textContent = t.text;
    if (animate) {
      if (!firstTop.has(t.id)) el.animate([{ opacity: 0, transform: 'translateX(-40px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 160, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });   // new task slides in from the left
      else {                                                              // the rest glide down, leaving room at the top
        const dy = firstTop.get(t.id) - el.getBoundingClientRect().top;
        if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
    if (e?.sent) return;
    el.querySelector('.ed').onclick = () => startEdit(t);
    el.querySelector('.del').onclick = () => { entries[selected].tasks = list.filter(x => x.id !== t.id); entries[selected].sent = false; persist(); if (editing === t.id) resetForm(); renderDay(); };
  });
  $('#empty').hidden = !!list.length;
  $('#dayTotal').textContent = fmtHM(minsOf(selected));
  const b = $('#dayBadge');
  b.hidden = !e?.sent;
  if (e?.sent) b.textContent = `Sent ${new Date(e.sentAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  const done = !!e?.sent;
  $('#addCard').hidden = done; $('.day-grid').classList.toggle('solo', done);
  $('#sendBtn').hidden = view !== 'day' || done || !list.length;
  if (view === 'dash') renderCal();
}
function resetForm() { editing = null; picked.clear(); paintChips(); $('#tName').value = ''; setDur(0, true); $('#tAdd').title = 'Add task'; $('#tCancel').classList.add('hide'); $('#formLbl').textContent = 'New task'; $('#tMsg').textContent = ''; }
function startEdit(t) { editing = t.id; picked.clear(); paintChips(); $('#tName').value = t.text; setDur(t.mins, true); $('#tAdd').title = 'Update task'; $('#tCancel').classList.remove('hide'); $('#formLbl').textContent = 'Edit task'; $('#tName').focus(); }
function addTask() {
  const text = $('#tName').value.trim(), mins = getDur(), msg = $('#tMsg');
  msg.className = 'msg err';
  if (!text) { msg.textContent = 'Describe the task first.'; $('#tName').focus(); return; }
  if (!mins) { msg.textContent = 'Pick how long it took.'; return; }
  const e = entries[selected] || { tasks: [] };
  if (editing) e.tasks = e.tasks.map(t => t.id === editing ? { ...t, text, mins } : t);
  else e.tasks.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, mins });
  e.sent = false; entries[selected] = e; persist();
  resetForm(); renderDay(); $('#tName').focus();
}
$('#tAdd').onclick = addTask; $('#tCancel').onclick = resetForm;
$('#tName').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!$('#tName').value.trim()) { addTask(); return; } $('#stH .sv').focus(); } };
$('#stH .sv').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#stM .sv').focus(); } });
$('#stM .sv').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } });

// ---------- sending (form shown inside the app) ----------
const sendBounds = () => { if (view !== 'form') return; const r = $('#formbox').getBoundingClientRect(); window.api.bounds({ x: r.x, y: r.y, width: r.width, height: r.height }); };
new ResizeObserver(sendBounds).observe($('#formbox')); window.addEventListener('resize', sendBounds);
$('#v-form').addEventListener('scroll', sendBounds);

function setBanner(t, cls = '') { const b = $('#banner'); b.hidden = false; b.textContent = t; b.className = 'banner ' + cls; }
const payload = (k, submit) => { const d = fromKey(k); return { key: k, name: profile.formName, day: d.getDate(), month: MONTHS[d.getMonth()], monthIndex: d.getMonth(), tasks: formLines(k), submit }; };
function markSent(k) { entries[k] = { ...entries[k], sent: true, sentAt: Date.now() }; persist(); }

function showSending(state, title, msg = '') {
  $('#sending').hidden = false;
  $('#sdSpin').hidden = state !== 'busy'; $('#sdTick').hidden = state !== 'ok'; $('#sdErr').hidden = state !== 'err';
  $('#sdTitle').textContent = title; $('#sdMsg').textContent = msg; $('#sdBtns').hidden = state === 'busy';
}
$('#sdOk').onclick = () => { $('#sending').hidden = true; };

const wait = ms => new Promise(r => setTimeout(r, ms));
function fabState(s) {   // '' | 'busy' | 'ok'
  const f = $('#sendBtn');
  f.classList.toggle('busy', s === 'busy'); f.classList.toggle('ok', s === 'ok');
  f.disabled = !!s; f.querySelector('.txt').textContent = s === 'busy' ? 'Sending' : s === 'ok' ? 'Sent' : '';
}
async function finishDay() {   // "Sent" for a second, then the add-task side melts away and the list takes the width
  fabState('ok'); await wait(1000);
  $('.day-grid').classList.add('leaving'); $('#sendBtn').classList.add('gone');
  await wait(700);
  $('.day-grid').classList.remove('leaving'); $('#sendBtn').classList.remove('gone'); fabState('');
  renderDay();
}

async function sendNow() {
  if (!profile.formName.trim()) { toast('Add your name-in-form in Profile first'); go('prof'); return; }
  const k = selected;
  if (cfg.autoSubmit) { // runs in the background; the form is never shown
    const inDay = view === 'day';
    if (inDay) fabState('busy'); else showSending('busy', 'Submitting…', 'Sending your tasks to the form');
    const r = await window.api.run(payload(k, true));
    if (view === 'form') go('day');
    if (!r.ok) { if (inDay) fabState(''); return showSending('err', 'Could not submit', r.error); }
    markSent(k);
    if (inDay && view === 'day' && selected === k) return finishDay();
    if (inDay) fabState('');
    renderDay(); showSending('ok', 'Submitted successfully', 'Your tasks have been sent.');
    return;
  }
  go('form'); setBanner('Filling the form…');
  const r = await window.api.run(payload(k, false));
  if (!r.ok) return setBanner('✕ ' + r.error, 'err');
  $('#banner').hidden = true;
}
$('#sendBtn').onclick = sendNow;
window.api.onSubmitted(k => { markSent(k); if (view === 'form') setBanner('✓ Submitted — marked as sent', 'ok'); toast('Sent ✓'); });
window.api.onNeedView(() => { go('form'); setBanner('Sign in to your Google account to continue — it will resume automatically.'); });

// ---------- automate ----------
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_CHIPS = [[0, 'All'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, 'Last']];
const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: 'last' };
const weeksOf = d => auto.dayWeeks[d] || [];
const dayMatches = date => auto.days.includes(date.getDay()) && (w => !w.length || w.includes(Math.ceil(date.getDate() / 7)) || (w.includes(6) && date.getDate() + 7 > new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()))(weeksOf(date.getDay()));
const weekTag = d => { const w = weeksOf(d); return w.length ? w.slice().sort().map(x => x === 6 ? 'L' : x).join(',') : 'All'; };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let apm = auto.h >= 12 ? 'PM' : 'AM';
const to24 = (h12, p) => (h12 % 12) + (p === 'PM' ? 12 : 0);
const fmt12 = (h, m) => `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
function paintAuto() {
  $('#autoOn').checked = auto.on;
  document.querySelectorAll('.pane[data-pane="automation"] .set-row:not(.auto-row)').forEach(r => r.hidden = !auto.on);
  $('#atP').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === apm));
  const days = auto.days.slice().sort();
  $('#atDays').querySelectorAll('button').forEach(b => { const d = Number(b.dataset.d), on = auto.days.includes(d); b.classList.toggle('on', on); b.querySelector('small').textContent = on ? `(${weekTag(d)})` : ''; });
  $('#wkEmpty').hidden = !!days.length;
  $('#atWeeks').innerHTML = days.map(d => `<div class="wk-row"><span>${FULL_DAYS[d]}</span><div class="wk-chips">${WEEK_CHIPS.map(([w, n]) => `<button data-d="${d}" data-w="${w}" class="${(w === 0 ? !weeksOf(d).length : weeksOf(d).includes(w)) ? 'on' : ''}">${n}</button>`).join('')}</div></div>`).join('');
  $('#atWeeks').querySelectorAll('button').forEach(b => b.onclick = () => {
    const d = Number(b.dataset.d), w = Number(b.dataset.w), cur = weeksOf(d);
    auto.dayWeeks[d] = w === 0 ? [] : cur.includes(w) ? cur.filter(x => x !== w) : [...cur, w]; saveAuto();
  });
  const part = d => { const w = weeksOf(d); return w.length ? `${w.slice().sort().map(x => ORD[x]).join(' & ')} ${DAY_NAMES[d]}` : `every ${DAY_NAMES[d]}`; };
  const when = days.length === 7 && days.every(d => !weeksOf(d).length) ? 'every day' : days.map(part).join(', ');
  const last = auto.lastRun ? `  Last run: ${auto.lastRun.replace(/(\d{2}):(\d{2})/, (_, H, M) => fmt12(+H, +M))}` : '';
  if ($('#autoStatus')) $('#autoStatus').textContent = !auto.on ? 'Auto-send is off.' : !auto.days.length ? 'No days selected — nothing will be sent.' : `Tasks will be sent ${when} at ${fmt12(auto.h, auto.m)}.` + last;
}
$('#atDays').innerHTML = DAY_NAMES.map((n, i) => `<button data-d="${i}">${n}<small></small></button>`).join('');
$('#atDays').querySelectorAll('button').forEach(b => b.onclick = () => {
  const d = Number(b.dataset.d); auto.days = auto.days.includes(d) ? auto.days.filter(x => x !== d) : [...auto.days, d]; saveAuto();
});
$('#atP').querySelectorAll('button').forEach(b => b.onclick = () => { apm = b.dataset.p; saveAuto(); });
const saveAuto = () => { auto.h = to24(aH.get(), apm); auto.m = aM.get(); save('auto', auto); paintAuto(); };
$('#autoOn').onchange = e => { auto.on = e.target.checked; saveAuto(); };   // the schedule always sends in the background; it never changes the Submit setting
$('#atH').addEventListener('change', saveAuto); $('#atM').addEventListener('change', saveAuto);

let busy = false;
async function tick() {
  if (!auto.on || busy || view === 'form') return;
  if (!dayMatches(new Date())) return;   // today is a skipped day/week
  const now = new Date(), k = key(now), stamp = `${k} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (now.getHours() * 60 + now.getMinutes() < auto.h * 60 + auto.m) return;
  if (auto.lastRun.startsWith(k) || !tasksOf(k).length || entries[k]?.sent) return;
  if (!profile.formName.trim()) return;
  busy = true;
  const r = await window.api.run(payload(k, true));
  if (r.ok) { markSent(k); auto.lastRun = `${stamp} ✓ sent`; toast('Auto-sent today’s tasks ✓'); }
  else auto.lastRun = `${stamp} ✕ ${r.error}`;
  save('auto', auto); paintAuto(); busy = false;
  if (view === 'dash') renderDash(); if (view === 'ana') renderAna(); if (!$('#v-day').hidden) renderDay(); if (view === 'form') go('dash');
}
setInterval(tick, 20000); setTimeout(tick, 3000);

// ---------- profile ----------
let draftImage = profile.image;
function paintPic() {
  paintAvatar($('#pic'), $('#pDisplay').value || $('#pForm').value || profile.displayName, draftImage);
  $('#picDel').hidden = !draftImage; $('#pic').classList.toggle('empty', !draftImage); if (!draftImage) $('#pic').textContent = 'Add';
}
function setTab(t) {
  document.querySelectorAll('.set-nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.pane').forEach(p => p.hidden = p.dataset.pane !== t);
}
document.querySelectorAll('.set-nav button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
function paintProfile() {
  draftImage = profile.image;
  $('#pDisplay').value = profile.displayName; $('#pForm').value = profile.formName; $('#pAuto').checked = !!cfg.autoSubmit;
  paintPic();
}

// ---- cropper (circular, fits the avatar) ----
const V = 300; let cr = { w: 0, h: 0, base: 1, z: 1, x: 0, y: 0 };
const cImg = $('#cropImg');
const clampCrop = () => { const sw = cr.w * cr.base * cr.z, sh = cr.h * cr.base * cr.z; cr.x = Math.min(0, Math.max(V - sw, cr.x)); cr.y = Math.min(0, Math.max(V - sh, cr.y)); };
function drawCrop() {
  clampCrop(); const sc = cr.base * cr.z;
  cImg.style.width = cr.w * sc + 'px'; cImg.style.height = cr.h * sc + 'px'; cImg.style.transform = `translate(${cr.x}px,${cr.y}px)`;
}
function zoomTo(z) { // zoom around the centre of the viewport
  z = Math.min(3, Math.max(1, z)); const k = (cr.base * z) / (cr.base * cr.z);
  cr.x = V / 2 - (V / 2 - cr.x) * k; cr.y = V / 2 - (V / 2 - cr.y) * k; cr.z = z; $('#cropZoom').value = z; drawCrop();
}
function openCrop(file) {
  const fr = new FileReader();
  fr.onload = () => { cImg.onload = () => {
    cr = { w: cImg.naturalWidth, h: cImg.naturalHeight, z: 1, x: 0, y: 0, base: V / Math.min(cImg.naturalWidth, cImg.naturalHeight) };
    cr.x = (V - cr.w * cr.base) / 2; cr.y = (V - cr.h * cr.base) / 2; $('#cropZoom').value = 1; drawCrop(); $('#crop').hidden = false; };
    cImg.src = fr.result; };
  fr.readAsDataURL(file);
}
let drag = null;
$('#cropView').onpointerdown = e => { drag = { px: e.clientX, py: e.clientY, x: cr.x, y: cr.y }; e.target.setPointerCapture?.(e.pointerId); $('#cropView').setPointerCapture(e.pointerId); };
$('#cropView').onpointermove = e => { if (!drag) return; cr.x = drag.x + e.clientX - drag.px; cr.y = drag.y + e.clientY - drag.py; drawCrop(); };
$('#cropView').onpointerup = () => { drag = null; };
$('#cropView').onwheel = e => { e.preventDefault(); zoomTo(cr.z - e.deltaY * 0.003); };
$('#cropZoom').oninput = e => zoomTo(Number(e.target.value));
$('#cropCancel').onclick = () => { $('#crop').hidden = true; };
$('#cropApply').onclick = () => {
  const sc = cr.base * cr.z, c = document.createElement('canvas'); c.width = c.height = 256;
  c.getContext('2d').drawImage(cImg, -cr.x / sc, -cr.y / sc, V / sc, V / sc, 0, 0, 256, 256);
  draftImage = c.toDataURL('image/jpeg', .9); $('#crop').hidden = true; paintPic(); saveProfile();
};
$('#pic').onclick = () => $('#picFile').click();
$('#picFile').onchange = e => { const f = e.target.files[0]; if (f) openCrop(f); e.target.value = ''; };
$('#picDel').onclick = () => { draftImage = ''; paintPic(); saveProfile(); };
$('#pDisplay').addEventListener('input', () => { if (!draftImage) paintPic(); });
function saveProfile() {
  profile = { displayName: $('#pDisplay').value.trim(), formName: $('#pForm').value.trim(), image: draftImage };
  cfg = { autoSubmit: $('#pAuto').checked };
  save('profile', profile); save('cfg', cfg); paintHeader();
}
['#pDisplay', '#pForm'].forEach(id => $(id).addEventListener('input', saveProfile));
$('#pAuto').addEventListener('change', saveProfile);
$('#pLogout').onclick = () => { $('#logoutConfirm').hidden = false; };
$('#loNo').onclick = () => { $('#logoutConfirm').hidden = true; };
$('#logoutConfirm').onmousedown = e => { if (e.target === e.currentTarget) $('#logoutConfirm').hidden = true; };
$('#loYes').onclick = async () => {
  $('#loYes').disabled = true; $('#loYes').textContent = 'Logging out…';
  await window.api.signOut(); signedIn = false; save('signedIn', false);
  $('#logoutConfirm').hidden = true; $('#loYes').disabled = false; $('#loYes').textContent = 'Log out';
  account = {}; save('account', account); paintAccount(); toast('Logged out of Google'); showSplash();
};

// ---- clear all data ----
$('#pClear').onclick = () => { $('#confirm').hidden = false; };
$('#cfNo').onclick = () => { $('#confirm').hidden = true; };
$('#confirm').onmousedown = e => { if (e.target === e.currentTarget) $('#confirm').hidden = true; };
$('#cfYes').onclick = async () => {
  $('#cfYes').disabled = true; $('#cfYes').textContent = 'Clearing…';
  await window.api.signOut();          // forget the Google session too
  window.api.writeStore({});           // the shared task file too
  const keep = localStorage.getItem('backup');   // backup settings survive a clear
  localStorage.clear();                // tasks, profile, photo, schedule, logs — everything
  if (keep) localStorage.setItem('backup', keep);
  location.reload();                   // back to the first-launch splash
};

// custom colour picker (saturation/brightness square + hue bar + hex)
const hsv2hex = (h, s, v) => { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); };
const hex2hsv = hex => { const [r, g, b] = hexRgb(hex).map(x => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: h * 60, s: mx ? d / mx : 0, v: mx }; };
let cp = hex2hsv(customHex);
function paintCp(skipHex) {
  const hex = hsv2hex(cp.h, cp.s, cp.v);
  $('#cpSv').style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${cp.h},100%,50%))`;
  $('#cpSvH').style.left = cp.s * 100 + '%'; $('#cpSvH').style.top = (1 - cp.v) * 100 + '%'; $('#cpSvH').style.background = hex;
  $('#cpHueH').style.left = cp.h / 360 * 100 + '%'; $('#cpHueH').style.background = `hsl(${cp.h},100%,50%)`;
  $('#cpPrev').style.background = hex; if (!skipHex) $('#cpHex').value = hex.toUpperCase();
  return hex;
}
function cpApply(skipHex) {
  customHex = paintCp(skipHex); applyTheme('custom', true);
  const sw = document.querySelector('.sw.custom'); if (sw) { sw.style.setProperty('--c', customHex); document.querySelectorAll('.sw.on').forEach(x => x.classList.remove('on')); sw.classList.add('on'); }
  if (view === 'ana') renderAna(); if (view === 'dash') renderDash();
}
function dragArea(el, fn) {
  el.onpointerdown = e => { el.setPointerCapture(e.pointerId); const mv = ev => { const r = el.getBoundingClientRect(); fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))); }; mv(e); el.onpointermove = mv; el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; }; };
}
dragArea($('#cpSv'), (x, y) => { cp.s = x; cp.v = 1 - y; cpApply(); });
dragArea($('#cpHue'), x => { cp.h = x * 359.99; cpApply(); });
$('#cpHex').oninput = () => { let v = $('#cpHex').value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) { cp = hex2hsv(v.toLowerCase()); cpApply(true); } };
$('#cpHex').onblur = () => paintCp();
document.addEventListener('mousedown', e => { const p = $('#cp'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('.sw.custom')) p.hidden = true; });
function paintThemes() {
  const sw = t => `<button class="sw ${t.id === themeId ? 'on' : ''}" data-id="${t.id}" style="--c:${t.hex}"><span class="dot"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span>${t.name}</span></button>`;
  $('#themeGrid').innerHTML = THEMES.map(sw).join('')
    + `<button class="sw custom ${themeId === 'custom' ? 'on' : ''}" data-id="custom" style="--c:${customHex}"><span class="dot"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span>Custom</span></button>`;
  $('#themeGrid').querySelectorAll('button.sw').forEach(b => b.onclick = () => {
    const refresh = () => { if (view === 'ana') renderAna(); if (view === 'dash') renderDash(); };
    if (b.dataset.id === 'custom') { $('#cp').hidden = !$('#cp').hidden; cp = hex2hsv(customHex); paintCp(); applyTheme('custom', true); paintThemes(); refresh(); return; }
    $('#cp').hidden = true; applyTheme(b.dataset.id, true); paintThemes(); refresh();
  });
}
paintThemes();

// ---------- backup & restore ----------
let bk = load('backup', { on: false, dir: '', times: [], last: 0, ran: '' });
const saveBk = () => save('backup', bk);
const bkData = () => ({ app: 'Stride', version: 1, savedAt: Date.now(), entries, profile, auto, cfg, theme: themeId, themeCustom: customHex });
async function runBackup() {
  if (!bk.on || !bk.dir) return;
  const r = await window.api.backupWrite(bk.dir, bkData());
  if (r.ok) { bk.last = Date.now(); saveBk(); } else toast('Backup failed: ' + r.error);
  paintBackup();
}
function paintBackup() {
  $('#bkOn').checked = bk.on;
  document.querySelectorAll('.bk-opt').forEach(r => r.hidden = !bk.on);
  $('#bkName').textContent = bk.dir ? bk.dir.split('/').filter(Boolean).pop() : 'Choose a folder';
  $('#bkPath').textContent = bk.dir; $('#bkPath').hidden = !bk.dir;
  const t12 = t => { const [H, M] = t.split(':').map(Number); return fmt12(H, M); };
  const sorted = bk.times.map((t, i) => [t, i]).sort((x, y) => x[0].localeCompare(y[0]));
  $('#bkTimes').innerHTML = sorted.map(([t, i]) => `<span class="bk-t">${t12(t)}<button data-x="${i}" title="Remove">×</button></span>`).join('')
    + (bk.times.length < 6 ? '<button class="bk-add" id="bkAdd" title="Add a time">+</button>' : '');
  $('#bkTimes').querySelectorAll('[data-x]').forEach(b => b.onclick = () => { bk.times.splice(Number(b.dataset.x), 1); saveBk(); paintBackup(); });
  if ($('#bkAdd')) $('#bkAdd').onclick = openBkPicker;
}
const bpH = stepper($('#bpH'), { label: 'hour', min: 1, max: 12, wrap: true, value: 9 });
const bpM = stepper($('#bpM'), { label: 'minute', max: 59, step: 5, wrap: true, value: 0 });
let bpApm = 'AM';
const paintBp = () => $('#bpP').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === bpApm));
$('#bpP').querySelectorAll('button').forEach(b => b.onclick = () => { bpApm = b.dataset.p; paintBp(); });
function openBkPicker() {
  const pop = $('#bkPicker'); if (!pop.hidden) { pop.hidden = true; return; }
  bpH.set(9, true); bpM.set(0, true); bpApm = 'AM'; paintBp();
  const add = $('#bkAdd'); pop.style.left = add.offsetLeft + 'px'; pop.style.top = (add.offsetTop + add.offsetHeight + 8) + 'px'; pop.hidden = false;
}
document.addEventListener('mousedown', e => { const p = $('#bkPicker'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#bkAdd')) p.hidden = true; });
$('#bpYes').onclick = () => {
  const t = `${pad(to24(bpH.get(), bpApm))}:${pad(bpM.get())}`;
  if (bk.times.includes(t)) { toast('That time is already added'); return; }
  bk.times.push(t); saveBk(); $('#bkPicker').hidden = true; paintBackup();
};
$('#bkOn').onchange = () => { bk.on = $('#bkOn').checked; saveBk(); paintBackup(); if (bk.on && bk.dir) runBackup(); };
$('#bkPick').onclick = async () => { let d = ''; try { d = await window.api.backupPick(); } catch (e) { toast('Restart Stride (⌘Q) to enable the folder picker'); return; } if (!d) return; bk.dir = d; saveBk(); paintBackup(); runBackup(); };
$('#bkRestore').onclick = async () => {
  let r; try { r = await window.api.backupPickFile(); } catch { toast('Restart Stride (⌘Q) to enable restore'); return; }
  if (r.canceled) return;
  if (!r.ok || !r.data || typeof r.data !== 'object' || !(r.data.entries || r.data.profile)) { toast(r.error || 'That file is not a Stride backup.'); return; }
  if (!confirm('Restore from this file? Your current tasks, profile and schedule will be replaced.')) return;
  const d = r.data;
  if (d.entries) { entries = d.entries; persist(); }
  if (d.profile) save('profile', d.profile);
  if (d.auto) save('auto', d.auto);
  if (d.cfg) save('cfg', d.cfg);
  if (d.theme) save('theme', d.theme);
  if (d.themeCustom) save('themeCustom', d.themeCustom);
  location.reload();
};
setInterval(() => {
  if (!bk.on || !bk.dir) return;
  const n = new Date(), hm = `${pad(n.getHours())}:${pad(n.getMinutes())}`, id = `${key(n)} ${hm}`;
  if (bk.times.includes(hm) && bk.ran !== id) { bk.ran = id; saveBk(); runBackup(); }
}, 15000);
paintBackup();

// ---------- splash: Google sign-in ----------
function splashState(s) { $('#spIntro').hidden = s !== 'intro'; $('#spLogin').hidden = s !== 'login'; $('#spDone').hidden = s !== 'done'; }
function showSplash() { window.api.hide(); splashState('intro'); $('#splash').hidden = false; }
function loginBounds() { if ($('#spLogin').hidden) return; const r = $('#loginbox').getBoundingClientRect(); window.api.bounds({ x: r.x, y: r.y, width: r.width, height: r.height }); }
window.addEventListener('resize', loginBounds);
new ResizeObserver(loginBounds).observe($('#loginbox'));
$('#gBtn').onclick = async () => {
  splashState('login'); $('#spNote').textContent = 'Use the account that has access to your form.';
  requestAnimationFrame(() => requestAnimationFrame(loginBounds)); setTimeout(loginBounds, 450);
  const r = await window.api.authStart();
  if (!$('#spLogin').hidden && r.ok) {
    window.api.hide(); splashState('done');
    signedIn = true; save('signedIn', true);
    account = { email: r.email || account.email || '', at: Date.now() }; save('account', account); paintAccount();
    setTimeout(() => { $('#splash').hidden = true; go(profile.formName ? 'dash' : 'prof'); if (!profile.formName) toast('Welcome! Add your name to finish setting up'); }, 1400);
  } else if (!r.ok && !$('#spLogin').hidden) $('#spNote').textContent = 'Could not reach Google. Check your connection and try again.';
};
$('#spBack').onclick = () => { window.api.authCancel(); window.api.hide(); splashState('intro'); };

// ---------- tasks added from the IDE extension ----------
window.api.onStore(d => {
  if (JSON.stringify(d) === JSON.stringify(entries)) return;
  entries = d; save('entries2', entries);
  if (view === 'dash') renderDash(); if (view === 'ana') renderAna(); if (view === 'day') renderDay();
});

// ---------- init ----------
window.api.writeStore(entries);
paintHeader(); paintAuto(); setDur(0, true);
paintAccount();
if (signedIn) go(profile.formName ? 'dash' : 'prof'); else { go('dash'); showSplash(); }
