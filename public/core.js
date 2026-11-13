// Puzzle Maker core: group labels, fairness check, difficulty and the
// data-built generator. Pure ES module (no Node or browser APIs), used by
//   - the page (public/app.js): maker suggestions, live fairness and difficulty;
//   - the build (scripts/build.mjs): data-built Daily locks;
//   - the server (hoopsmatic-worker puzzle-maker-server/src/core.js, an EXACT
//     copy): re-checks every published puzzle, builds practice puzzles.
//
// DATA (public/data.json, scripts/build.mjs, from Deep Cut's pinned facts):
//   { v, asOf, units: [[name, code]], players: [P] }  (only players whose last
//   season is 1980-81 or later)
//   P = [id, name, head|0, page|0, first, last, games, fame, draft|0, pick|0,
//        college|0, collegeDisplay|0, birthCountry|0, birthplace|0,
//        seasons [[y, unit, gp]], rings [[y, unit]], allStar [[y, unit]],
//        solo {roy|smoy|mip|dpoy: [y]}, olympicGold 0|1, feats [[f, y, unit, value]]]
//   Seasons by ending year (2016 = 2015-16). Units are era names (Seattle
//   SuperSonics, not Thunder); unit code is the franchise.
//
// RULES (Jorge, Nov 13, 2026)
//   - Labels read plainly, no hidden conditions. Every player a label is true
//     for counts in the fairness check, any season, any stint.
//   - A group itself rests on evidence from 1980-81 on, and at least 2 of the
//     4 groups are about 2010-11 or later (median season of the 4).
//   - To be IN a group (maker or generator): 10+ games with each team for a
//     two-team group, 20+ games that season for a single-season roster group,
//     60+ career games for draft and rookie groups. These limit who a maker
//     may use; they never change whether a label is true.
//   - Draft groups: drafted players only.
//   - Single-team overlap (4+ of the 16 played for one franchise) is a
//     warning, not an error.
//   - Every player needs a headshot and a HoopsMatic page.

export const FIRST_SEASON = 1981;
export const RECENT_SEASON = 2011;
export const MIN_TEAM_GAMES = 10;
export const MIN_SEASON_GAMES = 20;
export const MIN_DRAFT_GAMES = 60;
export const COLORS = ['yellow', 'green', 'blue', 'purple'];   // easiest -> hardest
export const seasonLabel = (y) => `${y - 1}-${String(y).slice(2)}`;

export const FEATS = [
  { k: 'pts50', label: 'Scored 50+ points in a regular-season game', unit: 'points' },
  { k: 'ast20', label: 'Had 20+ assists in a regular-season game', unit: 'assists' },
  { k: 'reb25', label: 'Had 25+ rebounds in a regular-season game', unit: 'rebounds' },
  { k: 'tpm10', label: 'Made 10+ threes in a regular-season game', unit: 'threes' },
  { k: 'blk10', label: 'Had 10+ blocks in a regular-season game', unit: 'blocks' },
  { k: 'stl8', label: 'Had 8+ steals in a regular-season game', unit: 'steals' },
];
const SOLO = { roy: 'Won Rookie of the Year', smoy: 'Won Sixth Man of the Year', mip: 'Won Most Improved Player', dpoy: 'Won Defensive Player of the Year' };
const SOLO_NAME = { roy: 'Rookie of the Year', smoy: 'Sixth Man of the Year', mip: 'Most Improved Player', dpoy: 'Defensive Player of the Year' };

// How obscure a kind of link is, before the players are taken into account.
const TYPE_BASE = { ring: 10, no1: 15, solo: 25, roster: 30, allstar: 30, olygold: 35, teams: 40, feat: 40,
  college: 45, draft: 55, country: 50, state: 65, city: 70, club: 60 };
