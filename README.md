# factory-template

Starter for a new project built by the JSM HQ agent team on VM 400, with the [jsmastery-pro/skills](https://github.com/jsmastery-pro/skills) workflow. **Replace this README once the project starts.**

What it holds:
- `.claude/skills/` and `skills-lock.json`: the jsm skills (scope, architect, audit, develop, check, test, document, sync, debug), vendored so every agent has the same version. Refresh with `npx skills add jsmastery-pro/skills -a claude-code -y`.
- `ROLE.md`: how the team works (order of work, questions to Toyin through Slack, Mobbin for UI, PR proof, retries, lead merges, security). JSM HQ loads it into every agent's role.
- `.claude/skills/agent-browser/` and `scripts/agent-browser-setup.sh`: Vercel's agent-browser for checking the running app and capturing PR proof. Each agent runs the setup script once per sandbox. It needs the sandbox network rules for `googlechromelabs.github.io` and `storage.googleapis.com`, which are already allowed globally on VM 400 (`sbx policy allow network <host>`).
- `scripts/pr-proof.sh`: publishes proof screenshots and videos to the `pr-assets` branch and prints the Markdown for the PR.
- `.coderabbit.yaml`: CodeRabbit review, skipping the vendored skills.
- No `AGENTS.md` or `CLAUDE.md` on purpose: `/audit` writes root `AGENTS.md` and its `CLAUDE.md` pointer once the stack is scaffolded, after asking the coding standards. Nested ones come from `/audit` and `/sync`.

## Start a new project

1. On GitHub: **Use this template** → owner `toyin-software-factory`, public (the free plan only enforces rulesets on public repos).
2. Fill in **The project** in `ROLE.md` and commit.
3. Add the `protect-main` ruleset (copy it from an existing factory repo). Add required checks once the scaffold task has added CI.
4. On VM 400, as `hq`:
   ```
   cd ~/src && gh repo clone toyin-software-factory/<name>
   nano ~/.config/jsm-hq.env      # HQ_REPO=/home/hq/src/<name>
   nano ~/.config/hq-slack.env    # HQ_REPO and GITHUB_REPO for the new project
   systemctl --user restart jsm-hq hq-slack && hq-url
   ```
   HQ runs one project at a time on port 7420.
5. In HQ (through the SSH tunnel): set up the team, then
   - Settings → Workflow: review CodeRabbit, **Merge = lead**.
   - Settings → MCP: Mobbin for the frontend agents (OAuth callback needs its port tunnelled too).
   - Sandbox memory: about 2 GB for the lead, 3 GB per builder.
   - Start team. Each agent signs in with **Claude account with subscription** (check with `/status`: "Claude Max account").
6. Send the lead:
   > Read ROLE.md. Run /scope with Toyin for this project. Ask every question with ask_user, one at a time, never in the terminal. When Toyin approves the scope, run /architect for the stack, then create a board for the scaffold task and assign it.
