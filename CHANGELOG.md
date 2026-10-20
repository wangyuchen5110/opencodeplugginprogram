# Changelog

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
