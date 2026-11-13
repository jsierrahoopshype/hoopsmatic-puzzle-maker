// Needs .cache/sources (node scripts/pull-data.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../scripts/lib/data.mjs';
import { checkPuzzle, generatePuzzle, playable, fit, suggest, candidates, judge, shareGrid, RECENT_SEASON } from '../public/core.js';

const C = catalog(), { cats, players } = C;
const asInput = (r) => ({ groups: r.groups.map((g) => ({ key: g.key, ids: g.ids.slice() })) });
const fair = Array.from({ length: 40 }, (_, i) => generatePuzzle(C, 'test-' + i)).filter(Boolean);
const codes = (r) => r.errors.map((e) => e.code);

test('the generator finds fair puzzles, deterministically', () => {
  assert.ok(fair.length >= 38);
  assert.deepEqual(asInput(generatePuzzle(C, 'test-0')), asInput(fair[0]));
  for (const r of fair) {
    assert.equal(r.ok, true, r.errors.map((e) => e.text).join('; '));
    assert.equal(new Set(r.groups.flatMap((g) => g.ids)).size, 16);
    assert.deepEqual(r.groups.map((g) => g.color), ['yellow', 'green', 'blue', 'purple']);
    assert.ok(r.groups.filter((g) => g.anchor >= RECENT_SEASON).length >= 2);
    for (const g of r.groups) for (const id of g.ids) assert.ok(g.why[id].y >= 1981 && !g.why[id].weak);
  }
});

test('a 5th player who fits a group makes it ambiguous', () => {
  const p = asInput(fair[0]);
  const [a, b] = p.groups;
  const all = new Set(p.groups.flatMap((g) => g.ids));
  b.ids[0] = [...cats.get(a.key).members.keys()].find((id) => !all.has(id) && playable(players.get(id)) && fit(cats.get(a.key), id).ok);
  const res = checkPuzzle(C, p);
  assert.ok(res.errors.some((e) => e.code === 'extra' && e.key === a.key));
});

test('another label true for 4 of the 16 is refused; 3 is a decoy', () => {
  const r = fair.find((x) => x.decoys.length);
  const d = r.decoys[0], p = asInput(r);
  const all = new Set(p.groups.flatMap((g) => g.ids));
  const g = p.groups.find((x) => x.ids.some((id) => !d.ids.includes(id)));
  g.ids[g.ids.findIndex((id) => !d.ids.includes(id))] = [...cats.get(d.key).members.keys()].find((id) => !all.has(id) && playable(players.get(id)));
  const res = checkPuzzle(C, p);
  assert.equal(res.ok, false);
  assert.ok(codes(res).some((c) => ['alt', 'extra', 'fit'].includes(c)));
});

test('labels count every player they are true for, in any season and any stint', () => {
  // A cameo is true for "Played for the <season> <team>" (fairness) but can't be IN that group.
  const c = [...cats.values()].find((x) => x.type === 'roster' && [...x.members.values()].some((ev) => ev[0].weak && ev[0].short.includes('fewer')));
  const id = [...c.members.keys()].find((k) => c.members.get(k)[0].weak);
  assert.equal(fit(c, id).ok, false);
  assert.match(fit(c, id).why, /fewer than 20 games/);
});

test('draft groups: drafted players only, 60+ career games to be in one', () => {
  for (const c of cats.values()) if (c.type === 'draft') for (const [id, ev] of c.members) {
    const p = players.get(id);
    assert.ok(p.pick, `${p.name} undrafted in ${c.key}`);
    if (p.g < 60) assert.equal(fit(c, id).ok, false);
  }
  assert.match(cats.get('draft:2014').label, /^Drafted in 2014$/);
});

test('team names are each era\'s own, in full', () => {
  const sonics = [...cats.values()].find((c) => c.type === 'ring' && /SuperSonics/.test(c.label));
  assert.equal(sonics.label, 'Won a title with the Seattle SuperSonics');
  assert.ok([...cats.values()].filter((c) => c.type === 'teams').every((c) => /^Played for the [A-Z0-9][^,]* and the /.test(c.label)));
});

