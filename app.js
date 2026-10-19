/* Laterne 1.0.0 – ruhige Begleiterin über helle Wege. Alles lokal, kein Server. */
'use strict';
const VERSION = '1.0.0';
const $ = s => document.querySelector(s);
const CITY_IDS = ['guetersloh'];           // später: ['guetersloh','verl'] → Region verbunden
const CITIES = CITY_IDS.map(id => window.LATERNE_CITIES[id]).filter(Boolean);
const REGION = (() => {
  const b = CITIES.map(c => c.bounds);
  return {
    name: CITIES.map(c => c.name).join(' & '),
    center: CITIES[0].center,
    bounds: [[Math.min(...b.map(x => x[0][0])), Math.min(...b.map(x => x[0][1]))], [Math.max(...b.map(x => x[1][0])), Math.max(...b.map(x => x[1][1]))]],
    help: CITIES.flatMap(c => c.help).filter((h, i, a) => a.findIndex(x => x.number === h.number) === i),
    safePlaces: CITIES.flatMap(c => c.safePlaces || [])
  };
})();
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

/* ---------- Speicher ---------- */
const KEY = 'laterne.v1';
const S = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }

/* ---------- Helfer ---------- */
function toast(t, ms = 2800) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms); }
function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }
function normPhone(p) { p = (p || '').replace(/[^\d+]/g, ''); if (p.startsWith('00')) p = '+' + p.slice(2); else if (p.startsWith('0')) p = '+49' + p.slice(1); return p; }
function validPhone(p) { return /^\+\d{8,15}$/.test(normPhone(p)); }
function smsHref(body) { return 'sms:' + normPhone(S.phone) + '?body=' + encodeURIComponent(body); }
function waHref(body) { return 'https://wa.me/' + normPhone(S.phone).replace('+', '') + '?text=' + encodeURIComponent(body); }
function mapLink(lat, lon) { return 'https://maps.google.com/?q=' + lat.toFixed(6) + ',' + lon.toFixed(6); }
function dist(a, b) { const R = 6371e3, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function fmtMin(s) { return Math.max(1, Math.round(s / 60)) + ' Min'; }
function fmtClock(ms) { const neg = ms < 0; ms = Math.abs(ms); const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60; return (neg ? '+' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }
function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
async function fetchJSON(url, opt = {}, ms = 15000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { ...opt, signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function overpass(q, ms = 25000) {
  let err; for (const u of OVERPASS) { try { return await fetchJSON(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, ms); } catch (e) { err = e; } }
  throw err;
}
function bubble(el, text) { el = typeof el === 'string' ? $(el) : el; if (el.textContent === text) return; el.textContent = text; el.classList.remove('again'); void el.offsetWidth; el.classList.add('again'); }

/* ---------- Bildschirme ---------- */
let current = 'splash';
function show(id) {
  if (id === current) return;
  const from = $('#' + current), to = $('#' + id);
  from.classList.remove('shown'); setTimeout(() => { if (current !== from.id) from.classList.remove('active'); }, 450);
  to.classList.add('active'); requestAnimationFrame(() => requestAnimationFrame(() => to.classList.add('shown')));
  current = id;
  if (id === 'home' && map) setTimeout(() => map.invalidateSize(), 60);
  if (id === 'walk' && walkMap) setTimeout(() => walkMap.invalidateSize(), 60);
  if (id === 'planner' && planMap) setTimeout(() => planMap.invalidateSize(), 60);
  if (!['splash', 'onboarding', 'home'].includes(id)) history.pushState({ s: id }, '');
}
window.addEventListener('popstate', () => {
  if (['planner', 'help', 'info'].includes(current)) show('home');
  else if (current === 'fakecall') endFake();
});
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => show(walk ? 'walk' : 'home')));

/* ---------- 1 Start ---------- */
(function splash() {
  const btn = $('#startBtn'); let done = false;
  const ready = () => { if (done) return; done = true; $('#splash').classList.add('lit'); btn.classList.add('ready'); };
  $('#splashLight').addEventListener('animationend', ready, { once: true });
  setTimeout(ready, 5000);                         // Sicherung: spätestens nach 5 s
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(ready, 300);
  $('#splash').classList.add('shown');
  btn.addEventListener('click', () => {
    ready();
    if (S.onboarded) enterHome(); else { show('onboarding'); setTimeout(() => $('#obName').focus({ preventScroll: true }), 500); }
  });
})();

/* ---------- 2 Onboarding ---------- */
(function onboarding() {
  let step = 0; const steps = [...document.querySelectorAll('.ob-step')], dots = [...document.querySelectorAll('.dots i')];
  const say = ['Hallo! Ich bin Luna. Wie darf ich dich nennen?', '', ''];
  function go(n) {
    step = n; steps.forEach((s, i) => s.classList.toggle('active', i === n)); dots.forEach((d, i) => d.classList.toggle('on', i === n));
    $('#obBack').hidden = n === 0; $('#obNext').textContent = n === 2 ? 'Fertig – los geht’s' : 'Weiter';
    const name = $('#obName').value.trim(), c = $('#obContact').value.trim();
    if (n === 1) bubble('#obBubble', `Schön, dich kennenzulernen, ${name}. Wem sollen wir im Notfall Bescheid geben?`);
    if (n === 2) {
      bubble('#obBubble', `Fast geschafft. Lass uns kurz testen, ob ${c} dich erreicht.`);
      $('#obContactName').textContent = c;
      $('#obTestSms').href = 'sms:' + normPhone($('#obPhone').value) + '?body=' + encodeURIComponent(`Hallo ${c}, hier ist ${name}. Ich nutze die App „Laterne“ für meinen Heimweg. Wenn etwas ist, bekommst du von mir eine Nachricht mit meinem Standort. Das ist nur ein Test 💛`);
    }
    if (n === 0) bubble('#obBubble', say[0]);
  }
  $('#obBack').addEventListener('click', () => go(step - 1));
  $('#obPhone').addEventListener('input', e => { $('#obPhoneHint').textContent = e.target.value && !validPhone(e.target.value) ? 'Bitte eine Handynummer eingeben, z. B. 0171 1234567.' : ''; });
  $('#obTestSms').addEventListener('click', () => { S._testOpened = true; });
  $('#obForm').addEventListener('submit', e => {
    e.preventDefault();
    if (step === 0) { if (!$('#obName').value.trim()) { toast('Wie heißt du?'); $('#obName').focus(); return; } go(1); return; }
    if (step === 1) {
      if (!$('#obContact').value.trim()) { toast('Bitte einen Namen eingeben.'); return; }
      if (!validPhone($('#obPhone').value)) { $('#obPhoneHint').textContent = 'Bitte eine gültige Handynummer eingeben.'; return; }
      go(2); return;
    }
    // erst jetzt speichern
    S.name = $('#obName').value.trim(); S.contact = $('#obContact').value.trim(); S.phone = normPhone($('#obPhone').value);
    S.caller = S.caller || 'Mama'; S.places = S.places || {}; S.onboarded = true; delete S._testOpened; save();
    enterHome();
  });
})();

/* ---------- 3 Karte & Standort ---------- */
let map, meMarker, meCircle, fix = null, watchId = null, locWarned = false;
const meIcon = () => L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
function makeMap(id, opts = {}) {
  const m = L.map(id, { zoomControl: false, attributionControl: true, ...opts }).setView(REGION.center, 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  return m;
}
function enterHome() {
  show('home');
  if (!map) {
    map = makeMap('map'); map.setMaxBounds(L.latLngBounds(REGION.bounds).pad(0.5));
    drawSafe(map); loadSafePlaces();
  }
  startLocation();
  greet();
  if (S.walk) resumeWalk();
}
function greet() {
  const h = new Date().getHours(), n = S.name || '';
  const t = h < 5 ? `Noch wach, ${n}? Ich leuchte dir.` : h < 11 ? `Guten Morgen, ${n}.` : h < 18 ? `Hallo ${n}, schön, dass du da bist.` : `Guten Abend, ${n}. Wohin soll’s gehen?`;
  bubble('#homeBubble', t);
}
function startLocation() {
  if (watchId !== null) return;
  const pill = $('#locPill');
  if (!('geolocation' in navigator)) { pill.textContent = '📍 Dein Gerät kann keinen Standort liefern.'; pill.classList.add('warn'); return; }
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function onPos(p) {
  const first = !fix;
  fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() };
  const ll = [fix.lat, fix.lon], pill = $('#locPill');
  if (!meMarker) { meMarker = L.marker(ll, { icon: meIcon(), zIndexOffset: 1000 }).addTo(map); meCircle = L.circle(ll, { radius: fix.acc, color: '#4F7BE8', weight: 1, fillOpacity: .08 }).addTo(map); }
  else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(fix.acc); }
  if (first) map.setView(ll, 16);
  if (fix.acc > 100) { pill.textContent = `📍 Standort wird genauer… (± ${Math.round(fix.acc)} m)`; pill.classList.add('warn'); }
  else { pill.textContent = `📍 Standort ± ${Math.round(fix.acc)} m`; pill.classList.remove('warn'); }
  if (walk) onWalkPos();
}
function onPosErr(e) {
  const pill = $('#locPill'); pill.classList.add('warn');
  if (e.code === 1) { pill.textContent = '📍 Standort nicht freigegeben – tippe hier für Hilfe'; navigator.geolocation.clearWatch(watchId); watchId = null; }
  else if (e.code === 3) pill.textContent = fix ? `📍 Letzter Standort ± ${Math.round(fix.acc)} m (wird aktualisiert…)` : '📍 Suche Satelliten… geh am besten kurz ins Freie.';
  else pill.textContent = '📍 Standort gerade nicht verfügbar. Ich versuche es weiter.';
}
$('#locPill').addEventListener('click', () => {
  if (watchId === null) { toast('Erlaube „Standort“ für Laterne: Schloss-Symbol in der Adresszeile → Berechtigungen.', 6000); startLocation(); }
});
const fixFresh = () => fix && Date.now() - fix.ts < 120000;

/* ---------- 4 Sichere Orte ---------- */
const SAFE_KIND = { police: ['👮', 'Polizei'], fuel: ['⛽', 'Tankstelle'], pharmacy: ['💊', 'Apotheke'], hospital: ['🏥', 'Krankenhaus'], station: ['🚉', 'Bahnhof'] };
let safeLayers = [];
function drawSafe(m) {
  const list = S.safeCache && S.safeCache.items && S.safeCache.items.length ? S.safeCache.items : REGION.safePlaces;
  const g = L.layerGroup(list.map(p => {
    const [ic, lab] = SAFE_KIND[p.k] || ['✨', 'Sicherer Ort'];
    return L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: '<div class="safe-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), title: p.n || lab })
      .bindPopup(`<b>${ic} ${esc(p.n || lab)}</b><br><small>${lab}${p.o ? ' · ' + esc(p.o) : ''}</small>`);
  })).addTo(m);
  safeLayers.push([m, g]);
}
async function loadSafePlaces() {
  if (REGION.safePlaces.length || (S.safeCache && Date.now() - S.safeCache.ts < 7 * 864e5)) return; // eingebaute Liste reicht, kein Live-Abruf nötig
  const [[s, w], [n, e]] = REGION.bounds, bb = `${s},${w},${n},${e}`;
  try {
    const d = await overpass(`[out:json][timeout:25];(nwr(${bb})["amenity"~"^(police|pharmacy|fuel|hospital)$"];nwr(${bb})["railway"="station"];);out center tags;`);
    const items = d.elements.map(x => ({ lat: x.lat ?? x.center?.lat, lon: x.lon ?? x.center?.lon, k: x.tags.railway === 'station' ? 'station' : x.tags.amenity, n: x.tags.name || '', o: x.tags.opening_hours || '' })).filter(x => x.lat);
    if (items.length) { S.safeCache = { ts: Date.now(), items }; save(); safeLayers.forEach(([m, g]) => m.removeLayer(g)); safeLayers = []; [map, walkMap, planMap].filter(Boolean).forEach(drawSafe); }
  } catch { /* eingebaute Liste bleibt */ }
}

/* ---------- Planer: Ziel, Route, helle Wege ---------- */
let planMap, routeLayers, routes = [], chosen = -1, dest = null, shareVia = 'sms';
$('#walkBtn').addEventListener('click', openPlanner);
function openPlanner() {
  show('planner');
  if (!planMap) { planMap = makeMap('planMap', { dragging: true }); routeLayers = L.layerGroup().addTo(planMap); drawSafe(planMap); }
  if (fix) planMap.setView([fix.lat, fix.lon], 15);
  document.querySelectorAll('.cName').forEach(e => e.textContent = S.contact || 'deinen Kontakt');
  renderSaved();
}
function renderSaved() {
  const el = $('#savedList'); el.innerHTML = '';
  const places = Object.entries(S.places || {});
  if (!places.length) el.innerHTML = '<p class="hint">Tipp: Such deine Adresse und speichere sie als „Zuhause“.</p>';
  places.forEach(([k, p]) => { const b = document.createElement('button'); b.className = 'item'; b.innerHTML = `<span class="ic">${k === 'Zuhause' ? '🏠' : '⭐'}</span><span>${esc(k)}<small>${esc(p.label)}</small></span>`; b.onclick = () => pickDest({ ...p, name: k }); el.appendChild(b); });
}
let searchT, searchSeq = 0;
$('#searchInput').addEventListener('input', e => { clearTimeout(searchT); const q = e.target.value.trim(); if (q.length < 3) { $('#searchResults').innerHTML = ''; return; } searchT = setTimeout(() => search(q), 650); });
async function search(q) {
  const seq = ++searchSeq, el = $('#searchResults'); el.innerHTML = '<p class="hint">Suche…</p>';
  const [[s, w], [n, e]] = REGION.bounds;
  try {
    const r = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=de&accept-language=de&bounded=1&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return; el.innerHTML = '';
    if (!r.length) { el.innerHTML = `<p class="hint">Nichts gefunden in ${REGION.name}. Versuch es mit Straße und Hausnummer.</p>`; return; }
    r.forEach(x => { const b = document.createElement('button'); b.className = 'item'; const parts = x.display_name.split(', '); b.innerHTML = `<span class="ic">📍</span><span>${esc(parts.slice(0, 2).join(', '))}<small>${esc(parts.slice(2, 4).join(', '))}</small></span>`; b.onclick = () => pickDest({ lat: +x.lat, lon: +x.lon, label: parts.slice(0, 3).join(', '), name: parts[0] }); el.appendChild(b); });
  } catch { if (seq === searchSeq) el.innerHTML = '<p class="hint">Suche gerade nicht erreichbar. Prüfe deine Verbindung.</p>'; }
}
async function pickDest(d) {
  dest = d; $('#searchResults').innerHTML = ''; $('#searchInput').value = d.label || d.name;
  $('#routeBox').hidden = false; $('#routeList').innerHTML = '<p class="hint">Luna sucht helle Wege…</p>'; $('#goBtn').disabled = true; $('#litNote').textContent = '';
  if (!fixFresh()) { $('#routeList').innerHTML = '<p class="hint">Ich brauche erst deinen Standort. Sobald er da ist, tippe das Ziel noch einmal an.</p>'; return; }
  const a = [fix.lat, fix.lon], b = [d.lat, d.lon];
  try {
    const r = await fetchJSON(`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a[1]},${a[0]};${b[1]},${b[0]}?alternatives=3&overview=full&geometries=geojson&steps=false`, {}, 20000);
    if (!r.routes || !r.routes.length) throw new Error('keine Route');
    routes = r.routes.map(x => ({ coords: x.geometry.coordinates.map(c => [c[1], c[0]]), dist: x.distance, dur: Math.max(x.duration, x.distance / 1.25), lit: null }));
  } catch {
    const dd = dist(a, b); routes = [{ coords: [a, b], dist: dd * 1.3, dur: dd * 1.3 / 1.25, lit: null, straight: true }];
    $('#litNote').textContent = 'Routenplaner nicht erreichbar – ich schätze die Zeit über die Luftlinie.';
  }
  chosen = 0; renderRoutes(); drawRoutes(); $('#goBtn').disabled = false;
  scoreLit().then(() => { renderRoutes(); drawRoutes(); }).catch(() => { $('#litNote').textContent = 'Beleuchtungsdaten gerade nicht erreichbar. Die Wege funktionieren trotzdem.'; });
}
/* Beleuchtung: OSM lit=* der Wege entlang der Route (vorab je Stadt gespeichert, sonst live per Overpass) */
let litFiles = null;
async function loadLitFiles() {
  if (litFiles) return litFiles;
  const r = await Promise.all(CITIES.filter(c => c.litFile).map(c => fetchJSON(c.litFile + '?v=' + VERSION, {}, 30000).catch(() => null)));
  return (litFiles = r.filter(Boolean));
}
async function scoreLit() {
  const all = routes.flatMap(r => r.coords); if (routes[0].straight) return;
  let s = Math.min(...all.map(c => c[0])), n = Math.max(...all.map(c => c[0])), w = Math.min(...all.map(c => c[1])), e = Math.max(...all.map(c => c[1]));
  const p = 0.002, bb = [s - p, w - p, n + p, e + p];
  const grid = new Map(), G = 0.0008, key = (la, lo) => Math.floor(la / G) + ':' + Math.floor(lo / G);
  const add = (v, pts) => { for (let i = 1; i < pts.length; i++) { const A = pts[i - 1], B = pts[i]; if (Math.max(A[0], B[0]) < bb[0] || Math.min(A[0], B[0]) > bb[2] || Math.max(A[1], B[1]) < bb[1] || Math.min(A[1], B[1]) > bb[3]) continue; const sg = { A, B, v }; const k = key((A[0] + B[0]) / 2, (A[1] + B[1]) / 2); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(sg); } };
  const files = await loadLitFiles();
  if (files.length) files.forEach(f => f.ways.forEach(wy => { const pts = []; for (let i = 1; i < wy.length; i += 2) pts.push([wy[i], wy[i + 1]]); add(wy[0], pts); }));
  else { const d = await overpass(`[out:json][timeout:25];way(${bb.join(',')})["highway"]["lit"];out geom tags;`);
    d.elements.forEach(x => { if (!x.geometry) return; const l = x.tags.lit; const v = l === 'no' ? 0 : (l === 'yes' || /^\d|24\/7|automatic|sunset|limited/.test(l)) ? 1 : null; if (v !== null) add(v, x.geometry.map(g => [g.lat, g.lon])); }); }
  const near = pt => { const gi = Math.floor(pt[0] / G), gj = Math.floor(pt[1] / G); let best = null, bd = 18;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) (grid.get((gi + i) + ':' + (gj + j)) || []).forEach(sg => { const dd = segDist(pt, sg.A, sg.B); if (dd < bd) { bd = dd; best = sg; } }); return best; };
  routes.forEach(r => { let yes = 0, no = 0, unk = 0; r.litParts = [];
    for (let i = 1; i < r.coords.length; i++) { const A = r.coords[i - 1], B = r.coords[i], len = dist(A, B), m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], sg = near(m);
      if (!sg) unk += len; else if (sg.v) { yes += len; r.litParts.push([A, B]); } else no += len; }
    const t = yes + no + unk || 1; r.lit = { yes: yes / t, no: no / t, unk: unk / t }; });
  const minDur = Math.min(...routes.map(r => r.dur));
  let best = 0, bs = -1; routes.forEach((r, i) => { const sc = r.lit.yes - 0.6 * r.lit.no - 0.5 * (r.dur / minDur - 1); if (sc > bs) { bs = sc; best = i; } });
  routes.forEach((r, i) => r.best = i === best); chosen = best;
  $('#litNote').textContent = 'Helle Wege nach OpenStreetMap: gold = beleuchtet eingetragen. Nicht jede Laterne ist erfasst.';
}
function segDist(P, A, B) { const k = Math.cos(P[0] * Math.PI / 180) * 111320, kk = 110540; const ax = (A[1] - P[1]) * k, ay = (A[0] - P[0]) * kk, bx = (B[1] - P[1]) * k, by = (B[0] - P[0]) * kk; const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? -(ax * dx + ay * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(ax + t * dx, ay + t * dy); }
function renderRoutes() {
  const el = $('#routeList'); el.innerHTML = ''; const minDur = Math.min(...routes.map(r => r.dur));
  routes.forEach((r, i) => { const b = document.createElement('button'); b.className = 'item' + (i === chosen ? ' sel' : '');
    const tags = (r.best ? '<span class="badge">✨ Hellster Weg</span>' : '') + (r.dur === minDur && routes.length > 1 ? '<span class="badge">Kürzester</span>' : '');
    const lit = r.lit ? `<div class="litbar"><i style="width:${Math.round(r.lit.yes * 100)}%"></i></div><small>${Math.round(r.lit.yes * 100)} % beleuchtet · ${Math.round(r.lit.no * 100)} % dunkel · Rest unbekannt</small>` : '<small>Beleuchtung wird geprüft…</small>';
    b.innerHTML = `<span class="ic">${i === chosen ? '🏮' : '🚶'}</span><span style="flex:1">${fmtMin(r.dur)} · ${(r.dist / 1000).toFixed(1)} km${tags}${lit}</span>`;
    b.onclick = () => { chosen = i; renderRoutes(); drawRoutes(); }; el.appendChild(b); });
}
function drawRoutes() {
  routeLayers.clearLayers();
  routes.forEach((r, i) => { if (i !== chosen) L.polyline(r.coords, { color: '#B9A58C', weight: 5, opacity: .6, dashArray: '6 8' }).on('click', () => { chosen = i; renderRoutes(); drawRoutes(); }).addTo(routeLayers); });
  const r = routes[chosen]; L.polyline(r.coords, { color: '#6E5A8A', weight: 6, opacity: .85 }).addTo(routeLayers);
  (r.litParts || []).forEach(p => L.polyline(p, { color: '#FFC24D', weight: 8, opacity: .95, className: 'lit-glow' }).addTo(routeLayers));
  L.marker([dest.lat, dest.lon], { icon: L.divIcon({ className: '', html: '<div style="font-size:26px">🏠</div>', iconSize: [28, 28], iconAnchor: [14, 24] }) }).addTo(routeLayers);
  planMap.fitBounds(L.latLngBounds(r.coords).pad(.15));
}
$('#saveHomeBtn').addEventListener('click', () => { if (!dest) return; S.places = S.places || {}; S.places.Zuhause = { lat: dest.lat, lon: dest.lon, label: dest.label || dest.name }; save(); toast('🏠 Als Zuhause gespeichert'); renderSaved(); });
$('#shareVia').addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; shareVia = v; [...$('#shareVia').children].forEach(b => b.classList.toggle('on', b.dataset.v === v)); });
$('#goBtn').addEventListener('click', startWalk);

