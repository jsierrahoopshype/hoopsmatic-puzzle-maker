# hoopsmatic-puzzle-maker

Puzzle Maker: an NBA group-finding game where readers build puzzles for each other. 16 players, 4 hidden groups of 4, 4 mistakes allowed.

Step 1 (this commit): the group generator and the fairness check. No page, no server yet.

```bash
node scripts/pull-data.mjs          # pinned Deep Cut facts -> .cache/sources/
node scripts/samples.mjs 5          # sample puzzles as Markdown
node --test test/*.test.mjs         # fairness tests
```

- `scripts/lib/catalog.mjs`: every group label the data can check, with per-player evidence and season.
- `scripts/lib/fairness.mjs`: the fairness check, decoys, difficulty and colors.
- `scripts/lib/generate.mjs`: seeded data-built puzzles (the Daily's source until user puzzles take over).
- `docs/step1-report.md`: decisions, open questions, where the server will live, privacy draft.
- `docs/step1-samples.md`: 5 sample puzzles.
