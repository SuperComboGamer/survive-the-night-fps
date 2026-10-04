---
name: create-pr
description: Open a pull request for Survive The Night the way the owner reads them - a short, non-technical overview, screenshots of what changed (required), a Risk section whenever server or shared code changes, and a before/after metrics table when numbers are tuned. Use whenever asked to create, open, make, raise or send a PR / pull request, or to put a branch up for review.
---

# Create a PR

The reader is a product owner deciding whether to merge and what to play. They read the overview and look at the
pictures; they do not read code. Write for them.

## Rules

1. **Screenshots are required.** No screenshots, no PR. A change a player can see gets a picture of it in the game; a
   change to something that already exists gets a before and an after with the same camera, seed and time. A change
   nobody sees (server, refactor) still gets one: the screen where its effect shows (the lobby, the end screen, a
   toast, the HUD), or a before/after showing that nothing changed.
2. **Overview, not detail.** What changes for the player, and why, in plain words. No file names, function names,
   item/protocol/ACT IDs, or a "How it works" section. The one exception is a big technical refactor (step 1).
3. **A Risk section when backend code changes** (step 1 says what counts).
4. **A Metrics table when tuning** (step 1 says what counts).
5. **Short.** The written part fits on one screen: about 200 words, not counting images and tables.
6. **Honest.** Say what nobody has played yet. Never claim a test you did not run.

Too technical: "Adds `Combat.skyflare`, PROJ 10; flares bypass AOI in the snapshot; protocol 30."
Right: "Adds a flare gun. Fire it into the sky and a parachute flare lights the ground round it for a minute, so a
group can see what is coming at night. Everyone in the valley sees it. Found at military places or made at the
workbench."

## 1. Read the branch