/* ---------- Heimweg ---------- */
let walk = null, walkMap, walkLayers, tickT, wakeLock = null, lastSay = 0, checkMode = null, checkT;
const SAY = {
  start: ['Los geht’s. Ich bin bei dir.', 'Schön, dass ich mitkommen darf.', 'Wir gehen den hellen Weg.'],
  mid: ['Du machst das gut.', 'Atme ruhig ein – und aus.', 'Ich leuchte dir den Weg.', 'Schau mal, die Laternen sind an.', 'Schritt für Schritt.'],
  near: ['Gleich geschafft!', 'Ich sehe schon dein Zuhause.', 'Nur noch ein kleines Stück.'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];
function startWalk() {
  const r = routes[chosen]; if (!r || !dest) return;
  const buffer = Math.max(300, r.dur * 0.25);
  walk = { start: Date.now(), deadline: Date.now() + (r.dur + buffer) * 1000, dur: r.dur, dest, coords: r.coords, litParts: r.litParts || [], from: [fix.lat, fix.lon], total: dist([fix.lat, fix.lon], [dest.lat, dest.lon]) || 1, trail: [], askedStill: 0 };
  S.walk = walk; save();
  openWalk();
  if ($('#shareOnStart').checked) {
    const end = new Date(walk.deadline).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const msg = `Hi ${S.contact}, ich gehe jetzt nach ${dest.name || dest.label} (ca. ${fmtMin(r.dur)}, spätestens ${end} Uhr da). Hier bin ich gerade: ${mapLink(fix.lat, fix.lon)} – Laterne 🏮`;
    setTimeout(() => { location.href = shareVia === 'wa' ? waHref(msg) : smsHref(msg); }, 400);
  }
}
function resumeWalk() { walk = S.walk; openWalk(); }
function openWalk() {
  show('walk');
  if (!walkMap) { walkMap = makeMap('walkMap'); walkLayers = L.layerGroup().addTo(walkMap); drawSafe(walkMap); }
  walkLayers.clearLayers();
  L.polyline(walk.coords, { color: '#6E5A8A', weight: 6, opacity: .8 }).addTo(walkLayers);
  walk.litParts.forEach(p => L.polyline(p, { color: '#FFC24D', weight: 8, className: 'lit-glow' }).addTo(walkLayers));
  L.marker([walk.dest.lat, walk.dest.lon], { icon: L.divIcon({ className: '', html: '<div style="font-size:26px">🏠</div>', iconSize: [28, 28], iconAnchor: [14, 24] }) }).addTo(walkLayers);
  walkLayers.me = L.marker(walk.from, { icon: meIcon() }).addTo(walkLayers); walkLayers.acc = L.circle(walk.from, { radius: fix ? fix.acc : 20, color: '#4F7BE8', weight: 1, fillOpacity: .08 }).addTo(walkLayers);
  setTimeout(() => { walkMap.invalidateSize(); walkMap.fitBounds(L.latLngBounds(walk.coords).pad(.2), { paddingBottomRight: [0, 200] }); }, 80);
  $('#walkDest').textContent = '→ ' + (walk.dest.name || walk.dest.label);
  $('#walker').classList.add('walking');
  bubble('#walkBubble', pick(SAY.start)); lastSay = Date.now();
  requestWake(); clearInterval(tickT); tickT = setInterval(tick, 1000); tick(); setProgress(0);
  startLocation();
}
async function requestWake() {
  const note = $('#wakeNote');
  if (!('wakeLock' in navigator)) { note.textContent = '⚠️ Bitte lass den Bildschirm an – dein Browser kann ihn nicht wach halten.'; return; }
  try { wakeLock = await navigator.wakeLock.request('screen'); note.textContent = '🔆 Bildschirm bleibt an, solange wir unterwegs sind.'; wakeLock.addEventListener('release', () => { wakeLock = null; }); }
  catch { note.textContent = '⚠️ Bitte lass den Bildschirm an, damit ich bei dir bleiben kann.'; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && walk) { if (!wakeLock) requestWake(); tick(); } });
