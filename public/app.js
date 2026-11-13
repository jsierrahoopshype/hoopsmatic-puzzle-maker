// Puzzle Maker page. Views by query: (none) the Daily, ?p=<id> a reader's
// puzzle, ?mode=practice, ?mode=make, ?mode=browse. The server
// (hoopsmatic-worker puzzle-maker-server, /puzzle-maker/api/*) holds the
// answers and judges every guess; the maker runs core.js here for live
// suggestions, fairness and difficulty, and the server checks again.
// Nothing pops up: every message is inline. User text (titles, maker names)
// only ever goes in through textContent.
import { buildCatalog, checkPuzzle, suggest, candidates, fit, headUrl, usable, TYPE_NAMES, SQUARES } from './core.js';

const SITE = '/puzzle-maker/';
const API = '/puzzle-maker/api/';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
// A random id for this browser; the server keeps only a keyed hash of it.
function device() {
  let d = store.get('pm-device');
  if (typeof d !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(d)) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    d = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.set('pm-device', d);
  }
  return d;
}
async function api(path, body) {
  const r = await fetch(API + path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null;
  try { j = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok) { const e = new Error((j && j.error) || 'http_' + r.status); e.body = j; e.status = r.status; throw e; }
  return j;
}
// The headshot frame, the same everywhere: a light-grey panel with the
// NBA.com cutout bottom-aligned at one fixed aspect (260x190), so every player
// shows head to shoulders at the same scale and nothing is cut at the top.
// With no photo (or one that fails to load) the frame holds the name instead:
// never initials, never an empty circle.
function frame(head, name, cls) {
  const box = el('span', 'ph' + (cls ? ' ' + cls : ''));
  const src = headUrl(head);
  const noPhoto = () => { box.textContent = ''; box.classList.add('nophoto'); if (name) box.appendChild(nameBlock(name, 'in')); };
  if (!src) { noPhoto(); return box; }
  const img = el('img');
  img.alt = ''; img.decoding = 'async'; img.width = 260; img.height = 190; img.src = src;
  img.onerror = noPhoto;
  box.appendChild(img);
  return box;
}
function addHead(parent, head, cls, name) { parent.appendChild(frame(head, name, cls)); }
// A last name stays on one line and shrinks until it fits its tile (down to
// 10px); a name still too long wraps to two lines.
function fitNames(root) {
  requestAnimationFrame(() => {
    for (const ln of root.querySelectorAll('.tile .nm .ln')) {
      ln.style.fontSize = '';
      let fs = parseFloat(getComputedStyle(ln).fontSize);
      ln.classList.remove('wrap');
      while (ln.scrollWidth > ln.clientWidth + 0.5 && fs > 10) { fs -= 0.5; ln.style.fontSize = fs + 'px'; }
      // Still too long at 10px (Gilgeous-Alexander on a small phone): two lines.
      if (ln.scrollWidth > ln.clientWidth + 0.5) { ln.classList.add('wrap'); ln.style.fontSize = '10.5px'; }
    }
  });
}
addEventListener('resize', () => fitNames(document));
// First name small, last name bold (Jr./II stay with the last name).
function nameBlock(full, cls) {
  const parts = String(full).split(' ');
  let i = parts.length - 1;
  while (i > 1 && /^(Jr\.?|Sr\.?|II|III|IV)$/.test(parts[i])) i--;
  const first = parts.slice(0, i).join(' '), last = parts.slice(i).join(' ');
  const b = el('span', 'nm' + (cls ? ' ' + cls : ''));
  if (first) b.appendChild(el('span', 'fn', first));
  const l = el('span', 'ln' + (last.length > 13 ? ' xl' : last.length > 9 ? ' l' : ''), last);
  b.appendChild(l);
  return b;
}
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const pid = params.get('p');
// A Daily's own page: /puzzle-maker/YYYY-MM-DD/ (scripts/pages.mjs).
const DAY = (location.pathname.match(/\/puzzle-maker\/(\d{4}-\d{2}-\d{2})\/?$/) || [])[1] || null;

function fatal(t) { $('loading').classList.add('hide'); const f = $('fatal'); f.textContent = t; f.classList.remove('hide'); }
function showView(id, tab) {
  $('loading').classList.add('hide');
  for (const v of ['play', 'make', 'browse']) $(v).classList.toggle('hide', v !== id);
  // No tabs (Jorge, Nov 13, 2026): the page opens on the Daily; other views get a way back.
  $('back').classList.toggle('hide', tab === 'daily');
}

// ====================================================================
// Solving
// ====================================================================
let RUN = null;   // { token, puzzle, state, sel:Set, order:[ids], guesses:[[ids]] }
const runKey = (p) => p.kind === 'd' ? 'pm-run-d-' + p.date : p.kind === 'u' ? 'pm-run-u-' + p.id : null;

async function startRun(kind, extra = {}) {
  showView('play', kind === 'daily' && !DAY ? 'daily' : kind === 'practice' ? 'practice' : null);
  // Resume today's Daily or a reader's puzzle where this browser left it.
  const saved = kind === 'daily' ? store.get('pm-run-d-' + (extra.date || (await todayInfo())?.date)) : kind === 'puzzle' ? store.get('pm-run-u-' + extra.id) : null;
  try {
    // A saved run resumes only if it is still the same puzzle (Dailies made
    // before a rebuild are dropped).
    const T = kind === 'daily' ? await todayInfo() : null;
    // A past Daily page (extra.date) resumes its own saved run; today's checks the tiles.
    const same = kind !== 'daily' || (extra.date && extra.date !== (T && T.date) ? !!saved : (T && saved && saved.date === T.date && saved.puzzle && saved.puzzle.tiles.map((x) => x.id).join() === T.tiles.map((x) => x.id).join()));
    if (saved && saved.token && saved.state && same) {
      RUN = { token: saved.token, puzzle: saved.puzzle, state: saved.state, guesses: saved.guesses || [] };
    } else {
      const r = await api('start', { kind, device: device(), ...extra });
      RUN = { token: r.token, puzzle: r.puzzle, state: r.state, guesses: [] };
      saveRun();
    }
  } catch (e) {
    if (e.message === 'no_puzzle') return fatal(kind === 'puzzle' ? 'That puzzle doesn’t exist or was removed.' : 'No puzzle today yet. Try practice.');
    if (e.message === 'not_found' && extra.date) return fatal('This Daily isn’t out yet. It opens at 9:00 AM ET on its day.');
    return fatal('The game server couldn’t be reached. Refresh to try again.');
  }
  RUN.sel = new Set();
  const solvedIds = new Set(RUN.state.solved.flatMap((g) => g.players.map((p) => p.id)));
  RUN.order = RUN.puzzle.tiles.map((t) => t.id).filter((id) => !solvedIds.has(id));
  drawPlay();
  if (RUN.state.done) endRun();
}
let _today = null;
async function todayInfo() { if (!_today) { try { _today = await api('today'); } catch (e) { _today = null; } } return _today; }
function saveRun() {
  if (!RUN) return;
  const p = RUN.puzzle;
  const v = { token: RUN.token, puzzle: p, state: RUN.state, guesses: RUN.guesses, date: p.date };
  if (p.kind === 'd') store.set('pm-run-d-' + p.date, v);
  else if (p.kind === 'u') store.set('pm-run-u-' + p.id, v);
}

function drawPlay() {
  const p = RUN.puzzle, s = RUN.state;
  const meta = $('play-meta'); meta.textContent = '';
  if (p.kind === 'd') meta.append((p.n ? `Daily #${p.n}` : 'Daily (preview)') + (DAY ? ' · ' + new Date(p.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''));
  else if (p.kind === 'p') meta.append(p.level === 'hard' ? 'Hard practice' : 'Practice');
  if (p.title) { if (meta.textContent) meta.append(' · '); meta.appendChild(el('b', null, p.title)); }
  if (p.maker) meta.append(` by ${p.maker}`);
  if (p.kind === 'd' && p.source === 'data') meta.append(' · built from the data');
  if (p.difficulty) { meta.append(' '); meta.appendChild(el('span', 'diff ' + p.difficulty.label, p.difficulty.label)); }
  // Solved rows, easiest first as found.
  const sv = $('solved'); sv.textContent = '';
  for (const g of s.solved) sv.appendChild(groupRow(g));
  const tileOf = new Map(p.tiles.map((t) => [t.id, t]));
  const grid = $('grid'); grid.textContent = '';
  for (const id of RUN.order) {
    const t = tileOf.get(id);
    const b = el('button', 'tile' + (RUN.sel.has(id) ? ' sel' : ''));
    b.type = 'button'; b.dataset.id = id;
    b.setAttribute('aria-pressed', RUN.sel.has(id) ? 'true' : 'false');
    b.appendChild(frame(t.head, t.name));
    b.appendChild(nameBlock(t.name));
    b.addEventListener('click', () => toggle(id));
    grid.appendChild(b);
  }
  fitNames(grid);
  grid.classList.toggle('hide', s.done);
  $('actions').classList.toggle('hide', s.done);
  const m = $('mist'); m.textContent = '';
  if (!s.done) { m.append('Mistakes left'); for (let i = 0; i < 4; i++) m.appendChild(el('i', i < s.left ? '' : 'used')); }
  $('submit').disabled = RUN.sel.size !== 4;
}
// A solved group: the four headshots in the same frame, then the label, then
// one evidence line per player (his name links to his HoopsMatic page).
function groupRow(g) {
  const row = el('div', 'grow ' + g.color);
  const faces = el('div', 'faces');
  for (const p of g.players) faces.appendChild(frame(p.head, p.name, 'mini'));
  row.appendChild(faces);
  row.appendChild(el('h3', null, g.label));
  const ul = el('ul');
  for (const p of g.players) {
    const li = el('li');
    if (p.link) { const a = el('a', null, p.name); a.href = p.link; li.appendChild(a); } else li.appendChild(el('b', null, p.name));
    if (p.why) li.append(' ', el('span', 'why', p.why));
    ul.appendChild(li);
  }
  row.appendChild(ul);
  return row;
}
function toggle(id) {
  if (RUN.state.done) return;
  if (RUN.sel.has(id)) RUN.sel.delete(id);
  else if (RUN.sel.size < 4) RUN.sel.add(id);
  $('play-msg').textContent = '';
  drawPlay();
}
$('shuffle').addEventListener('click', () => {
  const a = RUN.order;
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  drawPlay();
});
$('clear').addEventListener('click', () => { RUN.sel.clear(); drawPlay(); });
$('submit').addEventListener('click', async () => {
  if (RUN.sel.size !== 4) return;
  const ids = [...RUN.sel];
  $('submit').disabled = true;
  let r;
  try { r = await api('guess', { token: RUN.token, ids }); }
  catch (e) { say('Couldn’t reach the server. Try again.', true); $('submit').disabled = false; return; }
  RUN.token = r.token; RUN.state = r.state;
  if (r.result !== 'repeat') RUN.guesses.push(ids);
  if (r.badge) RUN.badge = r.badge;
  if (r.result === 'hit') { RUN.sel.clear(); RUN.order = RUN.order.filter((id) => !ids.includes(id)); say(''); }
  else if (r.result === 'one_away') { say('One away…', true); shake(ids); }
  else if (r.result === 'wrong') { say('Not a group.', true); shake(ids); }
  else if (r.result === 'repeat') say('You already tried those four.', true);
  saveRun();
  drawPlay();
  if (RUN.state.done) endRun();
});
function say(t, bad) { const m = $('play-msg'); m.textContent = t; m.classList.toggle('bad', !!bad); }
function shake(ids) {
  for (const b of $('grid').children) if (ids.includes(b.dataset.id)) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
}

function endRun() {
  const s = RUN.state, p = RUN.puzzle;
  // Every group, easiest first.
  const sv = $('solved'); sv.textContent = '';
  for (const g of s.groups) sv.appendChild(groupRow(g));
  $('grid').classList.add('hide'); $('actions').classList.add('hide'); $('mist').textContent = '';
  $('end').classList.remove('hide');
  $('end-line').textContent = s.won ? (s.mistakes === 0 ? 'Perfect' : 'Solved') : 'Out of mistakes';
  $('end-sub').textContent = s.won ? `${s.mistakes} mistake${s.mistakes === 1 ? '' : 's'} · ${s.guesses} guesses` : `${4 - (s.solved || []).length} group${4 - s.solved.length === 1 ? '' : 's'} left`;
  $('end-squares').textContent = s.grid || '';
  $('end-share').classList.remove('hide');
  $('end-keep').classList.remove('hide');
  if (p.kind === 'p') { $('keep-practice').textContent = 'Another practice puzzle'; if (p.level === 'hard') { $('keep-practice').href = SITE + '?mode=practice&level=hard'; $('keep-hard').classList.add('hide'); } }
  drawShare();
  if (p.kind === 'd') drawBoard();
  sendBadge();
  saveRun();
}

// ---------- share: text (squares) + the 73-9 block + an image ----------
function shareUrl() {
  const p = RUN.puzzle;
  return 'https://hoopsmatic.com/puzzle-maker/' + (p.kind === 'u' ? '?p=' + p.id : p.kind === 'p' ? '?mode=practice' : DAY ? DAY + '/' : '');
}
function shareHead() {
  const p = RUN.puzzle;
  if (p.kind === 'd') return p.n ? `Puzzle Maker #${p.n}` : 'Puzzle Maker Daily';
  if (p.kind === 'u') return `Puzzle Maker: ${p.title}`;
  return 'Puzzle Maker practice';
}
function resultWords() {
  const s = RUN.state;
  return s.won ? (s.mistakes === 0 ? 'Perfect, no mistakes' : `Solved with ${s.mistakes} mistake${s.mistakes === 1 ? '' : 's'}`) : 'Out of mistakes';
}
function shareText(withLink = true) {
  return `${shareHead()}\n${RUN.state.grid}\n${resultWords()}` + (withLink ? '\n' + shareUrl() : '');
}
const COLOR_HEX = { yellow: '#f5d26b', green: '#8fd18a', blue: '#8fb6f2', purple: '#c39bea' };
async function resultCanvas() {
  const s = RUN.state;
  const W = 1080, H = 1080, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  try { await document.fonts.ready; } catch (e) { /* fonts optional */ }
  g.fillStyle = '#0b0b1c'; g.fillRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#15153a'); bg.addColorStop(1, '#0a0a1a');
  g.fillStyle = bg; g.fillRect(36, 36, W - 72, H - 72);
  g.strokeStyle = '#3a3a6a'; g.lineWidth = 2; g.strokeRect(36, 36, W - 72, H - 72);
  g.textAlign = 'center';
  const tg = g.createLinearGradient(W / 2 - 260, 0, W / 2 + 260, 0); tg.addColorStop(0, '#ff6b35'); tg.addColorStop(1, '#ffd700');
  g.fillStyle = tg; g.font = '700 64px Oswald, sans-serif'; g.fillText('PUZZLE MAKER', W / 2, 140);
  g.fillStyle = '#aaaadd'; g.font = '500 30px Oswald, sans-serif';
  const sub = RUN.puzzle.kind === 'd' ? (RUN.puzzle.n ? `DAILY #${RUN.puzzle.n}` : 'DAILY') : RUN.puzzle.kind === 'p' ? 'PRACTICE' : 'A READER’S PUZZLE';
  g.fillText(sub, W / 2, 190);
  // One row of squares per guess (colors only: no players, no labels).
  const colorOf = new Map();
  for (const gr of s.groups) for (const p of gr.players) colorOf.set(p.id, gr.color);
  const rows = RUN.guesses.length ? RUN.guesses : s.grid.split('\n').map(() => []);
  const n = Math.max(rows.length, 1), size = Math.min(96, Math.floor(560 / n) - 12), gap = 14;
  const top = 250 + (600 - n * (size + gap)) / 2;
  rows.forEach((ids, r) => {
    for (let k = 0; k < 4; k++) {
      const x = W / 2 - (4 * size + 3 * gap) / 2 + k * (size + gap), y = top + r * (size + gap);
      g.fillStyle = COLOR_HEX[colorOf.get(ids[k])] || '#2a2a55';
      g.beginPath(); g.roundRect ? g.roundRect(x, y, size, size, 12) : g.rect(x, y, size, size); g.fill();
    }
  });
  g.fillStyle = '#ffffff'; g.font = '700 46px Oswald, sans-serif'; g.fillText(resultWords().toUpperCase(), W / 2, 920);
  g.fillStyle = '#888899'; g.font = '500 28px "DM Sans", sans-serif'; g.fillText('hoopsmatic.com/puzzle-maker', W / 2, 1000);
  return cv;
}
const SOC_ICON = {
    x:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93zM17.61 20.64h2.04L6.49 3.24H4.3z"/></svg>',
    bsky:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 10.8C10.91 8.69 7.95 4.75 5.2 2.81 2.57.94 1.56 1.27.9 1.57.14 1.91 0 3.08 0 3.77c0 .69.38 5.65.62 6.48.82 2.74 3.71 3.66 6.38 3.36-3.91.58-7.39 2.01-2.83 7.08 5.01 5.19 6.87-1.11 7.82-4.31.95 3.2 2.05 9.27 7.73 4.31 4.27-4.31 1.17-6.5-2.74-7.08 2.67.3 5.57-.63 6.38-3.36C23.62 9.42 24 4.46 24 3.77c0-.69-.14-1.86-.9-2.2-.66-.3-1.66-.62-4.3 1.24C16.05 4.75 13.09 8.69 12 10.8z"/></svg>',
    fb:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8v8.44C19.61 23.08 24 18.09 24 12.07z"/></svg>',
    wa:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15s-.77.97-.94 1.16c-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.14-.18.19-.3.29-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.43 9.88-9.88 9.88M20.46 3.49A11.81 11.81 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.42"/></svg>',
    reddit:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.74c.69 0 1.25.56 1.25 1.25a1.25 1.25 0 0 1-2.5.06l-2.6-.55-.8 3.75c1.83.07 3.48.63 4.68 1.49.31-.31.73-.49 1.21-.49.97 0 1.75.79 1.75 1.75 0 .72-.44 1.33-1.01 1.61.03.17.04.34.04.52 0 2.7-3.13 4.87-7 4.87-3.88 0-7-2.17-7-4.87 0-.18.01-.37.04-.53A1.75 1.75 0 0 1 4.03 12c0-.97.79-1.75 1.75-1.75.46 0 .9.2 1.21.49 1.21-.88 2.88-1.43 4.74-1.49l.89-4.18a.34.34 0 0 1 .14-.2.35.35 0 0 1 .24-.04l2.91.62a1.21 1.21 0 0 1 1.11-.7zM9.25 12c-.69 0-1.25.56-1.25 1.25 0 .69.56 1.25 1.25 1.25.69 0 1.25-.56 1.25-1.25 0-.69-.56-1.25-1.25-1.25zm5.5 0c-.69 0-1.25.56-1.25 1.25 0 .69.56 1.25 1.25 1.25.69 0 1.25-.56 1.25-1.25 0-.69-.56-1.25-1.25-1.25zm-5.47 3.99a.33.33 0 0 0-.23.09.33.33 0 0 0 0 .47c.84.84 2.48.91 2.96.91.48 0 2.11-.06 2.96-.91a.36.36 0 0 0 .03-.47.33.33 0 0 0-.46 0c-.55.53-1.69.73-2.51.73-.83 0-1.98-.2-2.51-.73a.33.33 0 0 0-.24-.09z"/></svg>',
    telegram:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11.94 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.06 0zm4.96 7.22c.1 0 .32.02.47.14a.51.51 0 0 1 .17.33c.02.09.04.31.02.47-.18 1.9-.96 6.5-1.36 8.63-.17.9-.5 1.2-.82 1.23-.7.06-1.23-.46-1.9-.9-1.06-.7-1.65-1.12-2.68-1.8-1.19-.78-.42-1.21.26-1.91.18-.18 3.25-2.98 3.31-3.23 0-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.1.02-1.79 1.14-5.06 3.34-.48.33-.91.49-1.3.48-.43 0-1.25-.24-1.86-.44-.75-.24-1.35-.37-1.3-.79.03-.21.33-.43.89-.66 3.5-1.52 5.83-2.53 7-3.01 3.33-1.39 4.02-1.63 4.48-1.63z"/></svg>'
};
const SOC = [['x', 'X'], ['bsky', 'Bluesky'], ['fb', 'Facebook'], ['wa', 'WhatsApp'], ['reddit', 'Reddit'], ['telegram', 'Telegram']];
function socialUrl(kind) {
  const url = shareUrl(), text = shareText(false);
  const u = encodeURIComponent(url), t = encodeURIComponent(text), tu = encodeURIComponent(text + '\n' + url);
  switch (kind) {
    case 'x': return 'https://twitter.com/intent/tweet?text=' + t + '&url=' + u;
    case 'bsky': return 'https://bsky.app/intent/compose?text=' + tu;
    case 'fb': return 'https://www.facebook.com/sharer/sharer.php?u=' + u;
    case 'wa': return 'https://wa.me/?text=' + tu;
    case 'reddit': return 'https://www.reddit.com/submit?url=' + u + '&title=' + encodeURIComponent(shareHead());
    case 'telegram': return 'https://t.me/share/url?url=' + u + '&text=' + t;
  }
  return url;
}
let shareBlob = null;
function drawShare() {
  resultCanvas().then((cv) => {
    try { $('share-img').src = cv.toDataURL('image/png'); cv.toBlob((b) => { shareBlob = b; }, 'image/png'); } catch (e) { /* no image */ }
  });
  $('share-url').value = shareUrl();
  const soc = $('share-social'); soc.textContent = '';
  for (const [k, name] of SOC) {
    const b = el('button', 'soc soc-' + k); b.type = 'button'; b.setAttribute('aria-label', 'Share on ' + name);
    b.innerHTML = SOC_ICON[k]; b.appendChild(el('span', null, name));
    b.addEventListener('click', () => window.open(socialUrl(k), '_blank', 'noopener,noreferrer'));
    soc.appendChild(b);
  }
  $('sh-again').textContent = RUN.puzzle.kind === 'p' ? 'New puzzle' : 'Practice';
}
const smsg = (t) => { $('share-msg').textContent = t; };
$('share-url').addEventListener('click', () => $('share-url').select());
$('share-copylink').addEventListener('click', async () => { try { await navigator.clipboard.writeText(shareText()); smsg('Squares + link copied.'); } catch (e) { smsg('Copy blocked here.'); } });
$('sh-download').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = $('share-img').src; a.download = 'puzzle-maker-result.png'; document.body.appendChild(a); a.click(); a.remove(); smsg('Saved to your downloads.');
});
$('sh-again').addEventListener('click', () => { location.href = SITE + '?mode=practice' + (RUN && RUN.puzzle.level === 'hard' ? '&level=hard' : ''); });

