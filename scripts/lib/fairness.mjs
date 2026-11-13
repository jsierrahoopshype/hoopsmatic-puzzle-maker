// Fairness check and difficulty for one puzzle.
//
//   checkPuzzle({ groups: [{ key, ids: [4 player ids] }] x4 })
//     -> { ok, errors: [string], decoys: [{ key, label, ids }], groups: [{ ...,
//          anchor, score, color, why: { id: evidence } }], difficulty: { score, label } }
//
// A puzzle is FAIR when the 4 groups the maker meant are the only way to
// split the 16 players that the data supports:
//   1. Each group's own label is true for exactly its 4 players among the
//      16 (a 5th fitting player makes the group ambiguous).
//   2. No other label in the catalog is true for 4 or more of the 16, unless
//      it is true for exactly one of the groups (a synonym: "born in
//      Chicago" and "born in Illinois" for the same 4). Otherwise a solver
//      could submit a set the data backs and be told it's wrong.
//   The fairness test uses every season a label is true for (no era cut),
//   so a 1970s stint still counts as a reason a solver might pick a player.
// A label true for exactly 3 of the 16, spread over 2+ groups, is a DECOY
// (red herring): allowed, and it makes the puzzle harder.
//
// Also enforced: 16 different players, every player has a headshot and a
// HoopsMatic page (no initials anywhere), each group rests on evidence from
// 1980-81 on, and at least 2 of the 4 groups are about 2010-11 or later.
import { loadCatalog, strictEvidence, FIRST_SEASON, RECENT_SEASON } from './catalog.mjs';

export const COLORS = ['yellow', 'green', 'blue', 'purple'];   // easiest -> hardest

// How obscure a kind of link is, before the players are taken into account.
const TYPE_BASE = { ring: 10, no1: 15, solo: 25, roster: 30, allstar: 30, olygold: 35, teams: 40, feat: 40,
  college: 45, draft: 55, country: 50, state: 65, city: 70 };

export function checkPuzzle(puzzle) {
  const { cats, players, catsOf } = loadCatalog();
  const errors = [];
  const groups = puzzle.groups.map((g) => ({ ...g, cat: cats.get(g.key) }));
  const all = groups.flatMap((g) => g.ids);
  const inPuzzle = new Set(all);

  if (groups.length !== 4) errors.push(`needs 4 groups, has ${groups.length}`);
  if (all.length !== 16 || inPuzzle.size !== 16) errors.push('needs 16 different players');
  for (const id of all) {
    const p = players.get(id);
    if (!p) { errors.push(`unknown player ${id}`); continue; }
    if (!p.head) errors.push(`${p.name}: no headshot`);
    if (!p.link) errors.push(`${p.name}: no HoopsMatic page`);
  }

  // 1. own label: true (from 1980-81 on) for each of its 4, and for no 5th.
  for (const g of groups) {
    if (!g.cat) { errors.push(`unknown group ${g.key}`); continue; }
    if (g.ids.length !== 4) errors.push(`${g.cat.label}: needs 4 players`);
    g.why = {};
    for (const id of g.ids) {
      const ev = strictEvidence(g.cat, id);
      if (!ev) errors.push(`${g.cat.label}: ${players.get(id)?.name || id} doesn't fit (from ${FIRST_SEASON - 1}-${String(FIRST_SEASON).slice(2)} on)`);
      else g.why[id] = ev[0];
    }
    const extra = all.filter((id) => !g.ids.includes(id) && g.cat.members.has(id));
    if (extra.length) errors.push(`${g.cat.label}: also true for ${extra.map((id) => players.get(id).name).join(', ')}`);
  }

  // 2. every other label in the catalog.
  const groupSets = groups.map((g) => g.ids.slice().sort().join(','));
  const decoys = [];
  const own = new Set(groups.map((g) => g.key));
  // Only labels at least one of the 16 fits can matter (player -> labels index).
  const touched = new Set(all.flatMap((id) => [...(catsOf.get(id) || [])]));
  for (const key of touched) {
    const c = cats.get(key);
    if (own.has(c.key)) continue;
    const hit = all.filter((id) => c.members.has(id));
    if (hit.length < 3) continue;
    if (hit.length === 3) {
      const spread = new Set(hit.map((id) => groups.findIndex((g) => g.ids.includes(id)))).size;
      if (spread < 2) continue;
      // The same 3 players under several labels (seven straight Spurs
      // seasons) are one decoy; keep the most general label first.
      const set = hit.slice().sort().join(',');
      const d = decoys.find((x) => x.set === set);
      if (d) d.labels.push(c.label);
      else decoys.push({ set, key: c.key, type: c.type, label: c.label, labels: [c.label], ids: hit });
      continue;
    }
    if (hit.length === 4 && groupSets.includes(hit.slice().sort().join(','))) continue;   // synonym
    errors.push(`another link fits ${hit.length}: "${c.label}" (${hit.map((id) => players.get(id).name).join(', ')})`);
  }

  // Era: each group's anchor is the median season of its members' evidence.
  for (const g of groups) {
    const ys = Object.values(g.why || {}).map((e) => e.y).sort((a, b) => a - b);
    g.anchor = ys.length ? ys[Math.floor((ys.length - 1) / 2)] : null;
  }
  const recent = groups.filter((g) => g.anchor >= RECENT_SEASON).length;
  if (recent < 2) errors.push(`only ${recent} of 4 groups are about 2010-11 or later (need 2)`);

  // Difficulty per group: kind of link, how famous the 4 are, how recent,
  // and how many decoys pull at its players.
  for (const g of groups) {
    if (!g.cat) continue;
    const fame = g.ids.reduce((s, id) => s + Math.min(players.get(id)?.fame || 0, 40), 0) / 4;
    const pulls = decoys.filter((d) => d.ids.some((id) => g.ids.includes(id))).length;
    g.score = Math.round(0.6 * (TYPE_BASE[g.cat.type] ?? 40) + 40 * (1 - fame / 40) + Math.min(pulls, 4) * 5 - (g.anchor >= 2016 ? 5 : 0));
    g.label = g.cat.label;
  }
  const ranked = groups.filter((g) => g.cat).slice().sort((a, b) => a.score - b.score);
  ranked.forEach((g, i) => { g.color = COLORS[i]; });
  const mean = ranked.reduce((s, g) => s + g.score, 0) / (ranked.length || 1);
  const score = Math.round(mean + 2 * Math.min(decoys.length, 8));
  // Thresholds sit near the quartiles of 400 data-built puzzles (Nov 13,
  // 2026: 25% 57, median 65, 75% 73). A first guess: recalibrate from real
  // solve rates once there are some.
  const label = score < 57 ? 'Easy' : score < 65 ? 'Medium' : score < 73 ? 'Hard' : 'Expert';
  return {
    ok: errors.length === 0, errors,
    decoys: decoys.map(({ set, ...d }) => ({ ...d, label: d.labels.find((l) => !/^\d{4}-\d{2} /.test(l)) || d.labels[0] })),
    groups: ranked.map(({ cat, ...g }) => g),
    difficulty: { score, label },
  };
}