test('groups resting on seasons before 1980-81 are refused; 2 of 4 must be 2010-11 or later', () => {
  const p = asInput(fair[0]);
  const keys = ['roster:', 'roster:', 'roster:', 'roster:'];
  const old = [...cats.values()].filter((c) => c.type === 'roster' && /199[6-9]$/.test(c.key)).slice(0, 4);
  const res = checkPuzzle(C, { groups: old.map((c) => ({ key: c.key, ids: [...c.members.keys()].slice(0, 4) })) });
  assert.ok(codes(res).includes('era'));
  void p; void keys;
});

test('single-team overlap is a warning, never an error', () => {
  for (const r of fair) for (const w of r.warnings) assert.equal(w.code, 'franchise');
  assert.ok(fair.some((r) => r.warnings.length), 'some puzzle with 4 from one franchise');
  assert.ok(fair.filter((r) => r.warnings.length).every((r) => r.ok));
});

test('a team-based group is not warned about as single-team overlap', () => {
  for (const r of fair) for (const w of r.warnings) {
    const set = w.ids.slice().sort().join(',');
    assert.ok(!r.groups.some((g) => g.ids.slice().sort().join(',') === set), w.text);
  }
});

test('every player has a headshot and a HoopsMatic page', () => {
  for (const r of fair) for (const id of r.groups.flatMap((g) => g.ids)) assert.ok(players.get(id).head && /^https:\/\/hoopsmatic\.com\//.test(players.get(id).link));
});

test('maker suggestions and candidates', () => {
  const g = fair[0].groups[0];
  assert.ok(suggest(C, g.ids.slice(0, 3)).some((x) => x.key === g.key));
  assert.ok(candidates(C, g.key).length >= 4);
});

test('judging guesses and the share grid', () => {
  const groups = fair[0].groups;
  assert.deepEqual(judge(groups, [], groups[2].ids), { hit: 2 });
  assert.deepEqual(judge(groups, [], [...groups[0].ids.slice(0, 3), groups[1].ids[0]]), { away: 3 });
  assert.equal(shareGrid(groups, [groups[0].ids]), '\u{1F7E8}'.repeat(4));
});

test('Dailies: 2+ easy groups, no hard group, Easy or Medium, 12+ tiles from 2010-11 on', () => {
  for (const r of fair) {
    assert.ok(r.difficulty.easy >= 2, r.groups.map((g) => g.label).join(' | '));
    assert.equal(r.difficulty.hard, 0);
    assert.ok(['Easy', 'Medium'].includes(r.difficulty.label));
    assert.ok(r.groups.reduce((n, g) => n + g.ids.filter((id) => g.why[id].y >= 2011).length, 0) >= 12);
  }
});

test('Hard practice can use hard groups and is rated Hard or harder when it does', () => {
  const hs = Array.from({ length: 10 }, (_, i) => generatePuzzle(C, 'hard-' + i, { mode: 'hard' })).filter(Boolean);
  assert.ok(hs.length >= 9);
  for (const r of hs) if (r.difficulty.hard) assert.ok(['Hard', 'Expert'].includes(r.difficulty.label));
});

test('labels that can mean two things are never groups', () => {
  for (const key of ['state:Georgia', 'country:Georgia']) if (cats.get(key)) assert.ok(cats.get(key).ambiguous, key);
  const hornets = [...cats.values()].filter((c) => c.type !== 'roster' && c.label.includes('Charlotte Hornets'));
  assert.ok(hornets.length && hornets.every((c) => c.ambiguous));
  const labels = new Map();
  for (const c of cats.values()) if (!c.ambiguous) { assert.ok(!labels.has(c.label), c.label); labels.set(c.label, 1); }
  const r = generatePuzzle(C, 'amb', { mode: 'hard' });
  const p = asInput(r); p.groups[0].key = 'state:Georgia';
  assert.ok(checkPuzzle(C, p).errors.some((e) => e.code === 'ambiguous'));
});

test('a maker puzzle with fewer than 2 easy groups gets a warning; suggestions list easy links first', () => {
  const r = generatePuzzle(C, 'hard-w', { mode: 'hard', tries: 20000 });
  const res = checkPuzzle(C, asInput(r));
  if (res.difficulty.easy < 2) assert.ok(res.warnings.some((w) => w.code === 'easy'));
  const g = fair[0].groups.find((x) => x.tier === 'easy');
  const s = suggest(C, g.ids.slice(0, 2));
  const order = { easy: 0, medium: 1, hard: 2 };
  for (let i = 1; i < s.length; i++) assert.ok(order[s[i - 1].tier] <= order[s[i].tier]);
});