// ---------- the Daily leaderboard ----------
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
async function drawBoard() {
  const box = $('end-board'); box.classList.remove('hide');
  let b;
  try { b = await api('board/' + RUN.puzzle.date + '?token=' + encodeURIComponent(RUN.token)); }
  catch (e) { $('board-you').textContent = 'The leaderboard couldn’t load. Refresh to try again.'; return; }
  const you = b.you, line = $('board-you'); line.textContent = '';
  if (you) {
    line.append('You’re '); line.appendChild(el('b', null, `#${you.rank}`));
    line.append(` of ${you.of}: ${you.won ? 'solved' : 'not solved'}, ${you.mistakes} mistake${you.mistakes === 1 ? '' : 's'}, ${fmtTime(you.seconds)}` + (you.name ? `, as ${you.name}.` : '.'));
  } else line.textContent = 'Replays don’t count: your first attempt today is the one on the board.';
  $('board-form').classList.toggle('hide', !(you && !you.name));
  const ol = $('board-list'); ol.textContent = '';
  for (const x of b.top) {
    const li = el('li');
    li.append(el('span', 'br', `#${x.rank}`), el('span', null, x.name), el('span', 'bs', x.won ? `${x.mistakes} · ${fmtTime(x.seconds)}` : 'not solved'));
    ol.appendChild(li);
  }
  $('board-note').textContent = (b.preview ? 'Preview: the leaderboard starts counting on launch day. ' : '')
    + (b.top.length ? `Top ${b.top.length} named of ${b.entries}. Solved first, then fewest mistakes, then fastest.` : `${b.entries} finished so far. Add your name above.`);
}
$('board-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('board-name-in').value.trim();
  if (name.length < 2) { $('board-msg').textContent = 'Use 2 to 24 characters.'; return; }
  try { await api('board/name', { token: RUN.token, name }); $('board-msg').textContent = 'Saved.'; drawBoard(); }
  catch (x) { $('board-msg').textContent = x.message === 'bad_name' ? 'That name isn’t allowed. Try another.' : 'Couldn’t save the name. Try again.'; }
});

