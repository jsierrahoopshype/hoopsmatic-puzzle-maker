// Needs .cache/sources (node scripts/pull-data.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, strictEvidence, suggest, RECENT_SEASON } from '../scripts/lib/catalog.mjs';
import { checkPuzzle } from '../scripts/lib/fairness.mjs';
import { generatePuzzle, playable } from '../scripts/lib/generate.mjs';

const { cats, players } = loadCatalog();
const asInput = (r) => ({ groups: r.groups.map((g) => ({ key: g.key, ids: g.ids.slice() })) });
const fair = Array.from({ length: 40 }, (_, i) => generatePuzzle('test-' + i)).filter(Boolean);

test('the generator finds fair puzzles, deterministically', () => {
  assert.ok(fair.length >= 38);
  assert.deepEqual(asInput(generatePuzzle('test-0')), asInput(fair[0]));
  for (const r of fair) {
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(new Set(r.groups.flatMap((g) => g.ids)).size, 16);
    assert.deepEqual(r.groups.map((g) => g.color), ['yellow', 'green', 'blue', 'purple']);
    assert.ok(r.groups.filter((g) => g.anchor >= RECENT_SEASON).length >= 2);
    for (const g of r.groups) for (const id of g.ids) assert.ok(strictEvidence(cats.get(g.key), id).every((e) => e.y >= 1981));
  }
});

test('a 5th player who fits a group makes it ambiguous', () => {
  const r = fair[0], p = asInput(r);
  const [a, b] = p.groups;
  const all = new Set(p.groups.flatMap((g) => g.ids));
  const intruder = [...cats.get(a.key).members.keys()].find((id) => !all.has(id) && playable(players.get(id)) && strictEvidence(cats.get(a.key), id));
  b.ids[0] = intruder;
  const res = checkPuzzle(p);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.startsWith(cats.get(a.key).label + ': also true for')), res.errors.join('; '));
});

test('another label true for 4 of the 16 is refused; 3 is a decoy', () => {
  const r = fair.find((x) => x.decoys.length);
  const d = r.decoys[0], p = asInput(r);
  const all = new Set(p.groups.flatMap((g) => g.ids));
  // Put a 4th player of the decoy's label in, in place of a non-decoy player.
  const cat = cats.get(d.key);
  const g = p.groups.find((x) => x.ids.some((id) => !d.ids.includes(id)));
  const out = g.ids.findIndex((id) => !d.ids.includes(id));
  const fourth = [...cat.members.keys()].find((id) => !all.has(id) && playable(players.get(id)));
  g.ids[out] = fourth;
  const res = checkPuzzle(p);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('another link fits') || e.includes('also true for') || e.includes("doesn't fit")), res.errors.join('; '));
});

test('groups resting on seasons before 1980-81 are refused', () => {
  const p = asInput(fair[0]);
  const old = [...cats.get('draft:1979').members.keys()].slice(0, 4);
  p.groups[3] = { key: 'draft:1979', ids: old };
  const res = checkPuzzle(p);
  assert.ok(res.errors.some((e) => e.includes("doesn't fit")));
});

test('at least 2 of the 4 groups must be about 2010-11 or later', () => {
  // Four 1990s rosters (players with headshots), checked for the rule alone.
  const keys = ['roster:%:1996', 'roster:%:1997', 'roster:%:1998', 'roster:%:1999'];
  const res = checkPuzzle({ groups: keys.map((k) => {
    const c = [...cats.values()].find((x) => x.type === 'roster' && x.key.endsWith(k.slice(-5)));
    return { key: c.key, ids: [...c.members.keys()].slice(0, 4) };
  }) });
  assert.ok(res.errors.some((e) => e.includes('2010-11 or later')));
});

test('every player has a headshot and a HoopsMatic page; a weak cameo never builds a group', () => {
  for (const r of fair) for (const id of r.groups.flatMap((g) => g.ids)) {
    assert.ok(players.get(id).head && /^https:\/\/hoopsmatic\.com\//.test(players.get(id).link));
  }
  for (const r of fair) for (const g of r.groups) for (const id of g.ids) assert.ok(!g.why[id].weak);
});

test('maker suggestions: labels every given player fits', () => {
  const r = fair[0], g = r.groups[0];
  const s = suggest(g.ids.slice(0, 3));
  assert.ok(s.some((x) => x.key === g.key));
});
