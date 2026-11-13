// Print sample data-built puzzles as Markdown.  node scripts/samples.mjs [count] [seed prefix]
import { catalog } from './lib/data.mjs';
import { generatePuzzle, seasonLabel } from '../public/core.js';

const count = +(process.argv[2] || 5), prefix = process.argv[3] || 'sample';
const C = catalog(), { players } = C;
const want = ['Easy', 'Medium', 'Hard', 'Expert', 'Medium', 'Hard'];
const out = [];
for (let s = 0; out.length < count && s < 2000; s++) {
  const r = generatePuzzle(C, `${prefix}-${s}`);
  if (r && r.decoys.length && r.difficulty.label === want[out.length]) out.push(r);
}
const lines = ['# Puzzle Maker: sample data-built puzzles', '', `Data as of ${C.asOf}. \`node scripts/samples.mjs ${count} ${prefix}\`.`, ''];
out.forEach((r, n) => {
  lines.push(`## Sample ${n + 1}: ${r.difficulty.label} (${r.difficulty.score}/100), seed ${r.seed}`, '');
  lines.push(`**The 16:** ${r.groups.flatMap((g) => g.ids).map((id) => players.get(id).name).sort().join(', ')}`, '');
  for (const g of r.groups) {
    lines.push(`**${g.color.toUpperCase()}: ${g.label}** (difficulty ${g.score}, about ${seasonLabel(g.anchor)})`);
    for (const id of g.ids) lines.push(`- [${players.get(id).name}](${players.get(id).link}): ${g.why[id].why}`);
    lines.push('');
  }
  lines.push('Decoys:', ...r.decoys.map((d) => `- ${d.label}: ${d.ids.map((id) => players.get(id).name).join(', ')}`), '');
  if (r.warnings.length) lines.push('Warnings:', ...r.warnings.map((w) => `- ${w.text}`), '');
});
console.log(lines.join('\n'));