// ---------- badges (hoopsmatic-badges, game "puzzlemaker") ----------
function sendBadge() {
  if (!RUN || !RUN.badge || RUN.badgeSent) return;
  const go = () => {
    if (!window.HMGames || !window.HMGames.badgeResult) return false;
    window.HMGames.badgeResult('puzzlemaker', RUN.badge).then((reply) => { if (reply && (reply.ok || reply.error === 'receipt already used')) RUN.badgeSent = true; });
    return true;
  };
  if (!go()) window.addEventListener('load', go, { once: true });
}

// ====================================================================
// Making
// ====================================================================
let C = null;
const MK = { slots: [0, 1, 2, 3].map(() => ({ key: null, ids: [] })), me: null };
async function startMake() {
  showView('make', 'make');
  const draft = store.get('pm-draft');
  if (draft && Array.isArray(draft.slots) && draft.slots.length === 4) MK.slots = draft.slots.map((s) => ({ key: s.key || null, ids: Array.isArray(s.ids) ? s.ids.slice(0, 4) : [] }));
  if (draft) { $('mk-title').value = draft.title || ''; $('mk-maker').value = draft.maker || ''; }
  $('slots').textContent = 'Loading the player data…';
  try { C = buildCatalog(await (await fetch(SITE + 'data.json')).json()); }
  catch (e) { return fatal('The player data couldn’t load. Refresh to try again.'); }
  for (const s of MK.slots) s.ids = s.ids.filter((id) => C.players.has(id));
  drawMake();
  refreshMe();
}
async function refreshMe() {
  try { MK.me = await api('me', { device: device() }); } catch (e) { MK.me = null; }
  const gate = $('make-gate');
  if (!MK.me) gate.textContent = 'The game server couldn’t be reached; you can still build, but not publish yet.';
  else if (MK.me.canPublish) gate.textContent = `You’ve solved ${MK.me.solved} puzzles: you can publish.`;
  else { gate.textContent = `Solve ${MK.me.need - MK.me.solved} more puzzle${MK.me.need - MK.me.solved === 1 ? '' : 's'} (Daily, practice or readers’) to publish. You can build now.`; }
  if (MK.me && MK.me.puzzles.length) {
    $('mine').classList.remove('hide');
    $('mine-rating').textContent = MK.me.rating != null ? `Maker rating: ${MK.me.rating}/100 (how close your puzzles’ solve rates sit to the challenging-but-solvable middle).` : 'Your maker rating shows once a puzzle has 10 plays.';
    fillList($('mine-list'), MK.me.puzzles);
  }
  updateCheck();
}
const saveDraft = () => store.set('pm-draft', { slots: MK.slots, title: $('mk-title').value, maker: $('mk-maker').value });
$('mk-title').addEventListener('input', () => { saveDraft(); updateCheck(); });
$('mk-maker').addEventListener('input', saveDraft);

