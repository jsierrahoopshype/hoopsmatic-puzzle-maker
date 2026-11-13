// One page per Daily, public/<YYYY-MM-DD>/index.html, served at
// hoopsmatic.com/puzzle-maker/<YYYY-MM-DD>/: the main page with that day's
// title, description, canonical and og:url (all on hoopsmatic.com). The page
// script plays that day's puzzle (app.js reads the date from the path).
// Indexing is the Worker's (puzzleMakerNoindex): past Dailies from #1 only.
//
// Then the sitemap state: data/sitemap-state.json (committed) and its
// published copy public/sitemap-state.json, { urls: { path: { hash, lastmod } } }
// for the main page and every Daily page. A URL's lastmod moves only when its
// page's content hash changes; hoopsmatic-worker builds
// /puzzle-maker/sitemap.xml from it (main page + past Dailies from #1).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname;
const L = JSON.parse(readFileSync(ROOT + 'rules/launch.json', 'utf8'));
const SITE = 'https://hoopsmatic.com/puzzle-maker/';
const main = readFileSync(ROOT + 'public/index.html', 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const long = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const num = (d) => (L.launch && d >= L.launch ? Math.round((Date.parse(d) - Date.parse(L.launch)) / 86400000) + 1 : null);

export function dayPage(date) {
  const n = num(date);
  const name = n ? `Puzzle Maker #${n}` : 'Puzzle Maker preview';
  const title = `${name} (${long(date)}): find the four NBA groups | HoopsMatic`;
  const desc = `The Puzzle Maker Daily for ${long(date)}: sixteen NBA players, four hidden groups of four. Solve it, then play today's.`;
  const url = `${SITE}${date}/`;
  const swap = (html, re, to) => { if (!re.test(html)) throw new Error('template changed: ' + re); return html.replace(re, to); };
  let h = main;
  h = swap(h, /<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  h = swap(h, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`);
  h = swap(h, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
  h = swap(h, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
  h = swap(h, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(name + ': find the four NBA groups')}">`);
  return h;
}

export function buildPages() {
  const dates = readdirSync(ROOT + 'public/daily').map((f) => f.replace(/\.lock$/, '')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const pages = { '/puzzle-maker/': main };
  for (const d of dates) {
    const html = dayPage(d);
    mkdirSync(`${ROOT}public/${d}`, { recursive: true });
    writeFileSync(`${ROOT}public/${d}/index.html`, html);
    pages[`/puzzle-maker/${d}/`] = html;
  }
  const file = ROOT + 'data/sitemap-state.json';
  const old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).urls || {} : {};
  const today = new Date().toISOString().slice(0, 10);
  const urls = {};
  let moved = 0;
  for (const [path, html] of Object.entries(pages)) {
    const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
    const prev = old[path];
    if (prev && prev.hash === hash) urls[path] = prev;
    else { urls[path] = { hash, lastmod: today }; moved++; }
  }
  const state = JSON.stringify({ _about: 'Per-URL content hash and lastmod for hoopsmatic.com/puzzle-maker/sitemap.xml (scripts/pages.mjs): lastmod moves only when the page changes.', urls }, null, 0) + '\n';
  writeFileSync(file, state);
  writeFileSync(ROOT + 'public/sitemap-state.json', state);
  return { pages: dates.length, moved };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(buildPages());