function setProgress(p) {
  p = Math.max(0, Math.min(1, p)); walk.progress = p;
  $('#pathFill').style.width = `calc(${p * 100}% - ${p * 30}px)`; $('#walker').style.left = `calc(${p * 100}% - ${p * 40}px)`;
  document.querySelector('#walk').style.setProperty('--glow', (0.15 + 0.85 * p).toFixed(2));
}
function onWalkPos() {
  const ll = [fix.lat, fix.lon]; walkLayers.me && walkLayers.me.setLatLng(ll); walkLayers.acc && walkLayers.acc.setLatLng(ll).setRadius(fix.acc);
  if (fix.acc > 60) return;
  const left = dist(ll, [walk.dest.lat, walk.dest.lon]);
  setProgress(1 - left / walk.total);
  walk.trail.push([Date.now(), fix.lat, fix.lon]); walk.trail = walk.trail.filter(t => Date.now() - t[0] < 240000);
  if (left < 40 && !walk.nearHome) { walk.nearHome = true; bubble('#walkBubble', 'Wir sind da! Tipp auf „Bin angekommen“.'); $('#arrivedBtn').classList.add('nudge'); vib([60, 60, 60]); }
}
function tick() {
  if (!walk) return; const now = Date.now(), rem = walk.deadline - now;
  $('#walkTimer').textContent = fmtClock(rem);
  if (current === 'walk' && now - lastSay > 75000) { const p = walk.progress || 0; bubble('#walkBubble', pick(p > .75 ? SAY.near : SAY.mid)); lastSay = now; }
  // Stehen bleiben: >3 Min. kaum Bewegung (< 20 m), nicht schon am Ziel
  const tr = walk.trail; if (!checkMode && !walk.nearHome && tr.length > 3 && now - tr[0][0] > 180000 && now - walk.askedStill > 300000) {
    const mx = Math.max(...tr.map(t => dist([t[1], t[2]], [tr[0][1], tr[0][2]])));
    if (mx < 20) { walk.askedStill = now; openCheck('still'); }
  }
  if (rem <= 0 && !checkMode) openCheck('time');
  if (now % 10000 < 1000) { S.walk = walk; save(); }
}
$('#plus10').addEventListener('click', () => { walk.deadline = Math.max(walk.deadline, Date.now()) + 600000; S.walk = walk; save(); tick(); bubble('#walkBubble', 'Klar, wir lassen uns Zeit. 10 Minuten mehr.'); });
$('#arrivedBtn').addEventListener('click', arrive);
$('#cancelWalk').addEventListener('click', () => { if (confirm('Heimweg wirklich beenden? Es wird keine Nachricht verschickt.')) { endWalk(); show('home'); } });
function endWalk() { clearInterval(tickT); walk = null; delete S.walk; save(); $('#arrivedBtn').classList.remove('nudge'); if (wakeLock) wakeLock.release().catch(() => {}); wakeLock = null; closeCheck(); }