function nameIndex() {
  if (nameIndex.list) return nameIndex.list;
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  nameIndex.norm = norm;
  nameIndex.list = [...C.players.values()].filter(usable).map((p) => ({ p, n: norm(p.name) })).sort((a, b) => b.p.fame - a.p.fame);
  return nameIndex.list;
}
function searchPlayers(q) {
  const list = nameIndex(), n = nameIndex.norm(q.trim());
  if (n.length < 2) return [];
  return list.filter((x) => x.n.includes(n)).slice(0, 12).map((x) => x.p);
}
const used = () => new Set(MK.slots.flatMap((s) => s.ids));
const yrs = (p) => `${p.first - 1}-${String(p.last).slice(2)}`;

function drawMake() {
  const box = $('slots'); box.textContent = '';
  MK.slots.forEach((s, i) => box.appendChild(slotPanel(s, i)));
  updateCheck();
}
function playerChip(id, slot, bad) {
  const p = C.players.get(id);
  const c = el('span', 'pchip' + (bad ? ' bad' : ''));
  addHead(c, p.head, 'chip', p.name);
  if (p.link) { const a = el('a', null, p.name); a.href = p.link; a.target = '_blank'; a.rel = 'noopener'; c.appendChild(a); } else c.append(p.name);
  const x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + p.name);
  x.addEventListener('click', () => { slot.ids = slot.ids.filter((y) => y !== id); if (!slot.ids.length) slot.key = null; saveDraft(); drawMake(); });
  c.appendChild(x);
  return c;
}
function slotPanel(s, i) {
  const box = el('section', 'slot' + (s.key && s.ids.length === 4 ? ' done' : ''));
  box.appendChild(el('h3', null, `Group ${i + 1}`));
  const cat = s.key ? C.cats.get(s.key) : null;
  if (cat) {
    const lab = el('p', 'label', cat.label);
    const chg = el('button', 'ghost small', 'Change'); chg.type = 'button'; chg.style.marginLeft = '8px';
    chg.addEventListener('click', () => { s.key = null; saveDraft(); drawMake(); });
    lab.appendChild(chg);
    box.appendChild(lab);
  }
  const chips = el('div', 'chiprow');
  for (const id of s.ids) chips.appendChild(playerChip(id, s, cat && !fit(cat, id).ok));
  box.appendChild(chips);
  if (cat && s.ids.length < 4) {
    // Players who fit the label (most known first), and a name search.
    box.appendChild(el('p', 'meta small', `Add ${4 - s.ids.length} more who fit:`));
    const ul = el('ul', 'picklist');
    const taken = used();
    for (const p of candidates(C, s.key, { not: [...taken], limit: 30 })) ul.appendChild(pickRow(p, fit(cat, p.id).ev.why, () => { s.ids.push(p.id); saveDraft(); drawMake(); }));
    box.appendChild(ul);
  } else if (!cat) {
    if (s.ids.length) {
      const all = suggest(C, s.ids, { limit: 40, exclude: MK.slots.map((x) => x.key).filter(Boolean) });
      // Easy and well-known links first (Jorge, Nov 13, 2026); obscure stats,
      // birth states and two-team journeymen only on request.
      const sug = s.showHard ? all : all.filter((x) => x.tier !== 'hard');
      const nHard = all.length - all.filter((x) => x.tier !== 'hard').length;
      box.appendChild(el('p', 'meta small', sug.length ? 'Pick the link for this group:' : all.length ? 'Only harder links fit all of these players.' : 'No checkable link fits all of these players. Remove one.'));
      const ul = el('ul', 'picklist');
      for (const x of sug) {
        const li = el('li'), b = el('button'); b.type = 'button';
        b.appendChild(el('span', null, x.label));
        b.appendChild(el('span', 'sub2', `${x.tier === 'easy' ? 'Easy' : x.tier === 'medium' ? 'Medium' : 'Hard'} · ${TYPE_NAMES[x.type] || x.type}`));
        b.addEventListener('click', () => { s.key = x.key; saveDraft(); drawMake(); });
        li.appendChild(b); ul.appendChild(li);
      }
      box.appendChild(ul);
      if (nHard && !s.showHard) {
        const more = el('button', 'ghost small', `Show ${nHard} harder link${nHard === 1 ? '' : 's'}`); more.type = 'button';
        more.addEventListener('click', () => { s.showHard = true; drawMake(); });
        box.appendChild(more);
      }
    }
    if (s.ids.length < 4) {
      const inp = el('input', 'search'); inp.type = 'search'; inp.placeholder = s.ids.length ? 'Add another player' : 'Start with a player'; inp.autocomplete = 'off';
      inp.setAttribute('aria-label', `Group ${i + 1}: search players`);
      const ul = el('ul', 'picklist');
      inp.addEventListener('input', () => {
        ul.textContent = '';
        const taken = used();
        for (const p of searchPlayers(inp.value)) {
          if (taken.has(p.id)) continue;
          ul.appendChild(pickRow(p, yrs(p), () => { s.ids.push(p.id); saveDraft(); drawMake(); }));
        }
      });
      box.appendChild(inp); box.appendChild(ul);
    }
  }
  return box;
}
function pickRow(p, sub, onPick) {
  const li = el('li'), b = el('button'); b.type = 'button';
  addHead(b, p.head, 'sm', p.name);
  b.appendChild(el('span', null, p.name));
  b.appendChild(el('span', 'sub2', sub));
  b.addEventListener('click', onPick);
  li.appendChild(b);
  return li;
}

