// Which NBA.com cutouts are real photos. NBA.com answers 200 with a grey
// silhouette when it has no photo; those players get no head in data.json
// (a name-only tile on the page). Results are kept in data/head-check.json
// ({"<NBA id>": 1 | 0}) so only new ids are fetched.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;
const FILE = ROOT + 'data/head-check.json';
// md5 of NBA.com's 260x190 silhouette (Nov 13, 2026).
const SILHOUETTE = new Set(['7475ba9619305909d7998dd9dba02481']);
export const nbaId = (head) => { const m = head && String(head).match(/^(?:n:(\d+)|f:(\d+)-)/); return m ? m[1] || m[2] : null; };

export async function checkHeads(heads) {
  const seen = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  const todo = [...new Set(heads.map(nbaId).filter((id) => id && !(id in seen)))];
  for (let i = 0; i < todo.length; i += 24) {
    await Promise.all(todo.slice(i, i + 24).map(async (id) => {
      try {
        const r = await fetch(`https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`);
        if (!r.ok) { if (r.status === 404 || r.status === 403) seen[id] = 0; return; }
        const md5 = createHash('md5').update(Buffer.from(await r.arrayBuffer())).digest('hex');
        seen[id] = SILHOUETTE.has(md5) ? 0 : 1;
      } catch (e) { /* network: try again next build */ }
    }));
  }
  const sorted = Object.fromEntries(Object.entries(seen).sort(([a], [b]) => +a - +b));
  writeFileSync(FILE, JSON.stringify(sorted) + '\n');
  return sorted;
}
