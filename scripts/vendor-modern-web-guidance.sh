#!/usr/bin/env bash
# Vendors Google's Modern Web Guidance skill (https://github.com/GoogleChrome/modern-web-guidance)
# into .claude/skills/modern-web-guidance so agents can search and retrieve its guides offline,
# without npx or registry access in the sandbox.
#
#   scripts/vendor-modern-web-guidance.sh [version]   # default: the pinned VERSION below
#
# It downloads the npm package, copies skills/modern-web-guidance, and rewrites the skill's
# `npx -y modern-web-guidance@latest` commands to run the vendored CLI with telemetry off.
# Run it from the repo root on a machine with npm access, review the diff, and commit.
set -euo pipefail

VERSION="${1:-1.0.0}"
DEST=".claude/skills/modern-web-guidance"
CLI='DISABLE_TELEMETRY=1 node "$(git rev-parse --show-toplevel)/.claude/skills/modern-web-guidance/modern-web.mjs"'

[ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ] || { echo "Run from the repo root." >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm pack --silent "modern-web-guidance@${VERSION}" >/dev/null && tar xzf ./*.tgz)

src="$tmp/package/skills/modern-web-guidance"
[ -f "$src/SKILL.md" ] && [ -f "$src/modern-web.mjs" ] || { echo "Unexpected package layout." >&2; exit 1; }

rm -f "$src/search.mjs.map"

# Adapt the downloaded copy first, so a failed rewrite leaves the installed skill untouched.
CLI="$CLI" python3 - "$src/SKILL.md" <<'PY'
import os, sys
path, cli = sys.argv[1], os.environ["CLI"]
text = open(path, encoding="utf-8").read()
for old in ("npx -y modern-web-guidance@latest", "pnpx modern-web-guidance@latest"):
    text = text.replace(old, cli)
note = (
    "\n> **Vendored copy.** This project runs the CLI from this folder (no npx, no network), with "
    "telemetry off (`DISABLE_TELEMETRY=1`). Where this file mentions `npx`, `pnpx` or network "
    "access, use the command shown in the steps instead. Refresh with "
    "`scripts/vendor-modern-web-guidance.sh`.\n"
)
marker = "# Modern Web Guidance\n"
if marker not in text:
    sys.exit("SKILL.md heading not found")
text = text.replace(marker, marker + note, 1)
text = text.replace("directly with `npx` using", "with the vendored CLI using")
start = text.find("## Using npx / pnpx")
end = text.find("\n## ", start + 1)
if start < 0 or end < 0:
    sys.exit("SKILL.md npx section not found")
text = text[:start] + (
    "## Running the vendored CLI\n\n"
    "- Run it exactly as shown above, from anywhere in the repo. It needs Node 22 or newer and no network.\n"
    "- Keep `DISABLE_TELEMETRY=1`: without it the CLI sends your search queries to Google.\n"
    "- Never run `npx modern-web-guidance` or its `install`/`update` commands here; refreshing the copy is a separate task (`scripts/vendor-modern-web-guidance.sh`).\n"
) + text[end:]
if "@latest" in text:
    sys.exit("SKILL.md still has an npx @latest command")
open(path, "w", encoding="utf-8").write(text)
PY

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$src/." "$DEST/"

echo "Vendored modern-web-guidance@${VERSION} ($(cat "$DEST/skill-version.txt")) into $DEST"
