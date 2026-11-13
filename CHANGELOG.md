# Changelog

## 0.9.7

- The audit talks in the chat. OpenCode 2 posts one synthetic notice per session (a timeline row, not a system-prompt aside). `/skills-doctor` posts the same notice. The tool, MCP server and 1.x command return that short briefing.
- HTML reports are gone: no `check --html`, no `--open`, no plugin or MCP `html` argument, no `/skills-report`, no Action artifact. `uninstall` still removes a previously generated `skills-report` command.
- Nothing is written until you confirm an archive or a hide.
- Tests: 73.

## 0.9.6

- Token estimate is a word-piece count: a short English word is 1 token, each CJK character is 1, longer words add one token per four extra characters. `hello` is no longer counted as 2.
- Near-duplicate detection ignores boilerplate ("use this skill when the user wants…") and also flags a shorter trigger that is contained in a longer one. The finding names the overlapping words.
- `plan` keeps the first routing sentence instead of a 160-character slice, and hides the redundant skill before a unique one when the budget is short.
- Tests: 73.

## 0.9.5

- `fix --hide` keeps the skill file's original line endings. A CRLF `SKILL.md` is no longer rewritten as LF.
- Hiding a skill writes the file via a temp file and replace, so a crash mid-write does not leave a truncated `SKILL.md`. On Windows, where rename cannot replace an existing file, it falls back to a copy.
- Token estimates no longer allocate a match array per string, and the per-step description cost is computed once during scan (`stepTokens`) and reused by `check`, `plan` and the summary.
- Reference checks cache `exists` results for the duration of one audit.
- Tests: 71.

## 0.9.4

- GitHub Marketplace readiness: tighter `action.yml` name/description (97 chars,
  Marketplace-friendly), branded icon/colour, and a README input/output table for
  the CI integration.
- Docs: the action example pins `@v0.9.4`; no runtime code changes.
- Listed on the GitHub Marketplace: https://github.com/marketplace/actions/skills-doctor
- Tests: 70.

## 0.9.3

- Bug fix: `detectDesktop({ platform })` used the **host** platform when locating
  `app.asar`, so probing the Windows layout on macOS looked in `Resources/`
  instead of `resources/`. `asarPathFor()` now takes the requested platform.
- CI: the macOS jobs had been red for a long time because of that test
  (Ubuntu and Windows passed). The suite is green on all three platforms now.
- CI: macOS failures are printed as check annotations, so the failing test is
  visible without downloading the job log.
- `scripts/action-summary.mjs` and `action.yml` from 0.9.2 are unchanged.
- Tests: 70.

## 0.9.2

- GitHub Action (`action.yml`): composite action with `budget`, `fail-on`
  (`error` / `warn` / `never`), `extra-args`, `html` + artifact upload, an
  optional pull request comment, a job summary, and outputs (`exit-code`,
  `error-count`, `warning-count`, `advertised-tokens`). It runs the checked-out
  repository directly - no install step, no runtime dependencies.
- `scripts/action-summary.mjs`: renders the JSON report as GitHub-flavoured
  markdown and decides the gate; covered by tests.
- CI: a self-test job runs the action against a clean fixture (must pass) and an
  over-budget fixture (must fail), asserting the outputs.
- Removed a stale nested copy of the old repository layout from the working tree.
- Tests: 70.

## 0.9.1

Bug fixes from a full review:

- A `SKILL.md` saved with a UTF-8 BOM was treated as having no frontmatter (silent `missing-description`, the skill vanished from the model-facing list). The BOM is now stripped before parsing; `bytes` still reflects the real file size.
- JSONC parsing corrupted string values containing `,}` or `,]` while removing trailing commas. Trailing-comma removal is now character-based and string-aware.
- `update` no longer downgrades a lock written by a newer version: it refuses to rewrite it and reports an error instead.
- Catalog entries with an unsafe `name` (`../x`, `a/b`, absolute paths) could write **outside** the target directory. `name` must now be one plain path segment, and unsafe names coming from an old/tampered lock are never used for pruning.
- `install` no longer silently overwrites a config-dir `package.json` it cannot parse; it reports an error and leaves the file untouched.
- Tests: 68.

## 0.9.0

