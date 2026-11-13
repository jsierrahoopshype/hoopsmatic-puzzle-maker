# Puzzle Maker, step 1: group generator and fairness check

Samples: [step1-samples.md](step1-samples.md).

## Data

No new pipeline. Puzzle Maker reads Deep Cut's compiled `data/facts.json` and `public/players.json`, pinned by Deep Cut commit and sha256 in `data/sources.lock.json`. Deep Cut already joins nba-player-data, salary-season-finder, nba-career-map, nba-born-died and the aderoa/nba-boxscores game highs, with the crossword's era team names. `players.json` gives each player's HoopsMatic page and headshot source, so links and headshots match Deep Cut exactly. `node scripts/pull-data.mjs --latest` moves the pin to Deep Cut's latest main.

## Group labels (5,400+)

| Kind | Example | Notes |
|---|---|---|
| teams | Played for the Clippers and the Heat | era names; 10+ games with each team to build a group |
| roster | 2015-16 Indiana Pacers | 20+ games that season to build a group |
| draft | 2014 draft class | includes undrafted players of that class (Deep Cut's convention) |
| college | Played college ball at Missouri | |
| country / state / city | Born in Turkey / Michigan / Miami | birthplace only |
| feat | Scored 50+ in a game, 20-assist, 25-rebound, 10 threes, 10 blocks, 8 steals | regular-season box scores |
| ring / allstar | Won a title with the Bulls / All-Star with the Pelicans | |
| solo | Won Sixth Man of the Year (also ROY, MIP, DPOY) | |
| no1 / olygold | No. 1 overall picks / Won Olympic gold | |

## Fairness rule

A puzzle is fair when the maker's 4 groups are the only split of the 16 the data supports:

1. Each group's label is true for exactly its 4 players among the 16. A 5th fitting player is refused ("also true for X").
2. No other label is true for 4+ of the 16, unless it's a synonym for one of the groups (same 4 players).
3. The check uses every season a label is true for, including pre-1980 and cameo stints, because those are still reasons a solver might pick a player. Groups themselves can only rest on 1980-81-on evidence that isn't a cameo.
4. A label true for exactly 3 of the 16, across 2+ groups, is a decoy. Decoys are allowed and raise the difficulty.

Also enforced: 16 different players, all with a headshot and a HoopsMatic page; at least 2 of the 4 groups about 2010-11 or later (a group's era = median season of its 4 players' evidence).

Speed: about 6 ms per data-built puzzle; checking a maker's puzzle is ~1 ms, so it can run on every edit.

## Difficulty and colors

Per group: how obscure the kind of label is, how famous the 4 players are (Deep Cut-style fame from awards, titles and games), how many decoys pull at its players, and a small bonus for very recent groups. Colors go yellow, green, blue, purple from easiest to hardest. The puzzle score is the group average plus 2 per decoy (max 8). Labels: Easy under 57, Medium under 65, Hard under 73, Expert 73+ (the quartiles of 400 data-built puzzles). This is a first guess to recalibrate from real solve rates.

## Decisions I made (flag any you want changed)

- **Single-team labels are not groups** ("played for the Lakers"): with 16 NBA players, most puzzles would have 4+ ex-Lakers, so the label can't make a fair group or a fair objection. Same for "born in the U.S." and decades.
- **Pro clubs in the college field.** Deep Cut's facts put Partizan, Real Madrid, Mega Basket and others in the college field. A "college" where most players were born abroad is treated as a club: still checked for fairness ("Came to the NBA from Partizan"), never used as a data-built group. Deep Cut's own college prompts may have the same issue; worth a look there.
- **Data-built puzzles stay solvable:** every player is known (fame 8+), has 200+ games, or is a current player with 100+ games; every group has at least one known name. Maker puzzles may use anyone; the difficulty shows it.
- **Olympic gold** has no year in the data, so its era is the player's first NBA season.

## Open questions for Jorge

1. **Single-team decoys.** Should the check warn a maker (not refuse) when 4+ of the 16 played for one franchise?
2. **Current rookies** (the 2026 class) can appear in data-built puzzles via draft class. Keep, or wait until they have 100 games?
3. **Data-built Daily answers.** I'd generate them inside the server from a secret seed (HMAC of the date) so no answers are ever in the public repo. The alternative is Deep Cut's encrypted `.lock` per day.

## Where the server will live

- **Code:** `hoopsmatic-worker/puzzle-maker-server/`, a new Worker `hoopsmatic-puzzle-maker-server` with one SQLite Durable Object, built like `deep-cut-server/` and `crossword-server/`. Its own route `hoopsmatic.com/puzzle-maker/api/*`, deployed only by a new `deploy-puzzle-maker-server.yml` on merge to main. It copies `fairness.mjs` and `generate.mjs` exactly and reads a compact catalog file (labels and member ids; no puzzle in it) published from this repo's GitHub Pages.
- **Names:** user puzzle titles and maker names go through `deep-cut-server/src/names.js` (the 73-9 / crossword filter), copied rule for rule.
- **Main Worker changes (later step, after the state check in hoopsmatic-worker CLAUDE.md):** `/puzzle-maker/` served from this repo's Pages like `/deep-cut/`, noindex until you approve, launch-date switches from a `rules/launch.json` like Deep Cut's. No change to hoopsmatic-worker in step 1.
- **No paid or daily Actions job.** The Daily is picked by the server at request time (best user puzzle in the solve-rate band, else data-built). The data refresh can run on Deep Cut's existing weekly free Action by moving the pin.

## Draft text for hoopsmatic.com/privacy

> **Puzzle Maker.** When you make a puzzle, we store its title, the 16 players, the 4 groups and the name you choose to show as its maker (if any), so other people can play it. When you solve a puzzle, we store your guesses, your mistakes, how long you took and whether you finished, so we can show solve rates, rate each puzzle's maker and pick the Daily. To tell your puzzles and solves apart from other people's, your browser keeps a random ID that we create. We store only a scrambled form of it (a keyed hash), which cannot be turned back into the ID or linked to you. We do not ask for or store your email or an account, and we do not store your IP address. To limit abuse, we count requests per network with a code that changes every day and is deleted after two days. Puzzle titles and maker names are checked by a word filter before they are shown. Solves are kept for up to 400 days and then deleted. Published puzzles stay up until you or we remove them; totals such as a puzzle's solve rate contain nothing about any one person.

This mirrors the Deep Cut and crossword wording (keyed-hash device ID, daily network code deleted after 2 days, 400-day retention). Check it against the live paragraphs before publishing.