// How often the generator draws each kind (club: checked, never drawn).
const TYPE_WEIGHT = { teams: 5, roster: 4, draft: 4, college: 4, feat: 3, ring: 2, allstar: 2, country: 2, state: 1, city: 1, solo: 2, no1: 1, olygold: 1, club: 0 };
const BIRTH = new Set(['country', 'state', 'city']);
export const TYPE_NAMES = { teams: 'Two teams', roster: 'Team in one season', draft: 'Draft class', college: 'College', country: 'Born in a country',
  state: 'Born in a state', city: 'Born in a city', feat: 'Single-game feat', ring: 'Title with a team', allstar: 'All-Star with a team',
  solo: 'Award', no1: 'No. 1 pick', olygold: 'Olympic gold', club: 'Club before the NBA' };

// ---------- catalog ----------
// buildCatalog(data) -> { players: Map(id -> player), cats: Map(key -> cat),
//   catsOf: Map(id -> Set(key)), units, asOf }
// cat = { key, type, label, members: Map(id -> [{ y, why, weak, short? }]) }
//   weak: true for the label (the fairness check counts it) but the player
//   can't be put IN this group; short says why.
export function buildCatalog(data) {
  const units = data.units.map(([name, code]) => ({ name, code }));
  const uname = (u) => units[u].name;
  const players = new Map(), cats = new Map(), catsOf = new Map();
  const add = (key, type, label, id, y, why, short = null) => {
    let c = cats.get(key);
    if (!c) cats.set(key, (c = { key, type, label, members: new Map() }));
    let ev = c.members.get(id);
    if (!ev) c.members.set(id, (ev = []));
    ev.push({ y, why, weak: !!short, short });
    let s = catsOf.get(id);
    if (!s) catsOf.set(id, (s = new Set()));
    s.add(key);
  };
  // "Played college ball at" vs a pro club: a school where most players
  // were born abroad is a club (facts.json mixes them).
  const school = {};
  for (const r of data.players) if (r[10]) { const x = (school[r[10]] ??= [0, 0]); x[0]++; if (r[12] === 'United States') x[1]++; }
  const clubLike = new Set(Object.entries(school).filter(([, [n, us]]) => us / n < 0.5).map(([c]) => c));

  for (const r of data.players) {
    const [id, name, head, page, first, last, g, fame, d, k, c, cn, b, bp, seasons, rings, allStar, solo, oly, feats] = r;
    const p = { id, name, head: head || null, page: page || null, link: pageUrl(page), first, last, g, fame, draft: d || null, pick: k || null };
    players.set(id, p);
    const old = (y) => (y < FIRST_SEASON ? 'before 1980-81' : null);

    // Teams: first season and games with each era unit.
    const firstWith = new Map(), gpWith = new Map(), bySeason = new Map();
    for (const [y, u, gp] of seasons) {
      if (!firstWith.has(u) || y < firstWith.get(u)) firstWith.set(u, y);
      gpWith.set(u, (gpWith.get(u) || 0) + gp);
      const kk = y + '|' + u;
      bySeason.set(kk, (bySeason.get(kk) || 0) + gp);
    }
    p.franchises = [...new Set(seasons.map((s) => units[s[1]].code))];
    const us = [...firstWith.keys()].sort((a, b2) => a - b2);
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      const a = us[i], bb = us[j];
      const y = Math.max(firstWith.get(a), firstWith.get(bb));
      const few = Math.min(gpWith.get(a), gpWith.get(bb)) < MIN_TEAM_GAMES;
      add(`teams:${a}:${bb}`, 'teams', `Played for the ${uname(a)} and the ${uname(bb)}`, id, y,
        `${uname(a)} (${gpWith.get(a)} games), ${uname(bb)} (${gpWith.get(bb)} games)`,
        few ? `fewer than ${MIN_TEAM_GAMES} games with one of the teams` : old(y));
    }
    for (const [kk, gp] of bySeason) {
      const [y, u] = kk.split('|').map(Number);
      add(`roster:${u}:${y}`, 'roster', `Played for the ${seasonLabel(y)} ${uname(u)}`, id, y, `${gp} game${gp === 1 ? '' : 's'} that season`,
        gp < MIN_SEASON_GAMES ? `fewer than ${MIN_SEASON_GAMES} games that season` : old(y));
    }
    // Draft (drafted players only).
    if (d && k) {
      const few = g < MIN_DRAFT_GAMES ? `fewer than ${MIN_DRAFT_GAMES} career games` : null;
      add(`draft:${d}`, 'draft', `Drafted in ${d}`, id, d + 1, `No. ${k} pick in ${d}`, few || old(d + 1));
      if (k === 1) add('no1', 'no1', 'Went No. 1 overall in the draft', id, d + 1, `No. 1 pick in ${d}`, few || old(d + 1));
    }
    if (c) {
      if (clubLike.has(c)) add(`club:${c}`, 'club', `Played for ${cn || c} before the NBA`, id, first, cn || c, old(first));
      else add(`college:${c}`, 'college', `Played college ball at ${cn || c}`, id, first, cn || c, old(first));
    }
    // Birthplace only, never nationality.
    if (b && b !== 'United States') add(`country:${b}`, 'country', `Born in ${b}`, id, first, bp || b, old(first));
    if (b === 'United States' && bp) {
      const parts = bp.split(',').map((s) => s.trim());
      const state = parts[parts.length - 1], city = parts[0];
      if (state) add(`state:${state}`, 'state', `Born in ${state}`, id, first, bp, old(first));
      if (city && parts.length > 1) add(`city:${city}|${state}`, 'city', `Born in ${city}, ${state}`, id, first, bp, old(first));
    }
    for (const [y, u] of rings) add(`ring:${u}`, 'ring', `Won a title with the ${uname(u)}`, id, y, `${seasonLabel(y)} champion`, old(y));
    for (const [y, u] of allStar) add(`allstar:${u}`, 'allstar', `Made an All-Star team while with the ${uname(u)}`, id, y, `${seasonLabel(y)} All-Star`, old(y));
    for (const [kk, ys] of Object.entries(solo)) if (SOLO[kk]) for (const y of ys) {
      const few = kk === 'roy' && g < MIN_DRAFT_GAMES ? `fewer than ${MIN_DRAFT_GAMES} career games` : null;
      add(`solo:${kk}`, 'solo', SOLO[kk], id, y, `${SOLO_NAME[kk]} ${seasonLabel(y)}`, few || old(y));
    }
    if (oly) add('olygold', 'olygold', 'Won Olympic gold', id, first, 'Olympic gold medal', old(first));
    for (const [f, y, u, v] of feats) {
      const F = FEATS[f];
      add(`feat:${F.k}`, 'feat', F.label, id, y, `${v} ${F.unit}, ${seasonLabel(y)} ${uname(u)}`, old(y));
    }
  }
  return { players, cats, catsOf, units, asOf: data.asOf };
}