/* Nachfrage mit Countdown */
function openCheck(mode) {
  checkMode = mode; let n = 60; show('check'); vib([200, 100, 200]);
  $('#checkTitle').textContent = mode === 'time' ? 'Bist du gut angekommen?' : `Alles okay, ${S.name}?`;
  $('#checkText').textContent = mode === 'time' ? 'Die Zeit ist um. Wenn du nicht antwortest, bereite ich eine Nachricht an ' + S.contact + ' vor.' : 'Du stehst schon eine Weile. Wenn du nicht antwortest, bereite ich eine Nachricht an ' + S.contact + ' vor.';
  $('#checkOk').textContent = mode === 'time' ? 'Ja, bin angekommen' : 'Ja, alles gut';
  const end = Date.now() + 60000; $('#checkCount').textContent = n;
  clearInterval(checkT); checkT = setInterval(() => { n = Math.ceil((end - Date.now()) / 1000); $('#checkCount').textContent = Math.max(0, n); if (n % 10 === 0) vib(150); if (n <= 0) { closeCheck(); startAlarm('Keine Antwort'); } }, 500);
}
function closeCheck() { clearInterval(checkT); checkMode = null; }
$('#checkOk').addEventListener('click', () => { const m = checkMode; closeCheck(); if (m === 'time') arrive(); else { show('walk'); bubble('#walkBubble', 'Gut. Ich bin weiter bei dir.'); } });
$('#checkMore').addEventListener('click', () => { closeCheck(); if (walk) { walk.deadline = Math.max(walk.deadline, Date.now()) + 600000; S.walk = walk; save(); show('walk'); bubble('#walkBubble', 'Okay, 10 Minuten mehr. Ich bleibe bei dir.'); } else show('home'); });

