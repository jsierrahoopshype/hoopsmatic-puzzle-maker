// Build everything the page and the server read, into public/:
//   data.json     compact player facts (format: top of public/core.js)
//   config.json   { launch, badges } from rules/launch.json
//   daily/<date>.lock  one data-built Daily per day from rules/launch.json
//                 start, encrypted for the server (scripts/lib/lock.mjs).
// Existing locks are never rewritten (a published day stays as it was).
// Each day's puzzle comes from a random seed that is never stored, so the
// public data and code can't be used to work out a coming Daily. No group
// repeats within 7 days of the same build when it can be helped. Dailies use core.js's 'daily'
// mode: easy and medium groups only, 2+ easy, well-known recent players,
// rated Easy or Medium (Jorge, Nov 13, 2026).
//   node scripts/pull-data.mjs && node scripts/build.mjs
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { compactData } from './lib/data.mjs';
import { buildCatalog, generatePuzzle, boardOrder } from '../public/core.js';
import { fetchPubkey, lock } from './lib/lock.mjs';
import { checkHeads, nbaId } from './lib/heads.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const L = JSON.parse(readFileSync(ROOT + 'rules/launch.json', 'utf8'));
const data = compactData();
// Players whose NBA.com photo is the grey silhouette (or missing) get no head:
// a name-only tile (scripts/lib/heads.mjs).
const heads = await checkHeads(data.players.map((p) => p[2]).filter(Boolean));
let blank = 0;
for (const p of data.players) if (p[2] && heads[nbaId(p[2])] === 0) { p[2] = 0; blank++; }
console.log(`headshots: ${blank} silhouettes or missing, name-only`);
writeFileSync(ROOT + 'public/data.json', JSON.stringify(data));
writeFileSync(ROOT + 'public/config.json', JSON.stringify({ launch: L.launch, badges: L.badges || null }) + '\n');
console.log(`data.json: ${data.players.length} players, as of ${data.asOf}`);

const pub = await fetchPubkey();
if (!pub) { console.log('No server key yet (rules/pubkey.json, or the live /puzzle-maker/api/pubkey): no Daily locks built.'); process.exit(0); }
const C = buildCatalog(data);
mkdirSync(ROOT + 'public/daily', { recursive: true });
const recent = [];
let made = 0;
// From the start day to L.days ahead of today (the weekly refresh rolls it forward).
const startMs = Date.parse(L.start + 'T00:00:00Z');
const total = Math.max(L.days, Math.ceil((Date.now() - startMs) / 86400000) + L.days);
for (let i = 0; i < total; i++) {
  const date = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
  const file = `${ROOT}public/daily/${date}.lock`;
  if (existsSync(file)) continue;
  // No group used in the last 7 days; failing that after 10 tries, the try
  // with the fewest repeats.
  let r = null, best = null;
  for (let k = 0; k < 10 && !r; k++) {
    const x = generatePuzzle(C, randomBytes(12).toString('base64url'));
    if (!x) continue;
    const rep = x.groups.filter((g) => recent.includes(g.key)).length;
    if (rep === 0) r = x;
    else if (!best || rep < best.rep) best = { x, rep };
  }
  r = r || (best && best.x);
  if (!r) throw new Error('no puzzle for ' + date);
  recent.push(...r.groups.map((g) => g.key));
  while (recent.length > 28) recent.shift();
  const ids = r.groups.flatMap((g) => g.ids);
  const players = Object.fromEntries(ids.map((id) => { const p = C.players.get(id); return [id, [p.name, p.head, p.link]]; }));
  const plain = { v: 1, game: 'puzzle-maker', date, asOf: data.asOf, difficulty: r.difficulty, tiles: boardOrder(ids, randomBytes(8).toString('hex')), players,
    groups: r.groups.map((g) => ({ key: g.key, label: g.label, color: g.color, ids: g.ids, why: Object.fromEntries(g.ids.map((id) => [id, g.why[id].why])) })) };
  writeFileSync(file, JSON.stringify(await lock(plain, pub)) + '\n');
  // The answers stay out of git: a local copy only (.cache is gitignored).
  mkdirSync(ROOT + '.cache/daily-plain', { recursive: true });
  writeFileSync(`${ROOT}.cache/daily-plain/${date}.json`, JSON.stringify(plain));
  made++;
}
console.log(`daily locks: ${made} new (key ${pub.kid})`);