export function pageUrl(page) {
  if (!page) return null;
  return page.startsWith('s:') ? `https://hoopsmatic.com/salary-season-finder/player/${page.slice(2)}/`
    : `https://hoopsmatic.com/nba-career-map/player/${page.slice(2)}.html`;
}
// Headshot URL (Deep Cut's sources): "f:<file>" HoopsMatic face-fill set,
// "n:<id>" NBA.com. null = show nothing (never initials).
export function headUrl(head) {
  if (!head) return null;
  return head.startsWith('n:') ? `https://cdn.nba.com/headshots/nba/latest/260x190/${head.slice(2)}.png`
    : `https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face-fill/${head.replace(/^f:/, '')}.webp`;
}

// The evidence a group can rest on for this player (1980-81 on, not weak),
// or null with the reason.
export function fit(cat, id) {
  const ev = cat && cat.members.get(id);
  if (!ev) return { ok: false, why: 'does not fit' };
  const good = ev.filter((e) => !e.weak).sort((a, b) => a.y - b.y);
  if (good.length) return { ok: true, ev: good[0] };
  return { ok: false, why: ev[0].short || 'does not fit' };
}

// ---------- fairness and difficulty ----------
// checkPuzzle(C, { groups: [{ key, ids }] }) -> { ok, errors, warnings, decoys,
//   groups: [{ key, ids, label, type, anchor, score, color, why }], difficulty }
// errors: [{ code, text, ids? , key? }]
export function checkPuzzle(C, puzzle) {
  const { cats, players, catsOf } = C;
  const errors = [], warnings = [];
  const E = (code, text, extra) => errors.push({ code, text, ...(extra || {}) });
  const nm = (id) => players.get(id)?.name || id;
  const groups = (puzzle.groups || []).map((g) => ({ key: g.key, ids: (g.ids || []).slice(), cat: cats.get(g.key) }));
  const all = groups.flatMap((g) => g.ids);
  const inPuzzle = new Set(all);

  if (groups.length !== 4) E('groups', `A puzzle needs 4 groups (this one has ${groups.length}).`);
  if (inPuzzle.size !== all.length) E('dup', 'The same player is in the puzzle twice.');
  for (const id of inPuzzle) {
    const p = players.get(id);
    if (!p) { E('player', `Unknown player ${id}.`, { ids: [id] }); continue; }
    if (!p.head) E('head', `${p.name} has no headshot yet, so he can't be used.`, { ids: [id] });
    if (!p.link) E('page', `${p.name} has no HoopsMatic page yet, so he can't be used.`, { ids: [id] });
  }
  if (new Set(groups.map((g) => g.key)).size !== groups.length) E('samegroup', 'Two groups use the same link.');

  for (const g of groups) {
    if (!g.cat) { E('key', `Unknown group ${g.key}.`, { key: g.key }); continue; }
    if (g.ids.length !== 4) E('size', `"${g.cat.label}" needs 4 players (has ${g.ids.length}).`, { key: g.key });
    g.why = {};
    for (const id of g.ids) {
      const f = fit(g.cat, id);
      if (f.ok) g.why[id] = f.ev;
      else E('fit', `${nm(id)} can't be in "${g.cat.label}": ${f.why}.`, { key: g.key, ids: [id] });
    }
    const extra = all.filter((id) => !g.ids.includes(id) && g.cat.members.has(id));
    if (extra.length) E('extra', `"${g.cat.label}" is also true for ${extra.map(nm).join(', ')}.`, { key: g.key, ids: extra });
  }

  const groupSets = groups.map((g) => g.ids.slice().sort().join(','));
  const own = new Set(groups.map((g) => g.key));
  const decoys = [];
  const touched = new Set();
  for (const id of all) for (const k of catsOf.get(id) || []) touched.add(k);
  for (const key of touched) {
    if (own.has(key)) continue;
    const c = cats.get(key);
    const hit = all.filter((id) => c.members.has(id));
    if (hit.length < 3) continue;
    if (hit.length === 3) {
      const spread = new Set(hit.map((id) => groups.findIndex((g) => g.ids.includes(id)))).size;
      if (spread < 2) continue;
      const set = hit.slice().sort().join(',');
      const d = decoys.find((x) => x.set === set);
      if (d) d.labels.push(c.label);
      else decoys.push({ set, key, type: c.type, labels: [c.label], ids: hit });
      continue;
    }
    if (hit.length === 4 && groupSets.includes(hit.slice().sort().join(','))) continue;   // same 4, another way to say it
    E('alt', `Another link fits ${hit.length} of the 16: "${c.label}" (${hit.map(nm).join(', ')}).`, { key, ids: hit });
  }

  // Single-team overlap: a warning only.
  const byFr = new Map();
  for (const id of inPuzzle) for (const fr of players.get(id)?.franchises || []) byFr.set(fr, (byFr.get(fr) || 0) + 1);
  for (const [fr, n] of byFr) if (n >= 4) {
    const ids = [...inPuzzle].filter((id) => players.get(id)?.franchises.includes(fr));
    // Exactly one group's 4 (a team-based group): that is the group, not a warning.
    if (n === 4 && groupSets.includes(ids.slice().sort().join(','))) continue;
    warnings.push({ code: 'franchise', text: `${n} of the 16 played for the ${franchiseName(C, fr)} at some point. Fine, but solvers may try them as a group.`, ids });
  }

  for (const g of groups) {
    const ys = Object.values(g.why || {}).map((e) => e.y).sort((a, b) => a - b);
    g.anchor = ys.length ? ys[Math.floor((ys.length - 1) / 2)] : null;
  }
  const recent = groups.filter((g) => g.anchor >= RECENT_SEASON).length;
  if (groups.length === 4 && recent < 2) E('era', `Only ${recent} of the 4 groups are about 2010-11 or later; at least 2 must be.`);

  for (const g of groups) {
    if (!g.cat) continue;
    const fame = g.ids.reduce((s, id) => s + Math.min(players.get(id)?.fame || 0, 40), 0) / Math.max(g.ids.length, 1);
    const pulls = decoys.filter((d) => d.ids.some((id) => g.ids.includes(id))).length;
    g.score = Math.round(0.6 * (TYPE_BASE[g.cat.type] ?? 40) + 40 * (1 - fame / 40) + Math.min(pulls, 4) * 5 - (g.anchor >= 2016 ? 5 : 0));
    g.label = g.cat.label;
    g.type = g.cat.type;
  }
  const ranked = groups.filter((g) => g.cat).slice().sort((a, b) => a.score - b.score);
  ranked.forEach((g, i) => { g.color = COLORS[i] || null; });
  const mean = ranked.reduce((s, g) => s + g.score, 0) / (ranked.length || 1);
  const score = Math.round(mean + 2 * Math.min(decoys.length, 8));
  // Near the quartiles of data-built puzzles (Nov 13, 2026); to recalibrate
  // from real solve rates.
  const label = score < 57 ? 'Easy' : score < 65 ? 'Medium' : score < 73 ? 'Hard' : 'Expert';
  return {
    ok: errors.length === 0, errors, warnings,
    decoys: decoys.map(({ set, labels, ...d }) => ({ ...d, label: labels.find((l) => !/^Played for the \d{4}-\d{2} /.test(l)) || labels[0] })),
    groups: ranked.map(({ cat, ...g }) => g),
    difficulty: { score, label },
  };
}

