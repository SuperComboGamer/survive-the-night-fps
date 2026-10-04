# Survive The Night

Before you build or change a model, a hand pose, anything a survivor holds or wears, a ground pickup or a prop's placement, read and follow [docs/clippy.md](docs/clippy.md) so nothing clips.

Any headless browser must go through `scripts/clip/lib.js`'s launcher (`launchChrome`); never launch Chrome, puppeteer or any other browser yourself.
On 2026-10-04 an agent locked a user out of their Windows account: 40 seconds after it starts on a new profile, Chromium signs in to Windows with an empty password to learn whether the password is blank (`CheckBlankPasswordWithPrefs`), so every throwaway profile was a failed sign-in.
`launchChrome` writes the answer into the profile's `Local State` first, refuses to launch when the account's failed sign-in counter is 4 or more, and stops everything if the counter rises while a browser is up (then stop too, and tell the user).
One browser at a time, software rendering by default, nothing that takes the screen, the keyboard or the mouse: see docs/object-clipping.md, "The headless browser's rules".

The codebase is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

To open a pull request, follow [.claude/skills/create-pr/SKILL.md](.claude/skills/create-pr/SKILL.md): a short overview for a
non-technical reader, screenshots of the change, a Risk section for server changes and a metrics table for tuning.