- Discovery: DeepSeek Harness skill roots are now scanned - `$DSH_HOME/skills` (default `~/.dsh/skills`) and project `.dsh/skills`. `install --client dsh` used to install a skill the auditor could never see.
- `auditSkills({ home, env })` passes through to discovery, so wrappers and tests can audit an isolated agent home instead of the real one.
- Performance: near-duplicate description detection now sorts by token-set size and exits at the Jaccard upper bound instead of testing every pair. On the uniform-size benchmark (`npm run bench`, 1,000 skills) that is ~248 ms -> ~220 ms; descriptions of varying length skip far more pairs.
- Tool descriptions (`mcp`, both plugin entries) now list every supported agent - OpenCode, Claude Code, Grok, Cursor, Hermes, Kimi, DSH - and stay short enough to keep the tool schema cheap.
- Docs: discovery list, DSH root, and a pointer to the OpenClaw wrapper.
- Docs: privacy statement in the READMEs and both SECURITY files - runs 100% locally, no telemetry, does not read chats/sessions/credentials, uploads nothing; the only optional network calls are `update` (your catalogs) and the npm version check (disableable).
- Docs: landing-page refresh - centered banner hero, `for-the-badge` shields, local-only/no-telemetry/no-user-data badges, contents list, and a Mermaid pipeline diagram; the Chinese page mirrors it.
- Tests: 63.

## 0.8.1

- `--extra-dir <dir>` (repeatable) scans additional skill roots; `auditSkills({ extraDirs })` exposes the same option for wrappers.
- Package exports `./cli` so downstream clients can reuse the full CLI.
- Tests: 61.

## 0.8.0

- Kimi Code support: scan `~/.kimi-code/skills` and project `.kimi-code/skills`; `install --client kimi` merges the MCP entry into `~/.kimi-code/mcp.json` and installs the audit skill; `uninstall --client kimi`; `--kimi-home`.
- Docs: Kimi Code section in both READMEs.
- Tests: 60.

## 0.7.0

- Discovery: scan Hermes Agent skill roots (`~/.hermes/skills`, project `.hermes/skills`), including imported skills.
- Docs: Hermes MCP setup (`~/.hermes/config.yaml`, tool `mcp_skills_doctor_skills_doctor`) and the platform matrix.

## 0.6.3

- Docs: document the verified Grok CLI MCP setup (`grok mcp add skills-doctor -- npx -y opencode-skills-doctor mcp`, `grok mcp doctor`) and the `skills_doctor__skills_doctor` tool name.
- Docs: document `codex mcp add` and the verified `codex mcp list` state.

## 0.6.2

- Docs: new landing-page README with a banner, badges, HTML-report screenshot, quick start, integrations and a command table; the previous detailed README moved to `docs/REFERENCE.md`.
- Docs: added `docs/assets/banner.svg`, `docs/assets/report.png` and `docs/assets/social-preview.png`; Chinese README gets the banner too.

## 0.6.1

- DSH: fix the patch format — new entries must be wrapped in `- insert:`; the previous bare row was treated as an unknown-id patch and skipped by app-boot. `install --client dsh` now writes the correct block and migrates legacy bare rows in place.
- Docs: corrected the manual DSH patch example in both READMEs.
- Tests: 58.

## 0.6.0

- DSH: `install --client dsh` is now a one-command setup — detects the DSH profile, appends the `mcp-skills-doctor` entry to `cordis.patch.yml` idempotently, and installs the `skills-doctor-audit` skill into `~/.dsh/skills/`.
- DSH: `uninstall --client dsh` removes the patch entry and generated skill; `--profile` and `--dsh-home` supported.
- Tests: 57.

## 0.5.2

- DSH: ship an optional `skills-doctor-audit` skill under `skills/dsh-skills-doctor/` that teaches the model when to audit and how to interpret `check`/`plan`.
- Docs: DSH section now documents the tool arguments and the skill install step.

## 0.5.1

- OpenCode Desktop support: `install --client auto|opencode|desktop` detects the desktop app in standard locations, reads its bundled core version from `resources/app.asar`, and wires the shared config directory.
- Desktop and CLI share `~/.config/opencode`, so one install covers both; `uninstall --client desktop` reverses it.
- Tests: 55.

## 0.5.0

- `plan` command: exact token-savings model — trim descriptions to a sentence-boundary target, hide the minimal number of skills to reach the budget, no double counting, projected over N model steps; `--json`.
- `check` prints a potential-savings hint when over budget; HTML report adds a potential-savings card and plan line.
- Tests: 53.

## 0.4.2

- Docs: refresh test counts (50), sample output version, roadmap, and the installer/plugin command lists; no code changes.

## 0.4.1

- Self-update: `upgrade` command checks npm for a newer skills-doctor; `--apply` runs `npm install -g`, `--open` opens the GitHub release page.
- Automatic daily update check (cached 24h, skipped in CI/non-TTY/`--json`); opt out with `"checkUpdates": "off"`, `SKILLS_DOCTOR_UPDATE_CHECK=0` or `--no-update-check`; `"open"` also opens the release page.
- Plugin: injects the update notice once per session; new `/skills-upgrade` command (1.x gets a generated `skills-upgrade.md`).
- Tests: 50.

