// Every group a Puzzle Maker puzzle can use, built only from Deep Cut's pinned
// player facts (data/sources.lock.json -> .cache/sources/facts.json) and its
// public player list (page link + headshot per player).
//
//   loadCatalog() -> { players: Map(id -> player), cats: Map(key -> category), unitName }
//
// category = { key, type, label, members: Map(id -> [{ y, why }]) }
//   members holds EVERY player the label is true for, at any season ("loose"),
//   so the fairness check (fairness.mjs) sees every player a solver could
//   argue fits. Each piece of evidence carries its season (ending year,
//   2016 = 2015-16), so a group can be held to the era rules ("strict": only
//   evidence from 1980-81 on counts toward the group a maker builds).
//
// Seasons are stored by ending year, as in Deep Cut. Team names are each
// era's own (Seattle SuperSonics, not Thunder), from Deep Cut's units.
import { readFileSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;
const src = (id) => JSON.parse(readFileSync(`${ROOT}.cache/sources/${id}.json`, 'utf8'));

// Era rules (Jorge, Nov 13, 2026): nothing before 1980-81; at least half of
// the groups about 2010-11 or later.
export const FIRST_SEASON = 1981;
export const RECENT_SEASON = 2011;

// A group can't rest on a cameo: 10+ games with each team for "played for
// X and Y", 20+ games that season for a single-season roster group.
const MIN_TEAM_GAMES = 10, MIN_SEASON_GAMES = 20;

export const seasonLabel = (y) => `${y - 1}-${String(y).slice(2)}`;

// Box-score highs row in facts.gh: [season, unit#, pts, reb, ast, threes,
// triple-doubles, 40+ games, 50+ games, 20-20 games, steals, blocks, ...].
const GH = { pts: 2, reb: 3, ast: 4, threes: 5, stl: 10, blk: 11 };
// Single-game feats a solver can check: "had a 50-point game".
const FEATS = [
  { k: 'pts', v: 50, label: 'Scored 50+ in a game', why: (n) => `${n} points` },
  { k: 'ast', v: 20, label: 'Had a 20-assist game', why: (n) => `${n} assists` },
  { k: 'reb', v: 25, label: 'Had a 25-rebound game', why: (n) => `${n} rebounds` },
  { k: 'threes', v: 10, label: 'Made 10+ threes in a game', why: (n) => `${n} threes` },
  { k: 'blk', v: 10, label: 'Had a 10-block game', why: (n) => `${n} blocks` },
  { k: 'stl', v: 8, label: 'Had an 8-steal game', why: (n) => `${n} steals` },
];
const SOLO = { roy: 'Rookie of the Year', smoy: 'Sixth Man of the Year', mip: 'Most Improved Player', dpoy: 'Defensive Player of the Year' };

// Fame, close to the crossword/Deep Cut formula but rebuilt from facts.json
// (which doesn't carry Deep Cut's fame). Only used for difficulty.
function fameOf(p) {
  const a = p.a || {};
  const mvp = (p.vt || []).filter((v) => v[1] === 'MVP' && v[2] === 1).length;
  const solo = Object.values(p.w || {}).reduce((s, x) => s + x.length, 0);
  let s = 3 * (a.allStar?.length || 0) + 10 * mvp + 2 * (p.r?.length || 0) + 3 * (a.allNba?.length || 0) + 3 * solo + p.g / 100;
  if (p.l >= 2022) s += 4;
  if (p.d >= 2022 && p.k) s += p.k <= 3 ? 12 : p.k <= 10 ? 6 : 0;
  return Math.round(s * 10) / 10;
}

let cached = null;
export function loadCatalog() {
  if (cached) return cached;
  const facts = src('facts');
  const list = src('players').players;   // [id, name, years, ?, nicknames, page, head]
  const pub = new Map(list.map((r) => [r[0], { years: r[2], page: r[5] || null, head: r[6] || null }]));

  // Unit display names; two units sharing a name get their years.
  const units = facts.units;
  const unitName = (i) => {
    const u = units[i];
    const twin = units.some((x, j) => j !== i && x.name === u.name);
    return twin ? `${u.name} (${u.from - 1}-${u.to === null ? 'present' : u.to})` : u.name;
  };
  // "the Spurs" for labels; full era name when the short name is ambiguous.
  const shortName = (i) => {
    const u = units[i];
    const clash = units.some((x, j) => j !== i && x.short === u.short && x.code !== u.code);
    return clash || units.some((x, j) => j !== i && x.name === u.name) ? unitName(i) : u.short;
  };

  const players = new Map();
  const cats = new Map();
  // weak: true for the label, so the fairness check counts it, but too thin
  // to build a group on (a 1-game stint).
  const add = (key, type, label, id, y, why, weak = false) => {
    let c = cats.get(key);
    if (!c) cats.set(key, (c = { key, type, label, members: new Map() }));
    (c.members.get(id) || c.members.set(id, []).get(id)).push({ y, why, weak });
    (catsOf.get(id) || catsOf.set(id, new Set()).get(id)).add(key);
  };
  const catsOf = new Map();   // player id -> Set of category keys (loose)

  const school = {};
  for (const p of facts.players) if (p.c) { const x = (school[p.c] ??= [0, 0]); x[0]++; if (p.b === 'United States') x[1]++; }
  const clubLike = new Set(Object.entries(school).filter(([, [n, us]]) => us / n < 0.5).map(([c]) => c));

  for (const p of facts.players) {
    const pp = pub.get(p.i) || {};
    const page = pp.page ? (pp.page.startsWith('s:') ? `https://hoopsmatic.com/salary-season-finder/player/${pp.page.slice(2)}/` : `https://hoopsmatic.com/nba-career-map/player/${pp.page.slice(2)}.html`) : null;
    players.set(p.i, { id: p.i, name: p.n, first: p.f, last: p.l, fame: fameOf(p), link: page, head: pp.head || null, raw: p });

    // Teams: first season with each era unit.
    const firstWith = new Map(), gpWith = new Map();
    for (const [y, u, gp] of p.s) {
      if (!firstWith.has(u) || y < firstWith.get(u)) firstWith.set(u, y);
      gpWith.set(u, (gpWith.get(u) || 0) + gp);
    }
    const us = [...firstWith.keys()].sort((a, b) => a - b);
    // Played for both (a pair of era units).
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      const a = us[i], b = us[j];
      const y = Math.max(firstWith.get(a), firstWith.get(b));
      add(`teams:${a}:${b}`, 'teams', `Played for the ${shortName(a)} and the ${shortName(b)}`, p.i, y,
        `${unitName(a)} ${seasonLabel(firstWith.get(a))}, ${unitName(b)} ${seasonLabel(firstWith.get(b))}`,
        Math.min(gpWith.get(a), gpWith.get(b)) < MIN_TEAM_GAMES);
    }
    // On a team's roster in one season (1+ regular-season game).
    const seen = new Set();
    for (const [y, u, gp] of p.s) {
      if (seen.has(y + '|' + u)) continue;
      seen.add(y + '|' + u);
      const g = p.s.filter((r) => r[0] === y && r[1] === u).reduce((t, r) => t + r[2], 0);
      add(`roster:${u}:${y}`, 'roster', `${seasonLabel(y)} ${unitName(u)}`, p.i, y, `${g} game${g === 1 ? '' : 's'} for them that season`, g < MIN_SEASON_GAMES);
    }
    // Draft class (Deep Cut: bio DRAFT includes undrafted players, so it's a "class").
    if (p.d) {
      add(`draft:${p.d}`, 'draft', `${p.d} draft class`, p.i, p.d + 1, p.k ? `No. ${p.k} pick in ${p.d}` : `${p.d} class, undrafted`);
      if (p.k === 1) add('no1', 'no1', 'No. 1 overall picks', p.i, p.d + 1, `No. 1 pick in ${p.d}`);
    }
    // College.
    // facts.json's college field also holds pro clubs (Partizan, Real Madrid,
    // Mega Basket); a "college" mostly made of players born abroad is a club.
    if (p.c) {
      if (clubLike.has(p.c)) add(`club:${p.c}`, 'club', `Came to the NBA from ${p.cn || p.c}`, p.i, p.f, p.cn || p.c);
      else add(`college:${p.c}`, 'college', `Played college ball at ${p.cn || p.c}`, p.i, p.f, p.cn || p.c);
    }
    // Birthplace (Born & Died; birthplace only, never nationality).
    if (p.b && p.b !== 'United States') add(`country:${p.b}`, 'country', `Born in ${p.b}`, p.i, p.f, p.bp || p.b);
    if (p.b === 'United States' && p.bp) {
      const parts = p.bp.split(',').map((s) => s.trim());
      const state = parts[parts.length - 1], city = parts[0];
      if (state) add(`state:${state}`, 'state', `Born in ${state}`, p.i, p.f, p.bp);
      if (city && parts.length > 1) add(`city:${city}|${state}`, 'city', `Born in ${city}`, p.i, p.f, p.bp);
    }
    // Titles, by era unit.
    for (const [y, u] of p.r || []) add(`ring:${u}`, 'ring', `Won a title with the ${shortName(u)}`, p.i, y, `${seasonLabel(y)} ${unitName(u)}`);
    // All-Star with a team.
    for (const [y, u] of p.a?.allStar || []) add(`allstar:${u}`, 'allstar', `All-Star with the ${shortName(u)}`, p.i, y, `${seasonLabel(y)} All-Star`);
    // Single-winner awards.
    for (const [k, ys] of Object.entries(p.w || {})) if (SOLO[k]) for (const y of ys) add(`solo:${k}`, 'solo', `Won ${SOLO[k]}`, p.i, y, `${SOLO[k]} ${seasonLabel(y)}`);
    // Olympic gold (season unknown in the data: counted from his first NBA season).
    if ((p.md || []).includes('Olympic Gold')) add('olygold', 'olygold', 'Won Olympic gold', p.i, p.f, 'Olympic gold medal');
    // Single-game feats (box scores; regular season).
    for (const f of FEATS) {
      const rows = (p.gh || []).filter((r) => r[GH[f.k]] != null && r[GH[f.k]] >= f.v);
      for (const r of rows) add(`feat:${f.k}${f.v}`, 'feat', f.label, p.i, r[0], `${f.why(r[GH[f.k]])}, ${seasonLabel(r[0])} ${unitName(r[1])}`);
    }
  }
  cached = { players, cats, catsOf, unitName, units, asOf: facts.asOf };
  return cached;
}

// Strict evidence: what a group shown to solvers may rest on (1980-81 on).
export function strictEvidence(cat, id) {
  const ev = (cat.members.get(id) || []).filter((e) => e.y >= FIRST_SEASON && !e.weak);
  return ev.length ? ev.sort((a, b) => a.y - b.y) : null;
}

// Every category a set of players all fit (strict), biggest first: the
// maker tool's group suggestions ("these 3 players were all ...").
export function suggest(ids, { min = 4 } = {}) {
  const { cats, players } = loadCatalog();
  const out = [];
  for (const c of cats.values()) {
    if (!ids.every((id) => strictEvidence(c, id))) continue;
    const pool = [...c.members.keys()].filter((id) => strictEvidence(c, id) && players.get(id).head && players.get(id).link);
    if (pool.length >= min) out.push({ key: c.key, label: c.label, type: c.type, pool: pool.length });
  }
  return out.sort((a, b) => a.pool - b.pool);
}
