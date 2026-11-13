// Data-built puzzles: the Daily's source until there are enough good user
// puzzles, and the same engine the maker tool's suggestions run on.
//
//   generatePuzzle(seed, { tries }) -> checkPuzzle() result + { seed, tries } | null
//
// Picks 4 labels of different kinds (at most one birthplace label), samples 4
// players for each from those the label is true for from 1980-81 on (with a
// headshot and a HoopsMatic page), and keeps the first set that passes the
// fairness check. Same seed, same data -> same puzzle.
import { loadCatalog, strictEvidence, RECENT_SEASON } from './catalog.mjs';
import { checkPuzzle } from './fairness.mjs';

// How often each kind of label is drawn.
const TYPE_WEIGHT = { teams: 5, roster: 4, draft: 4, college: 4, feat: 3, ring: 2, allstar: 2, country: 2, state: 1, city: 1, solo: 2, no1: 1, olygold: 1, club: 0 };   // club: checked for fairness, never drawn
const BIRTH = new Set(['country', 'state', 'city']);

export function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (Math.imul(s ^ ch.charCodeAt(0), 2654435761) >>> 0);
  return () => {   // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickWeighted = (rand, items, w) => {
  const total = items.reduce((s, x) => s + w(x), 0);
  let r = rand() * total;
  for (const x of items) if ((r -= w(x)) <= 0) return x;
  return items[items.length - 1];
};

// Data-built puzzles stay solvable: no one-season deep cuts. A player is
// used if he's known (fame 8+), had a real career (200+ games), or is a
// current player with 100+ games. Maker puzzles may use anyone; the
// difficulty rating reflects it.
export const playable = (p) => p.head && p.link && (p.fame >= 8 || p.raw.g >= 200 || (p.last >= 2026 && p.raw.g >= 100));
const KNOWN = 8;

let pools = null;
function candidatePools() {
  if (pools) return pools;
  const { cats, players } = loadCatalog();
  pools = [];
  for (const c of cats.values()) {
    const ids = [...c.members.keys()].filter((id) => {
      const p = players.get(id);
      return playable(p) && strictEvidence(c, id);
    });
    if (ids.length < 4) continue;
    // A label that fits hundreds of players can't be pinned down to 4.
    if (ids.length > 120) continue;
    const ys = ids.map((id) => strictEvidence(c, id)[0].y).sort((a, b) => a - b);
    pools.push({ key: c.key, type: c.type, ids, recent: ys[Math.floor(ys.length / 2)] >= RECENT_SEASON || ys.filter((y) => y >= RECENT_SEASON).length >= 4 });
  }
  return pools;
}

export function generatePuzzle(seed, { tries = 4000 } = {}) {
  const rand = rng(seed);
  const { cats, players } = loadCatalog();
  const all = candidatePools();
  const byType = {};
  for (const p of all) (byType[p.type] ??= []).push(p);
  const types = Object.keys(byType).filter((x) => (TYPE_WEIGHT[x] ?? 1) > 0);

  for (let t = 1; t <= tries; t++) {
    // 4 kinds, each drawn once; at least 2 recent labels.
    const kinds = [];
    while (kinds.length < 4) {
      const k = pickWeighted(rand, types.filter((x) => !kinds.includes(x) && !(BIRTH.has(x) && kinds.some((y) => BIRTH.has(y)))), (x) => TYPE_WEIGHT[x] ?? 1);
      kinds.push(k);
    }
    const chosen = [];
    const used = new Set();
    let fail = false;
    for (let i = 0; i < 4 && !fail; i++) {
      const needRecent = chosen.filter((c) => c.recent).length + (4 - i) <= 2;
      const opts = byType[kinds[i]].filter((p) => (!needRecent || p.recent) && !chosen.some((c) => c.key === p.key));
      if (!opts.length) { fail = true; break; }
      const pool = opts[Math.floor(rand() * opts.length)];
      const cat = cats.get(pool.key);
      // Players no earlier label fits, and who fit no earlier label's group.
      const free = pool.ids.filter((id) => !used.has(id) && !chosen.some((c) => cats.get(c.key).members.has(id)));
      // Recent players weigh more on recent labels; famous players weigh a bit more everywhere.
      const w = (id) => {
        const p = players.get(id), y = strictEvidence(cat, id)[0].y;
        return (1 + Math.min(p.fame, 40) / 10) * (pool.recent && y >= RECENT_SEASON ? 3 : 1);
      };
      const ids = [];
      const left = free.slice();
      while (ids.length < 4 && left.length) {
        const id = pickWeighted(rand, left, w);
        left.splice(left.indexOf(id), 1);
        // Earlier groups' players must not fit this label.
        if (chosen.some((c) => c.ids.some((x) => cat.members.has(x)))) { fail = true; break; }
        ids.push(id);
      }
      if (ids.length < 4) { fail = true; break; }
      // At least one known name per group, so every group has a way in.
      if (!ids.some((id) => players.get(id).fame >= KNOWN)) { fail = true; break; }
      ids.forEach((id) => used.add(id));
      chosen.push({ key: pool.key, ids, recent: pool.recent });
    }
    if (fail) continue;
    const res = checkPuzzle({ groups: chosen.map(({ key, ids }) => ({ key, ids })) });
    if (res.ok) return { ...res, seed, tries: t };
  }
  return null;
}