function franchiseName(C, code) {
  let best = null;
  for (const u of C.units) if (u.code === code) best = u.name;
  return best || code;
}

// ---------- maker suggestions ----------
// Labels every given player can be in, smallest pool first. pool = how many
// usable players the label has.
export function suggest(C, ids, { limit = 30, exclude = [] } = {}) {
  const { cats, catsOf, players } = C;
  if (!ids.length) return [];
  const out = [];
  for (const key of catsOf.get(ids[0]) || []) {
    if (exclude.includes(key)) continue;
    const c = cats.get(key);
    if (c.type === 'club') continue;
    if (!ids.every((id) => fit(c, id).ok)) continue;
    let pool = 0;
    for (const id of c.members.keys()) if (usable(players.get(id)) && fit(c, id).ok) pool++;
    if (pool >= 4) out.push({ key, label: c.label, type: c.type, pool });
  }
  return out.sort((a, b) => a.pool - b.pool).slice(0, limit);
}
// Players who could complete a group, most known first.
export function candidates(C, key, { not = [], limit = 40 } = {}) {
  const c = C.cats.get(key);
  if (!c) return [];
  const out = [];
  for (const id of c.members.keys()) {
    const p = C.players.get(id);
    if (not.includes(id) || !usable(p) || !fit(c, id).ok) continue;
    out.push(p);
  }
  return out.sort((a, b) => b.fame - a.fame).slice(0, limit);
}
export const usable = (p) => !!(p && p.head && p.link);

