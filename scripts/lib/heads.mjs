// Which NBA.com cutouts are real photos. NBA.com answers 200 with a grey
// silhouette when it has no photo, the same file as its ID 0: a response
// byte-identical (SHA-256) to this size's ID 0 file is no photo. Those
// players get no head in data.json (a name-only tile on the page). Results
// are kept in data/head-check.json ({"<NBA id>": 1 | 0}) so only new ids are
// fetched. This fetches cdn.nba.com directly (hoopsmatic.com shows GitHub
// runners a bot check).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;
const FILE = ROOT + 'data/head-check.json';
const CDN = 'https://cdn.nba.com/headshots/nba/latest/260x190/';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
// The silhouette: this size's ID 0 file, fetched once per build.
async function silhouette() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(CDN + '0.png');
      if (r.ok) return sha256(Buffer.from(await r.arrayBuffer()));
    } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * attempt));
  }
  return null;
}
export const nbaId = (head) => { const m = head && String(head).match(/^(?:n:(\d+)|f:(\d+)-)/); return m ? m[1] || m[2] : null; };

export async function checkHeads(heads) {
  const seen = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  const todo = [...new Set(heads.map(nbaId).filter((id) => id && !(id in seen)))];
  // Without the silhouette to compare against, check nothing new this build.
  const SILHOUETTE = todo.length ? await silhouette() : null;
  if (!SILHOUETTE) todo.length = 0;
  for (let i = 0; i < todo.length; i += 24) {
    await Promise.all(todo.slice(i, i + 24).map(async (id) => {
      try {
        const r = await fetch(`${CDN}${id}.png`);
        if (!r.ok) { if (r.status === 404 || r.status === 403) seen[id] = 0; return; }
        seen[id] = sha256(Buffer.from(await r.arrayBuffer())) === SILHOUETTE ? 0 : 1;
      } catch (e) { /* network: try again next build */ }
    }));
  }
  const sorted = Object.fromEntries(Object.entries(seen).sort(([a], [b]) => +a - +b));
  writeFileSync(FILE, JSON.stringify(sorted) + '\n');
  return sorted;
}