let lastCheck = null;
function updateCheck() {
  const box = $('check'); box.textContent = '';
  if (!C) return;
  const groups = MK.slots.filter((s) => s.key || s.ids.length).map((s) => ({ key: s.key, ids: s.ids }));
  const ready = MK.slots.every((s) => s.key && s.ids.length === 4);
  box.appendChild(el('h2', 'panel-title', 'Check'));
  if (!ready) {
    const n = MK.slots.filter((s) => s.key && s.ids.length === 4).length;
    box.appendChild(el('p', 'meta', `${n} of 4 groups complete. The full check runs when all four have a link and 4 players.`));
    // Partial check: errors within the groups so far.
    const part = groups.filter((g) => g.key);
    if (part.length) {
      const res = checkPuzzle(C, { groups: part.map((g) => ({ key: g.key, ids: g.ids })) });
      const errs = res.errors.filter((e) => ['fit', 'extra', 'alt', 'dup', 'samegroup', 'head', 'page'].includes(e.code) && !(e.code === 'alt' && part.length < 4));
      if (errs.length) { const ul = el('ul', 'err'); for (const e of errs) ul.appendChild(el('li', null, e.text)); box.appendChild(ul); }
    }
    lastCheck = null;
    $('publish').disabled = true;
    return;
  }
  const res = checkPuzzle(C, { groups: MK.slots.map((s) => ({ key: s.key, ids: s.ids })) });
  lastCheck = res;
  if (res.ok) box.appendChild(el('p', 'okline', 'Fair: these four groups are the only way to split the 16.'));
  if (res.errors.length) { box.appendChild(el('p', null, 'Fix these first:')); const ul = el('ul', 'err'); for (const e of res.errors) ul.appendChild(el('li', null, e.text)); box.appendChild(ul); }
  if (res.warnings.length) { const ul = el('ul', 'warn'); for (const w of res.warnings) ul.appendChild(el('li', null, w.text)); box.appendChild(ul); }
  const d = el('p'); d.append('Difficulty: '); d.appendChild(el('span', 'diff ' + res.difficulty.label, `${res.difficulty.label} (${res.difficulty.score}/100)`)); box.appendChild(d);
  if (res.groups.every((g) => g.color)) {
    for (const g of res.groups) {
      const row = el('div', 'grow ' + g.color); row.style.marginBottom = '6px';
      row.appendChild(el('h3', null, g.label));
      box.appendChild(row);
    }
  }
  if (res.decoys.length) {
    box.appendChild(el('p', null, 'Red herrings (3 of the 16 share these; allowed, and they make it harder):'));
    const ul = el('ul', 'dec');
    for (const x of res.decoys) ul.appendChild(el('li', null, `${x.label}: ${x.ids.map((id) => C.players.get(id).name).join(', ')}`));
    box.appendChild(ul);
  }
  const titleOk = $('mk-title').value.trim().length >= 3;
  $('publish').disabled = !(res.ok && titleOk && MK.me && MK.me.canPublish);
  if (res.ok && !titleOk) box.appendChild(el('p', 'meta small', 'Add a title to publish.'));
}
$('publish').addEventListener('click', async () => {
  if (!lastCheck || !lastCheck.ok) return;
  const msg = $('mk-msg'); msg.classList.remove('bad'); msg.textContent = 'Publishing…';
  $('publish').disabled = true;
  try {
    const r = await api('publish', { device: device(), title: $('mk-title').value.trim(), maker: $('mk-maker').value.trim() || null, groups: MK.slots.map((s) => ({ key: s.key, ids: s.ids })) });
    store.set('pm-draft', null);
    msg.textContent = '';
    const a = el('a', null, r.url); a.href = SITE + '?p=' + r.id;
    msg.append('Published: '); msg.appendChild(a);
    MK.slots = [0, 1, 2, 3].map(() => ({ key: null, ids: [] }));
    $('mk-title').value = '';
    drawMake(); refreshMe();
  } catch (e) {
    msg.classList.add('bad');
    const E = { solve_more: 'Solve 10 puzzles first.', bad_title: 'The title needs 3 to 48 characters.', title_not_allowed: 'That title isn’t allowed. Try another.',
      bad_maker: 'That maker name isn’t allowed. Try another.', duplicate: 'Someone already published these exact groups.', too_many: 'That’s the publishing limit for today.',
      unfair: 'The server found a problem: ' + ((e.body && e.body.errors) || []).join(' ') };
    msg.textContent = E[e.message] || 'Couldn’t publish. Try again.';
    $('publish').disabled = false;
  }
});

