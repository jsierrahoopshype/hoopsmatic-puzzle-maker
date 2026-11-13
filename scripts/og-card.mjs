// The spoiler-free link-preview card, public/og-card.jpg (1200x630), served
// extension-less at hoopsmatic.com/puzzle-maker/og-card. Drawn once with
// headless Chromium; no players, just the game's look.
//   npm install --no-save playwright && node scripts/og-card.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = new URL('..', import.meta.url).pathname;
const font = (f) => `url(data:font/woff2;base64,${readFileSync(ROOT + 'public/fonts/' + f).toString('base64')}) format('woff2')`;
const C = ['#f5d26b', '#8fd18a', '#8fb6f2', '#c39bea'];
const rows = [[0, 0, 0, 0], [1, 1, 1, 1], [2, 3, 2, 2], [3, 2, 3, 3]];
const html = `<!doctype html><html><head><style>
@font-face { font-family: Oswald; src: ${font('oswald-latin-wght-normal.woff2')}; font-weight: 200 700; }
@font-face { font-family: 'DM Sans'; src: ${font('dm-sans-latin-wght-normal.woff2')}; font-weight: 100 1000; }
body { margin: 0; width: 1200px; height: 630px; background: #0b0b1c; font-family: 'DM Sans'; }
.card { position: absolute; inset: 28px; border: 2px solid #3a3a6a; border-radius: 22px; background: linear-gradient(135deg, #15153a, #0a0a1a); display: flex; align-items: center; padding: 0 64px; gap: 64px; }
.txt { flex: 1; }
h1 { margin: 0; font: 700 92px/1 Oswald; letter-spacing: 6px; text-transform: uppercase; background: linear-gradient(90deg, #ff6b35, #ffd700); -webkit-background-clip: text; color: transparent; }
p { margin: 22px 0 0; color: #e0e0ff; font-size: 34px; line-height: 1.3; }
.small { color: #aaaadd; font-size: 26px; margin-top: 30px; font-family: Oswald; letter-spacing: 3px; text-transform: uppercase; }
.grid { display: grid; grid-template-columns: repeat(4, 84px); gap: 14px; }
.grid i { width: 84px; height: 84px; border-radius: 14px; display: block; }
</style></head><body><div class="card"><div class="txt"><h1>Puzzle<br>Maker</h1>
<p>Sixteen NBA players. Four hidden groups. Solve the Daily or build one for other fans.</p>
<div class="small">hoopsmatic.com/puzzle-maker</div></div>
<div class="grid">${rows.flat().map((k) => `<i style="background:${C[k]}"></i>`).join('')}</div></div></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
writeFileSync(ROOT + 'public/og-card.jpg', await p.screenshot({ type: 'jpeg', quality: 88 }));
await b.close();
console.log('public/og-card.jpg');
