---
name: clippy
description: Build or change a Survive The Night model so nothing clips. Covers first-person hands and held items, hand poses, reload, swing and throw moves, third-person holds, worn gear, ground pickups, props, and where the world places them. Use before writing or editing anything in client/render/models/, HAND_POSES or VM in weapons.js, shared/props.js, or prop placement in shared/world.js, shared/rail.js and the place files (clinic, cemetery, fair, mine). Also use when asked about clipping, hands through guns, or items sunk into the ground.
---

# Clippy

1. **Read [docs/clippy.md](../../../docs/clippy.md) now, before writing any code.** It has the build rules: real scale,
   weapon, hand and prop space, closed outward-facing shells, a fitted pose for every hand, third-person holds,
   pickups and placement. If you are fixing a clip that is already there, or presenting a clipping PR, also read
   [docs/object-clipping.md](../../../docs/object-clipping.md).
2. **Take a baseline first** if the change touches anything shared (a hand pose, grip, elbow pole, reload branch, hold
   category or placement rule):
   `npm run clip:survey -- --save-baseline shots/clip/base-before.json`.
3. **Build by the rules.** For each new hand on an item, start from the nearest shared pose, then run
   `npm run clip:fit -- <item> [--side L] [--act reload --t <s>]`. Paste the printed pose into `HAND_POSES` under a
   new name and point the item's `VM` entry at it. Never tune a shared pose to fit one item, and never pose by eye.
4. **Measure** what you touched:
   - held items: `npm run clip:survey -- --item <name>`
   - after a shared change: `npm run clip:survey -- --baseline shots/clip/base-before.json`
   - ground items: `npm run clip:pickups`
   - props and placement: `npm run clip:props -- --seeds 1-100`
5. **Look** at the worst frames in the sandbox with `&clip=1&dots=1&xray=1` and an outside camera (`&oh=`, `&orbit=`).
   The numbers find candidates and your eyes decide.
6. **Run `npm test`.**
7. **Report** each item's worst depth in mm, the frames over 3 mm and over 8 mm (before and after), and why any clip is
   left over 3 mm.

Hard rules: never shrink, scale or hide an item to hide a clip. No version bumps. The clip tools stay headless (no
visible browser, no cursor lock) and stop everything they start.
