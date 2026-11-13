// Print sample data-built puzzles as plain text (docs/step1-samples.md).
//   node scripts/samples.mjs [count] [seed prefix]
// Picks one puzzle per difficulty label where it can, each with at least one
// decoy, so the samples show the range.
import { loadCatalog, seasonLabel } from './lib/catalog.mjs';
import { generatePuzzle } from './lib/generate.mjs';

const count = +(process.argv[2] || 5), prefix = process.argv[3] || 'sample';
const { players, asOf } = loadCatalog();
const want = ['Easy', 'Medium', 'Hard', 'Expert', 'Medium', 'Hard'];
const out = [];
for (let s = 0; out.length < count && s < 2000; s++) {
  const r = generatePuzzle(`${prefix}-${s}`);
  if (!r || !r.decoys.length || r.difficulty.label !== want[out.length]) continue;
  out.push(r);
}
const lines = [`# Puzzle Maker, step 1: sample puzzles`, '', `Data: Deep Cut facts as of ${asOf}. Built by \`node scripts/samples.mjs ${count} ${prefix}\`.`, ''];
out.forEach((r, n) => {
  const names = r.groups.flatMap((g) => g.ids).map((id) => players.get(id).name).sort((a, b) => a.localeCompare(b));
  lines.push(`## Sample ${n + 1}: ${r.difficulty.label} (${r.difficulty.score}/100), seed ${r.seed}`, '');
  lines.push(`**The 16 (shuffled for the board):** ${names.join(', ')}`, '');
  for (const g of r.groups) {
    lines.push(`**${g.color.toUpperCase()}: ${g.label}** (difficulty ${g.score}, about ${seasonLabel(g.anchor)})`);
    for (const id of g.ids) lines.push(`- [${players.get(id).name}](${players.get(id).link}): ${g.why[id].why}`);
    lines.push('');
  }
  if (r.decoys.length) {
    lines.push('Decoys (true for 3 of the 16, across groups; allowed):');
    for (const d of r.decoys) lines.push(`- ${d.label}: ${d.ids.map((id) => players.get(id).name).join(', ')}`);
    lines.push('');
  }
});
console.log(lines.join('\n'));