// ====================================================================
// Browsing
// ====================================================================
function fillList(ul, items) {
  ul.textContent = '';
  for (const x of items) {
    const li = el('li'), a = el('a'); a.href = SITE + '?p=' + x.id;
    const t = el('span'); t.appendChild(el('span', 't', x.title));
    const bits = [x.maker ? 'by ' + x.maker : 'anonymous maker', `${x.plays} play${x.plays === 1 ? '' : 's'}`];
    if (x.solveRate != null && x.plays) bits.push(`${x.solveRate}% solved`);
    if (x.makerRating != null) bits.push(`maker ${x.makerRating}/100`);
    t.appendChild(el('span', 's', bits.join(' · ')));
    a.appendChild(t);
    a.appendChild(el('span', 'diff ' + x.difficulty.label, x.difficulty.label));
    li.appendChild(a); ul.appendChild(li);
  }
}
async function startBrowse() {
  showView('browse', 'browse');
  const sort = params.get('sort') === 'top' ? 'top' : 'new';
  $('sort-' + sort).style.borderColor = 'var(--gold)';
  try {
    const r = await api('puzzles?sort=' + sort);
    fillList($('browse-list'), r.puzzles);
    $('browse-note').textContent = r.puzzles.length ? (sort === 'top' ? 'Rated by how close the solve rate sits to the challenging-but-solvable middle (10+ plays).' : '') : (sort === 'top' ? 'No puzzle has 10 plays yet.' : 'No readers’ puzzles yet. Make the first one.');
  } catch (e) { $('browse-note').textContent = 'The list couldn’t load. Refresh to try again.'; }
}

// ====================================================================
if (mode === 'make') startMake();
else if (mode === 'browse') startBrowse();
else if (mode === 'practice') startRun('practice', { level: params.get('level') === 'hard' ? 'hard' : 'normal' });
else if (pid && /^[A-Za-z0-9]{8}$/.test(pid)) startRun('puzzle', { id: pid });
else if (DAY) startRun('daily', { date: DAY });
else startRun('daily');
void SQUARES;
