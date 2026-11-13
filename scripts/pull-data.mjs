// Download the pinned Deep Cut files (data/sources.lock.json) into
// .cache/sources/<id>.json and refuse any whose sha256 differs from the lock.
// Public files, no token, no Action needed.
//
//   node scripts/pull-data.mjs            exactly what the lock pins
//   node scripts/pull-data.mjs --latest   Deep Cut's latest main, lock updated
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const lock = JSON.parse(readFileSync(ROOT + 'data/sources.lock.json', 'utf8'));
mkdirSync(ROOT + '.cache/sources', { recursive: true });
const latest = process.argv.includes('--latest');

let bad = 0;
for (const s of lock.sources) {
  if (latest) s.commit = execFileSync('git', ['ls-remote', `https://github.com/${s.repo}.git`, 'HEAD'], { encoding: 'utf8' }).split(/\s/)[0];
  const url = `https://raw.githubusercontent.com/${s.repo}/${s.commit}/${s.path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  const sha = createHash('sha256').update(text).digest('hex');
  if (latest) s.sha256 = sha;
  else if (sha !== s.sha256) { console.error(`${s.id}: sha256 differs from the lock`); bad++; continue; }
  writeFileSync(`${ROOT}.cache/sources/${s.id}.json`, text);
  console.log(`${s.id.padEnd(8)} ${s.commit.slice(0, 7)} ok`);
}
if (bad) process.exit(1);
if (latest) writeFileSync(ROOT + 'data/sources.lock.json', JSON.stringify(lock, null, 1) + '\n');
