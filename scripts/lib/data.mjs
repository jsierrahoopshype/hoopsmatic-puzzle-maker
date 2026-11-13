// Compact player facts for public/data.json (format: top of public/core.js),
// from Deep Cut's pinned facts.json and players.json (.cache/sources/).
import { readFileSync } from 'node:fs';
import { buildCatalog, FIRST_SEASON } from '../../public/core.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const src = (id) => JSON.parse(readFileSync(`${ROOT}.cache/sources/${id}.json`, 'utf8'));

// Box-score highs row: [season, unit#, pts, reb, ast, threes, td, 40+, 50+, 20-20, stl, blk, ...]
const FEAT_COLS = [[2, 50], [4, 20], [3, 25], [5, 10], [11, 10], [10, 8]];   // same order as core.js FEATS

// Fame, close to the crossword/Deep Cut formula (facts.json has no fame).
function fameOf(p) {
  const a = p.a || {};
  const mvp = (p.vt || []).filter((v) => v[1] === 'MVP' && v[2] === 1).length;
  const solo = Object.values(p.w || {}).reduce((s, x) => s + x.length, 0);
  let s = 3 * (a.allStar?.length || 0) + 10 * mvp + 2 * (p.r?.length || 0) + 3 * (a.allNba?.length || 0) + 3 * solo + p.g / 100;
  if (p.l >= 2022) s += 4;
  if (p.d >= 2022 && p.k) s += p.k <= 3 ? 12 : p.k <= 10 ? 6 : 0;
  return Math.round(s * 10) / 10;
}

export function compactData() {
  const facts = src('facts');
  const pub = new Map(src('players').players.map((r) => [r[0], { page: r[5] || 0, head: r[6] || 0 }]));
  const players = [];
  for (const p of facts.players) {
    if (p.l < FIRST_SEASON) continue;
    const x = pub.get(p.i) || { page: 0, head: 0 };
    const feats = [];
    for (const r of p.gh || []) FEAT_COLS.forEach(([col, v], f) => { if (r[col] != null && r[col] >= v) feats.push([f, r[0], r[1], r[col]]); });
    players.push([p.i, p.n, x.head, x.page, p.f, p.l, p.g, fameOf(p), p.d || 0, p.k || 0, p.c || 0, p.cn || 0, p.b || 0, p.bp || 0,
      p.s.map((s) => [s[0], s[1], s[2]]), p.r || [], p.a?.allStar || [], p.w || {}, (p.md || []).includes('Olympic Gold') ? 1 : 0, feats]);
  }
  return { v: 1, asOf: facts.asOf, units: facts.units.map((u) => [u.name, u.code]), players };
}

let C = null;
export function catalog() { return (C ??= buildCatalog(compactData())); }