/* ---------- 8 Ankommen ---------- */
function arrive() {
  const d = walk ? (walk.dest.name || 'Ziel') : 'Zuhause'; endWalk();
  const msg = `Bin gut angekommen 🏠 – ${S.name}`;
  $('#arrivedSms').href = smsHref(msg); $('#arrivedWa').href = waHref(msg);
  $('#arrivedTitle').textContent = /zuhause/i.test(d) ? `Du bist zu Hause, ${S.name}.` : `Gut angekommen, ${S.name}.`;
  const a = $('#arrived'); a.querySelectorAll('.burst,.luna').forEach(el => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
  show('arrived'); vib([80, 60, 80, 60, 200]);
}
$('#arrivedClose').addEventListener('click', () => { show('home'); greet(); });

/* ---------- 6 Diskreter Notfall ---------- */
function holdable(btn) {
  let t = null;
  const down = e => { e.preventDefault(); btn.classList.add('holding'); vib(30); t = setTimeout(() => { btn.classList.remove('holding'); t = null; startAlarm('Notfall-Knopf'); }, 2000); };
  const up = () => { if (t) { clearTimeout(t); t = null; if (btn.classList.contains('holding')) toast('2 Sekunden gedrückt halten für den Notfall'); } btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', down); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, up));
  btn.addEventListener('contextmenu', e => e.preventDefault());
}
holdable($('#sosBtn')); holdable($('#sosBtn2'));
let alarmT, alarmBack = 'home';
function startAlarm(reason) {
  alarmBack = walk ? 'walk' : 'home'; show('alarm'); vib([300, 150, 300]);
  $('#alarmReady').hidden = true; $('#alarmCancel').hidden = false; $('#alarmCount').hidden = false; $('#alarmTitle').textContent = 'Notfall wird vorbereitet';
  const end = Date.now() + 5000; $('#alarmCount').textContent = 5;
  clearInterval(alarmT); alarmT = setInterval(() => { const n = Math.ceil((end - Date.now()) / 1000); $('#alarmCount').textContent = Math.max(0, n); if (n <= 0) { clearInterval(alarmT); alarmReady(reason); } }, 200);
}
function alarmReady(reason) {
  $('#alarmCancel').hidden = true; $('#alarmCount').hidden = true; $('#alarmTitle').textContent = `${S.contact} Bescheid geben`; $('#alarmReady').hidden = false; vib([500]);
  let where = 'Mein Standort ist gerade nicht verfügbar.';
  if (fix) where = `Mein Standort (± ${Math.round(fix.acc)} m, ${new Date(fix.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr): ${mapLink(fix.lat, fix.lon)}`;
  $('#alarmSms').href = smsHref(`⚠️ ${S.name} braucht Hilfe (${reason}). ${where} Bitte ruf mich an oder wähle 110. – Laterne`);
}
$('#alarmCancel').addEventListener('click', () => { clearInterval(alarmT); show(alarmBack); toast('Abgebrochen. Alles gut.'); });
$('#alarmClose').addEventListener('click', () => { show(walk ? 'walk' : 'home'); });

/* ---------- 5 Fake-Anruf ---------- */
let fcVib, fcTimerT, audio;
function startFake() {
  $('#fcName').textContent = S.caller || 'Mama'; $('#fcAvatar').textContent = (S.caller || 'M')[0].toUpperCase();
  $('#fakecall').classList.remove('oncall'); $('#fcTimer').hidden = true; show('fakecall');
  const v = () => vib([900, 600]); v(); fcVib = setInterval(v, 1500);
  try { const C = window.AudioContext || window.webkitAudioContext; audio = new C(); const g = audio.createGain(); g.gain.value = 0; g.connect(audio.destination);
    [440, 480].forEach(f => { const o = audio.createOscillator(); o.frequency.value = f; o.connect(g); o.start(); });
    const now = audio.currentTime; for (let i = 0; i < 30; i++) { g.gain.setValueAtTime(.08, now + i * 3); g.gain.setValueAtTime(0, now + i * 3 + 1.2); } } catch {}
}
function stopRing() { clearInterval(fcVib); vib(0); try { audio && audio.close(); } catch {} audio = null; }
function endFake() { stopRing(); clearInterval(fcTimerT); show(walk ? 'walk' : 'home'); }
$('#fakeBtn').addEventListener('click', startFake); $('#fakeBtn2').addEventListener('click', startFake);
$('#fcDecline').addEventListener('click', endFake);
$('#fcAccept').addEventListener('click', () => { stopRing(); $('#fakecall').classList.add('oncall'); $('#fcTimer').hidden = false; const s = Date.now(); fcTimerT = setInterval(() => $('#fcTimer').textContent = fmtClock(Date.now() - s), 500); });

/* ---------- 7 Hilfe vor Ort ---------- */
function isOpen(h) { if (!h) return null; const d = new Date(), wd = d.getDay(), hr = d.getHours() + d.getMinutes() / 60;
  const t = h[wd]; if (t && hr >= t[0] && hr < Math.min(t[1], 24)) return true;
  const y = h[(wd + 6) % 7]; if (y && y[1] > 24 && hr < y[1] - 24) return true; return false; }
$('#helpBtn').addEventListener('click', () => {
  document.querySelectorAll('.cityName').forEach(e => e.textContent = REGION.name);
  $('#helpList').innerHTML = REGION.help.map(h => { const o = isOpen(h.hours);
    return `<div class="card help-item${h.urgent ? ' urgent' : ''}"><div><h3>${esc(h.title)}</h3><p class="hint">${esc(h.note)}</p>${h.hoursText ? `<p class="hint">${esc(h.hoursText)} · <span class="${o ? 'open' : 'closed'}">${o ? 'jetzt erreichbar' : 'gerade geschlossen'}</span></p>` : ''}</div><a class="btn ${h.urgent ? 'btn-primary' : 'btn-soft'}" href="tel:${h.number.replace(/\s/g, '')}">📞 ${esc(h.number)}</a></div>`; }).join('')
    + '<p class="hint center">Leuchtende Punkte auf der Karte: Polizei, Tankstellen, Bahnhof, Apotheken – Orte, an denen du Menschen findest.</p>';
  show('help');
});

/* ---------- 9 Infos & Einstellungen ---------- */
$('#infoBtn').addEventListener('click', () => { $('#setName').value = S.name || ''; $('#setContact').value = S.contact || ''; $('#setPhone').value = S.phone || ''; $('#setCaller').value = S.caller || 'Mama'; $('#versionNote').textContent = `Laterne ${VERSION} · ${REGION.name} · Kartendaten © OpenStreetMap`; show('info'); });
$('#saveSettings').addEventListener('click', () => { if (!validPhone($('#setPhone').value)) { toast('Bitte eine gültige Handynummer eingeben.'); return; } S.name = $('#setName').value.trim() || S.name; S.contact = $('#setContact').value.trim() || S.contact; S.phone = normPhone($('#setPhone').value); S.caller = $('#setCaller').value.trim() || 'Mama'; save(); toast('Gespeichert 💛'); });
$('#resetAll').addEventListener('click', () => { if (confirm('Alle Daten von Laterne auf diesem Handy löschen?')) { localStorage.removeItem(KEY); location.reload(); } });

/* ---------- Service Worker ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js?v=' + VERSION).then(r => r.update()).catch(() => {});
  let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !walk && current === 'splash') { reloaded = true; location.reload(); } });
}
window.addEventListener('error', e => console.error('Laterne-Fehler:', e.message));