// ---------- data-built puzzles ----------
// Solvable: known (fame 8+), 200+ games, or a current player with 100+ games.
export const playable = (p) => usable(p) && (p.fame >= 8 || p.g >= 200 || (p.last >= 2026 && p.g >= 100));
const KNOWN = 8;

export function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = Math.imul(s ^ ch.charCodeAt(0), 2654435761) >>> 0;
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

const poolCache = new WeakMap();
function pools(C) {
  if (poolCache.has(C)) return poolCache.get(C);
  const out = [];
  for (const c of C.cats.values()) {
    if (!(TYPE_WEIGHT[c.type] > 0)) continue;
    const ids = [];
    for (const id of c.members.keys()) if (playable(C.players.get(id)) && fit(c, id).ok) ids.push(id);
    if (ids.length < 4 || ids.length > 120) continue;
    const ys = ids.map((id) => fit(c, id).ev.y).sort((a, b) => a - b);
    out.push({ key: c.key, type: c.type, ids, recent: ys[Math.floor(ys.length / 2)] >= RECENT_SEASON || ys.filter((y) => y >= RECENT_SEASON).length >= 4 });
  }
  poolCache.set(C, out);
  return out;
}

export function generatePuzzle(C, seed, { tries = 4000 } = {}) {
  const rand = rng(seed);
  const { cats, players } = C;
  const byType = {};
  for (const p of pools(C)) (byType[p.type] ??= []).push(p);
  const types = Object.keys(byType);
  for (let t = 1; t <= tries; t++) {
    const kinds = [];
    while (kinds.length < 4) {
      const opts = types.filter((x) => !kinds.includes(x) && !(BIRTH.has(x) && kinds.some((y) => BIRTH.has(y))));
      kinds.push(pickWeighted(rand, opts, (x) => TYPE_WEIGHT[x] ?? 1));
    }
    const chosen = [], used = new Set();
    let fail = false;
    for (let i = 0; i < 4 && !fail; i++) {
      const needRecent = chosen.filter((c) => c.recent).length + (4 - i) <= 2;
      const opts = byType[kinds[i]].filter((p) => (!needRecent || p.recent) && !chosen.some((c) => c.key === p.key));
      if (!opts.length) { fail = true; break; }
      const pool = opts[Math.floor(rand() * opts.length)];
      const cat = cats.get(pool.key);
      if (chosen.some((c) => c.ids.some((x) => cat.members.has(x)))) { fail = true; break; }
      const left = pool.ids.filter((id) => !used.has(id) && !chosen.some((c) => cats.get(c.key).members.has(id)));
      const w = (id) => (1 + Math.min(players.get(id).fame, 40) / 10) * (pool.recent && fit(cat, id).ev.y >= RECENT_SEASON ? 3 : 1);
      const ids = [];
      while (ids.length < 4 && left.length) {
        const id = pickWeighted(rand, left, w);
        left.splice(left.indexOf(id), 1);
        ids.push(id);
      }
      if (ids.length < 4 || !ids.some((id) => players.get(id).fame >= KNOWN)) { fail = true; break; }
      ids.forEach((id) => used.add(id));
      chosen.push({ key: pool.key, ids, recent: pool.recent });
    }
    if (fail) continue;
    const res = checkPuzzle(C, { groups: chosen.map(({ key, ids }) => ({ key, ids })) });
    if (res.ok) return { ...res, seed, tries: t };
  }
  return null;
}

// The 16 tiles in a fixed shuffled order for a puzzle (same for everyone).
export function boardOrder(ids, seed) {
  const rand = rng('board:' + seed);
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- solving (shared by the page and the server) ----------
// A guess of 4 ids against the groups: { hit: group index } | { away: n } where
// n = the most of the 4 in any one unsolved group (3 = "one away").
export function judge(groups, solved, ids) {
  let best = 0;
  for (let i = 0; i < groups.length; i++) {
    if (solved.includes(i)) continue;
    const n = ids.filter((id) => groups[i].ids.includes(id)).length;
    if (n === 4) return { hit: i };
    best = Math.max(best, n);
  }
  return { away: best };
}

// Connections-style share squares: one row per guess, a square per tile in
// the color of the group it belongs to.
export const SQUARES = { yellow: '\u{1F7E8}', green: '\u{1F7E9}', blue: '\u{1F7E6}', purple: '\u{1F7EA}' };
export function shareGrid(groups, guesses) {
  const colorOf = new Map();
  for (const g of groups) for (const id of g.ids) colorOf.set(id, g.color);
  return guesses.map((ids) => ids.map((id) => SQUARES[colorOf.get(id)] || '\u2B1C').join('')).join('\n');
}