```sh
git fetch origin main
git status --short                      # commit anything left (on this branch, never on main)
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

On `main`? Make a branch first. Then decide three things from the diff:

- **Backend?** Any change under `server/` or `shared/` (shared code runs inside the server's simulation too), a new
  file in `server/db/migrations/`, `railway.json`, or `package.json` dependencies. Yes: write the Risk section.
- **Tuning?** Changed numbers that set how the game plays: timings, damage, health, speeds, ranges, spawn counts and
  weights, loot odds, recipe costs, stamina, prices (`shared/constants.js`, `shared/defs.js`, `shared/nights.js`,
  constants at the top of a module). Yes: write the Metrics table.
- **Big technical refactor?** Mostly moves or rewrites code across many files, with nothing new for players. Yes: the
  overview may be technical (step 4).

## 2. Take the screenshots

Put everything for the PR in `shots/pr/<slug>/` (gitignored), where `<slug>` is the branch name with `/` as `-`.
Name images in kebab-case (`before-inventory.png`, `after-inventory.png`), 1280x720 PNG. A fresh worktree has no
`node_modules`: run `npm install` first, or the tools below cannot load puppeteer or vite.

| What changed | Tool |
|---|---|
| Something in the game: an item in hand, a place, another player, a fight | `npm run clip:game -- <shots.json> [--before <tree>]` (`scripts/clip/game-shots.js`, example in `scripts/clip/game-shots.example.json`): its own server on a free port, a fixed seed, admin `/give` and `/tp`; `--before` composes each pair as one before / after image |
| Hands or held items | `npm run clip:pairs` and the rest of [docs/object-clipping.md](../../../docs/object-clipping.md) |
| A menu, panel, modal or HUD element | `node scripts/shot.js <url> <out.png> [waitMs]`, or a short puppeteer script modelled on the `scripts/e2e-*.js` that drive the UI |

The "before" comes from a worktree of `origin/main`. Link `node_modules`, and when done remove the link on its own
first, so removing the worktree cannot follow it into ours:

```sh
before="$(mktemp -d)/stn-before"
git worktree add --detach "$before" origin/main && ln -s "$PWD/node_modules" "$before/node_modules"
# ... npm run clip:game -- shots.json --before "$before" ...
rm "$before/node_modules" && git worktree remove --force "$before"
```

Use a server of your own on a free port (the tools above do), never one already running on :3000: other sessions
share this machine. Close every browser and server you start.

**Open every image and look at it** before it goes in. It must show the change plainly: no loading screen, black
frame, debug overlay or unrelated HUD clutter. Zoom or crop to a small change (a HUD number, a button). Three to six
images tell most stories; more goes in a collapsed `<details>` block.

## 3. Host the images

Images never go in the code branch. Put them on their own `pr-images-<slug>` branch of the remote this branch is
pushed to (a PR from a fork hosts them in the fork), and link them by raw URL:

```sh
.claude/skills/create-pr/push-images.sh <slug> origin shots/pr/<slug>/*.png
```

It prints one `https://raw.githubusercontent.com/...` URL per image. It never touches the working tree or the current
branch; running it again adds images (a same-named one is replaced). Check each URL answers `200`:
`curl -sI <url> | head -1`.

## 4. Write the body

Write `shots/pr/<slug>/body.md`. Leave out the sections marked "only when"; keep the order.

```markdown
## Overview
<2-4 sentences, or up to 5 short bullets: what changes for players and why.>
<"Closes #N" if it closes an issue.>

## Screenshots
**<caption: what to look at>**
![<what it shows>](<raw url>)

## Metrics                              (only when tuning)
| | Before | After |
|---|---|---|
| Night length | 180 s | 150 s |

<One line on what the change did when measured, and which numbers are guesses nobody has played yet.>

## Risk                                 (only when backend)
**Level: Low | Medium | High.** <one line why>
- **What could go wrong for players:** <the worst realistic case, in plain words>
- **Deploy:** merging redeploys the live server and ends every game in progress. <more, from the list below>
- **How we'd notice:** <what players or the logs would show>
- **Undo:** <revert the merge; say what a revert does not undo>

**Tested:** <one line: what was run or measured, and "not played yet" if nobody has played it>
```

**Metrics.** One row per number a designer would recognise ("Tank health", "Day 1 length"), not per constant. Add
what a run measured where one exists: `node scripts/daytime.js` (time to loot a day), `npm run test:sim`,
`node scripts/worldstats.js <seed>`, `npm run stress` and `npm run bench:net` (server load, network),
`npm run report -- --build <sha>` (real matches since a deploy). Mark first guesses as guesses.

**Risk.** Go through the diff for each of these and name the ones that apply:

- `PROTOCOL_VERSION` changed (`shared/protocol.js`): open tabs cannot rejoin until they reload.
- A new migration in `server/db/migrations/`: it runs on start, and a revert does not undo it.
- Saved data changes shape (accounts, stats, settings): old records must still load.
- New per-tick work (zombies, pathfinding, snapshots): server CPU. One worker thread runs each game, so a slow tick
  lags everyone in that game. Give tick or load numbers if measured.
- Anything that can throw on the network thread or in an HTTP handler: a crash ends every game on the server.
- A new HTTP route or client message: is the input checked?
- A new environment variable: it must be set on Railway before the merge.

Levels: **Low**, one feature's rules on the server and nothing above applies. **Medium**, the per-tick simulation,
networking, the protocol or saved data. **High**, a database migration, accounts or sign-in, a new env var, or
anything that can crash the process.

**Big technical refactor.** The overview may use technical words, still as an overview: why, what moved (by part of
the system, not file by file), what stays the same for players, and how that sameness was shown (tests, identical
before/after shots, load numbers).

**When another guide asks for more** (docs/object-clipping.md wants a panel per fix, a numbers table, "not fixed and
why"), put that after the required sections in `<details><summary>Details</summary> ... </details>`, so the top
stays an overview.

**Title:** plain words, what the player gets, under 80 characters: "Shorter nights: 3 minutes down to 2½",
"Carry the mounted gun to a new spot".

## 5. Open it

```sh
git push -u origin HEAD
gh pr create --base main --title "<title>" --body-file shots/pr/<slug>/body.md
```

Never merge it and never push to `main` yourself: a push to `main` redeploys the live game and ends every game in
progress. Then read the PR back (`gh pr view <n> --json body -q .body`), make sure every image URL in it answers
`200`, and give the PR URL.

## Before you open it

- [ ] Screenshots of the change, looked at, hosted on `pr-images-<slug>`, none committed to the code branch
- [ ] Before / after for anything that already existed
- [ ] Overview in plain words, no code names (unless a big technical refactor)
- [ ] Metrics table if tuning; Risk section if backend
- [ ] The written part fits on one screen
- [ ] "Tested" says what was run, and whether anybody has played it