## 0.4.0

- Rules: `broken-reference` (missing `references/`, `scripts/`, `assets/`, `templates/`, `examples/` files), `reference-outside-skill`, `invalid-frontmatter` (unclosed fence / wrong types), `empty-body`.
- Reports: `check --html [file]` writes a self-contained HTML report (summary cards, budget bar, filterable findings, skill table); `--open` launches it.
- Plugin/MCP: `skills_doctor` tool accepts `html` (target path); OpenCode 1.x gets a generated `/skills-report` command, 2.x gets a `skills-report` command.
- Compatibility: scans Grok CLI skill locations (`.grok/skills`, `~/.grok/skills`) and Cursor locations (`.cursor/skills`, `~/.cursor/skills`).
- Tests: 49.

## 0.3.15

- Uninstall now also recognizes a hand-written re-export (`export { SkillsDoctorPlugin } from "opencode-skills-doctor/v1"`) as a generated plugin entry, so `uninstall` cleans it up.
- Tests: 43.

## 0.3.14

- Added `uninstall` command: reverses `install` for OpenCode 1.x/2.x (removes config entry, generated plugin entry and command file, optionally uninstalls the package).
- Uninstall only deletes files generated by the installer; user-edited files are kept and reported.
- Tests: 43.

## 0.3.13

- Docs: clarify that 1.x plugins cannot register slash commands and that `install` generates a markdown command instead.
- Docs: refresh the sample output version.

## 0.3.12

- Docs: expanded the GitHub README with an at-a-glance table, measured token costs, how-it-works pipelines, FAQ/troubleshooting, contributing guide and project layout.
- Docs: mirrored all new sections in the Chinese README.
- Docs: added npm/downloads/node/license badges and links to the changelog and security policy.

## 0.3.11

- Added `install` command: one-command OpenCode integration for 1.x/2.x (detects version, backs up config, writes plugin entry, generates the 1.x `/skills-doctor` command).
- Plugins now inject a one-time system-prompt warning when the skill description budget is exceeded (V1 `experimental.chat.system.transform`, V2 `session.hook("context")`).
- Tests: 41.

## 0.3.10

- Performance: near-duplicate description check now computes token sets once and prefilters pairs by a Jaccard upper bound.
- Reliability: catalog downloads retry on 5xx/network errors (3 attempts, exponential backoff).
- Reliability: skill files and the lockfile are written atomically (temp file + rename).
- Docs: npm now shows the English README; the Chinese README lives in `docs/README.zh-CN.md`.
- Dev: `npm run bench` reports lint timing for 100/500/1000 skills.

## 0.3.9

- Security: added `SECURITY.md` and `SECURITY.zh-CN.md` (threat model, hardening checklist, private reporting).
- Docs: security summary in both READMEs.

## 0.3.8

- Docs: DeepSeek Harness (DSH) MCP setup.

## 0.3.7

- Update: removes files that the new skill version no longer lists; cleans empty directories.
- Update: `--prune` deletes skills that disappeared from a catalog (reported but kept by default).
- Tests: 36.

## 0.3.6

- Added `skills-doctor mcp`: MCP stdio server exposing the `skills_doctor` tool (Claude Code, Codex, DSH, any MCP client).
- Docs: MCP client setup for Claude Code and Codex.

## 0.3.5

- Republish of 0.3.4 (npm staged-publishing queue).

## 0.3.4

- Docs: value proposition and caveats in both languages; package description updated.

## 0.3.3

- Added `exports["./server"]` for the OpenCode 1.x plugin loader.

## 0.3.2

- Added OpenCode 1.x plugin entry (`src/plugin-v1.mjs`, `exports["./v1"]`).

## 0.3.1

- Compat: reads OpenCode 1.x `skills.paths` configuration.
- Fix: `fix` defaults to project-only; `--all` for global sources.

## 0.3.0

- `fix` command (archive shadowed definitions, `--hide`), `.skills-doctor.json` config, rule overrides and ignore list.
- OpenCode 2.x plugin (`Plugin.define`, `skills_doctor` tool, `/skills-doctor` command).
- Bilingual CLI output (`--lang en|zh`) and bilingual docs.

## 0.2.0

- `fix` (archive shadowed), `--lang`, CI badge, CI matrix.

## 0.1.0

- Initial release: `check`, `scan`, `update`, rule engine, token budget, lockfile, tests.
