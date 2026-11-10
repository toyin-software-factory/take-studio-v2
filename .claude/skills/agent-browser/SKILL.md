---
name: agent-browser
description: Drive a real headless Chrome with Vercel's agent-browser CLI to check a running app against its acceptance criteria, reproduce UI bugs, and capture screenshots or a short video as PR proof. Use during /check verify and for every PR that changes something visible.
---

# agent-browser

[vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) is a browser automation CLI built for AI agents.

## Setup (once per sandbox)

If `agent-browser` is not on your PATH, run `bash scripts/agent-browser-setup.sh`. It installs Node 22, agent-browser (pinned version), Chrome for Testing with its libraries, and ffmpeg, then runs a smoke test. It lasts until your sandbox is recreated. If a download is blocked by the sandbox, call `request_access` for that domain and wait; never work around the block.

Never upgrade or reinstall agent-browser any other way (`npm i -g`, `npx`, `agent-browser upgrade`). The version changes only through a PR to the setup script.

## Use

- Load the real usage guide first, every run: `agent-browser skills get core` (add `--full` for every command). It always matches the installed version.
- Use your own session: `agent-browser --session <your-name>-<task-id> ...`, and `close` it when done.
- Never type real credentials or personal data into pages, and never capture them. Use test data only.

Typical loop:
1. Start the app's dev server (see `AGENTS.md`) and note the port.
2. `agent-browser --session <s> open localhost:<port>/<path>`
3. `agent-browser --session <s> snapshot -i` for interactive elements with `@eN` refs, then act on them (`click @e3`, `fill @e5 "text"`).
4. Check each acceptance criterion in the spec. Read console errors when something fails.

## Proof for the PR

- Screenshots of every changed screen at desktop (1440 wide) and phone (390 wide): set the viewport (the exact command is in `agent-browser skills get core`), then `screenshot ./proof/<name>-desktop.png` and `./proof/<name>-mobile.png` (`--full` for a full page).
- A short video when the change is a flow (a form, navigation, an animation): `record start ./proof/<name>.webm <url>`, do the steps, `record stop`. Keep it under about 30 seconds.
- Publish them with `bash scripts/pr-proof.sh <TASK-ID> proof/*`. It puts the files on the `pr-assets` branch (never in your PR's diff), makes a GIF preview of each video, and prints the Markdown. Paste that under `## Proof` in the PR body, with one line per acceptance criterion saying which image or video shows it.
- Delete `./proof/` afterwards; it is never committed.
