# skills-doctor

[![npm](https://img.shields.io/npm/v/opencode-skills-doctor)](https://www.npmjs.com/package/opencode-skills-doctor)
[![downloads](https://img.shields.io/npm/dw/opencode-skills-doctor)](https://www.npmjs.com/package/opencode-skills-doctor)
[![node](https://img.shields.io/node/v/opencode-skills-doctor)](https://www.npmjs.com/package/opencode-skills-doctor)
[![license](https://img.shields.io/npm/l/opencode-skills-doctor)](LICENSE)
[![test](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml/badge.svg)](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml)

Local scanner, linter, fixer, updater and **OpenCode plugin** for agent skills — zero dependencies, Node ≥ 20.

**English** | [简体中文](docs/README.zh-CN.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

## At a glance

| | |
|---|---|
| **What it is** | Audit, fix and update the skills your coding agent loads |
| **Interfaces** | CLI · OpenCode plugin (1.x / 2.x) · MCP server (Claude Code, Codex, DSH, …) · Grok CLI compatible |
| **Skill sources** | `.opencode/skills`, `.claude/skills`, `.agents/skills`, `.grok/skills`, `.cursor/skills`, `opencode.json(c)` entries, HTTP catalogs |
| **What it finds** | shadowed IDs, duplicates, long descriptions, oversized bodies, per-step token budget, broken file references, invalid frontmatter, empty bodies, stale skills |
| **What it fixes** | archives shadowed definitions (reversible), hides low-frequency skills, syncs catalogs with drift detection |
| **Reports** | terminal, JSON, or a self-contained HTML report (`--html [file] --open`) |
| **Cost** | CLI: 0 tokens. Plugin: ~191 tokens/step for the tool definition, plus a one-time warning per session |
| **Requirements** | Node ≥ 20, zero runtime dependencies |
| **Quality** | 50 tests, CI on ubuntu/macos/windows × Node 20/22/24 |

## Why

On every model step, OpenCode advertises every skill that has a `description` — the model sees `ID + name + description` for each of them. Skills are not free: they are a permanent context tax on every request.

**What this costs.** 29 skills with long descriptions ≈ **3,000+ tokens every step**. Over a 100-step session that is ~300k tokens of pure overhead — spent before the model reads a single line of your code. And that is only 29 skills: many users have far more they downloaded without noticing, some already out of date. This tool helps you understand your skill repository much better.

**What can go wrong.** As skills pile up:
- duplicate IDs silently shadow each other — you may be editing a file that never loads;
- descriptions drift until the model picks the wrong skill;
- half the catalog is dead weight nobody noticed.

**What `skills-doctor` does.** It measures the cost, shows which definition actually wins, and fixes it:

- `check` — report duplicates/shadowing, long descriptions, oversized bodies and the per-step token budget, with fix hints;
- `scan` — list every skill with its source, precedence and cost;
- `fix` — archive shadowed duplicates (reversible) or hide low-frequency skills (`autoinvoke: false`, still loadable with `@id`);
- `update` — sync skills from HTTP catalogs by version, with a lockfile and drift detection;
- plugin — expose the audit as a `skills_doctor` tool / `/skills-doctor` command inside OpenCode.

Works as a CLI and a plugin on **OpenCode 1.x and 2.x**.

## Quick start

```powershell
# Run straight from the repo (no install)
node bin/skills-doctor.mjs check

# Or install it locally
npm link
skills-doctor check
```

What a run looks like:

```text
skills-doctor 0.4.1
  sources: 5 (2 exist)  definitions: 29  unique IDs: 29  advertised: 29  description budget: ~3074 tokens

[E] token-budget   Advertised skill descriptions cost about 3074 tokens per model step, over 2x the 1200 budget
[W] long-description  "deep-research" description is 917 chars; it is paid on every model step
[W] large-body     "academic-paper" body is about 9980 tokens; invoking it pastes the whole body into context
...

1 error, 18 warn, 0 info

Hints:
  - Trim descriptions, or hide low-frequency skills with metadata.opencode/autoinvoke: false.
  - Move details into references/ and keep SKILL.md to the workflow.
```

## Commands

All commands accept `--lang en|zh` (default: auto from the system locale) and `--json`.

### `check` (default)

Scans every skill source, reports problems, the context budget and fix hints.

```powershell
skills-doctor check
skills-doctor check --json
skills-doctor check --budget 800 --strict    # for CI
skills-doctor check --root .\some-project --no-global
skills-doctor check --html report.html       # self-contained HTML report
skills-doctor check --html report.html --open
```

### HTML report

`--html [file]` writes a single self-contained HTML file (no external assets):

- summary cards and a context-budget bar;
- findings filterable by severity and text;
- a skill table with scope, token cost, description preview and file path;
- default path `./skills-report.html` when `--html` is given without a value; `--open` launches the browser.

The plugin and MCP tool accept the same thing as an `html` argument, so the agent can ask you where to save it — for example: *"save the report to D:\reports\skills.html"*.

### `scan`

Lists every skill with its source, precedence, whether the model can see it, and token cost.

```powershell
skills-doctor scan
```

`*` marks the definition that actually wins (later registration = higher precedence).

### `fix`

Archives definitions that are shadowed — files that never load because another source defines the same ID. The move is reversible: files go into `.skills-doctor-archive/<timestamp>/` inside the same source, which OpenCode ignores (dot-directory).

```powershell
skills-doctor fix --dry-run   # preview what would be archived
skills-doctor fix
skills-doctor fix --hide academic-paper,deep-research --dry-run   # hide low-frequency skills
```

- Only shadowed duplicates are touched; the effective definition is never moved;
- Files installed by `update` are skipped — use `update` to bring them back;
- Default scope is project-only; pass `--all` to also archive global sources;
- After fixing, `check` should report no `shadowed` findings.

### `update` (updater)

Reads HTTP catalogs from the `skills` array in `opencode.json(c)`, compares `version`, and downloads whatever changed.

```powershell
skills-doctor update                 # installs into .opencode/skills by default (where opencode reads)
skills-doctor update --check-only    # only report available updates
skills-doctor update --into .\team-skills
```

- The output directory is a real OpenCode skill directory, so **`check` picks the update up immediately**;
- Overwrites files in place and **deletes files that the new version no longer lists** (no stale leftovers from the old version);
- Writes `.skills-doctor.lock.json` (schema v2: a sha1 for every file);
- `check` reads that lock: shows managed versions, detects hand edits (`managed-drift`) and missing files (`managed-missing`);
- Running `update` again re-downloads drifted files (self-healing);
- Use `--prune` to delete skills that disappeared from the catalog (by default they are reported but kept).

## Does the plugin cost tokens?

Local execution is free, but any tool registered with the model is visible on every request. Measured on this repo:

| Component | Tokens | When |
|---|---|---|
| Scan / lint / fix / update (local work) | **0** | always |
| `skills_doctor` tool definition | **~191** | every request |
| Budget warning injected into the system prompt | **~60–80** | once per session, only when over budget |
| Audit report returned by the tool | **~940** | only when the tool is actually called |

So the plugin trades a small fixed overhead for the agent being able to audit by itself. In the example above the skill descriptions cost 3,074 tokens per step; dropping that to the 1,200 budget saves more than 10× the plugin overhead. If you want **zero** context cost, don't install the plugin — run `npx opencode-skills-doctor check` from the terminal or CI instead.

## Self-update

`skills-doctor` checks npm for a newer version of itself at most once per 24 hours (skipped in CI, non-TTY and `--json` runs):

```powershell
skills-doctor upgrade            # check now
skills-doctor upgrade --open     # check and open the GitHub release page
skills-doctor upgrade --apply    # npm install -g opencode-skills-doctor@latest
```

Opt out permanently in `.skills-doctor.json`:

```json
{ "checkUpdates": "off" }
```

| Value | Behavior |
|---|---|
| `"notify"` (default) | print a one-line notice when a newer version exists |
| `"open"` | same, plus opens the release page in the browser |
| `"off"` | never check |

Per run: `--no-update-check`. Per environment: `SKILLS_DOCTOR_UPDATE_CHECK=0`. The plugin injects the same notice into the system prompt once per session when an update exists. Cached state lives in `~/.skills-doctor/self-update.json`.

## Configuration

Optional `.skills-doctor.json` in the working directory (or pass `--config <file>`):

```json
{
  "budget": 1200,
  "staleDays": 180,
  "lang": "en",
  "checkUpdates": "notify",
  "rules": { "long-description": "off", "hidden-skill": "info" },
  "ignore": ["legacy-skill"]
}
```

`rules` accepts `off`, `info`, `warn` or `error`; `ignore` drops findings that only involve those IDs; `checkUpdates` is `notify` / `open` / `off`. CLI flags override the file.

## OpenCode plugin

The package also exports an OpenCode 2.x plugin:

```jsonc
// opencode.jsonc
{
  "plugins": ["opencode-skills-doctor"]
}
```

It registers:

- the `skills_doctor` tool (namespace `skills`) — the agent can audit with `{ directory?, budget?, html? }` and gets a markdown report;
- the `/skills-doctor` command — asks the agent to run the audit and summarize fixes;
- `/skills-report` — asks where to save an HTML report, then writes it;
- `/skills-upgrade` — checks whether skills-doctor itself has a newer version.

`@opencode/plugin` is an optional peer dependency; OpenCode provides it at runtime.

### OpenCode 1.x

1.x uses a different plugin API: it resolves the `./server` export for npm plugins and needs `@opencode-ai/plugin` at runtime. The reliable setup is a one-line local plugin file.

1. Install the package where OpenCode resolves plugins:

```powershell
npm i --prefix ~/.config/opencode opencode-skills-doctor
```

2. Create `~/.config/opencode/plugins/skills-doctor.js`:

```js
export { SkillsDoctorPlugin } from "opencode-skills-doctor/v1"
```

3. Reference it from `opencode.json` (1.x uses `plugin`, not `plugins`):

```jsonc
{
  "plugin": ["C:\\Users\\<you>\\.config\\opencode\\plugins\\skills-doctor.js"]
}
```

It registers the same `skills_doctor` tool. 1.x plugins cannot register commands, so `skills-doctor install` writes a `/skills-doctor` markdown command.

> The package root entry is the V2 plugin and requires OpenCode 2.x. The CLI works on both lines.

### Deep integration (one command)

```powershell
npx opencode-skills-doctor install
```

The installer detects your OpenCode version and wires everything up:

- **2.x** — adds `"plugins": ["opencode-skills-doctor"]` to `opencode.json(c)`;
- **1.x** — installs the package into `~/.config/opencode`, writes the local plugin entry, generates `/skills-doctor`, `/skills-report` and `/skills-upgrade` markdown commands, sets `"type": "module"`;
- backs up the config file as `<config>.bak-<timestamp>` before editing.

Use `--dry-run` to preview, `--config-dir <dir>` for a custom config location, and `--no-npm` to skip the package install.

Once installed you get:

- the `skills_doctor` tool (with an optional `html` argument to write a report to a path you choose);
- the `/skills-doctor` command (1.x: generated markdown command; 2.x: plugin command);
- the `/skills-report` command (2.x) that asks where to save the HTML report;
- the `/skills-upgrade` command (2.x) that checks for a newer skills-doctor;
- a one-time system-prompt warning when the skill description budget is exceeded.

### Uninstall

```powershell
npx opencode-skills-doctor uninstall
```

- **2.x** — removes `opencode-skills-doctor` from `plugins`;
- **1.x** — removes the config entry, deletes the generated plugin entry and `/skills-doctor` command, and uninstalls the package (`--no-npm` skips that);
- only files generated by the installer are deleted — anything you edited is kept and reported;
- config files are backed up before editing; `--dry-run` previews, `--config-dir` targets a custom location.

Your data is never touched: `.skills-doctor.json`, `.skills-doctor.lock.json` and `.skills-doctor-archive/` stay until you delete them. MCP entries in other clients (Claude Code, Codex, DSH) are per-client configs and must be removed there.

## MCP server (Claude Code, Codex, Kimi Code, any MCP client)

`skills-doctor mcp` speaks the Model Context Protocol over stdio and exposes one tool: `skills_doctor` with arguments `directory?`, `budget?`, `lang?` and `global?`. It does not need OpenCode installed.

Claude Code (`.mcp.json` in the project, or your MCP config):

```json
{
  "mcpServers": {
    "skills-doctor": { "command": "npx", "args": ["-y", "opencode-skills-doctor", "mcp"] }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.skills-doctor]
command = "npx"
args = ["-y", "opencode-skills-doctor", "mcp"]
```

Any other MCP client: run `npx -y opencode-skills-doctor mcp` and allow the `skills_doctor` tool.

It scans `.opencode/skills`, `.claude/skills` and `.agents/skills` (project and global), so it can audit skills used by other agents too.

### DeepSeek Harness (DSH)

DSH ships an MCP client bundle (`@deepseek-ai/dsh-mcp-client`). Add one entry to your profile patch, e.g. `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: mcp-skills-doctor
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: skills_doctor
    transport: stdio
    command: npx
    args: ["-y", "opencode-skills-doctor", "mcp"]
```

Restart DSH. The tool shows up as `mcp__skills_doctor__skills_doctor`.

On Windows, if the stdio spawn cannot resolve `npx`, use `command: cmd` and `args: ["/c", "npx", "-y", "opencode-skills-doctor", "mcp"]`.

## How it works

**Audit pipeline**

1. Discover every skill source (see the precedence list below).
2. Parse each `SKILL.md` / flat `.md` frontmatter and estimate its description/body cost.
3. Resolve which definition wins for each ID (later registration wins; `SKILL.md` directory form wins ties).
4. Run the rules, compute the per-step token budget, and emit findings with fix hints.

**Fix pipeline**

`fix` only touches definitions that are shadowed (never loaded): it moves them into `.skills-doctor-archive/<timestamp>/` inside the same source. The effective definition is never moved, and files managed by `update` are skipped. Scope defaults to the project; `--all` extends it to global sources.

**Update pipeline**

1. Fetch `<catalog>/index.json` (3 attempts with backoff on 5xx/network errors).
2. Compare each skill's `version` with the lockfile.
3. Download changed files (same-origin only, path traversal blocked) and write them atomically.
4. Delete files the new version no longer lists, and clean empty directories.
5. Verify hashes, write the lockfile, and — with `--prune` — delete skills removed from the catalog.

`check` reads the lockfile and reports drift (`managed-drift`), missing files (`managed-missing`) and unknown lock versions (`lock-version-unsupported`). Re-running `update` re-downloads drifted files.

### Grok CLI

Grok discovers skills from `.grok/skills` (project, repo and `~/.grok/skills`), plus `.claude/skills`, `.cursor/skills` and `.agents/skills`. `skills-doctor` scans exactly the same locations, so:

```powershell
skills-doctor check --root .        # covers your Grok project skills
skills-doctor check --root $HOME    # covers ~/.grok/skills and other user-level skills
```

No install step is needed — Grok loads `SKILL.md` packages natively. If your Grok build has MCP enabled, you can additionally register the MCP server above to let the model call `skills_doctor` itself.

## Rules

| Rule | Level | Meaning |
|---|---|---|
| `shadowed` | warn | Same ID defined in multiple sources; only one wins, the rest is dead weight and easy to edit by mistake |
| `flat-dir-collision` | warn | Both `<id>.md` and `<id>/SKILL.md` exist in the same source |
| `duplicate-content` | warn | Two skills share identical body text |
| `near-duplicate-description` | warn | Descriptions are ≥ 75% similar; the model may pick the wrong one |
| `missing-description` | info | No description, so the model never discovers it |
| `long-description` | warn | Description > 240 chars (paid on every model step) |
| `large-body` | warn | Body > 4000 tokens (pasted into context when invoked) |
| `token-budget` | warn/error | Total advertised description tokens exceed the budget (default 1200) |
| `too-many-skills` | warn/error | More than 60 / 100 skills are advertised |
| `invalid-id` | info | ID is not kebab-case |
| `hidden-skill` | info | Hidden via `opencode/autoinvoke: false` or `disable-model-invocation: true` |
| `stale-skill` | info | Not updated within `--stale-days` |
| `broken-reference` | warn | `references/`, `scripts/`, `assets/`, `templates/` or `examples/` path does not exist |
| `reference-outside-skill` | info | A referenced file lives outside the skill directory (hurts portability) |
| `invalid-frontmatter` | warn | Unclosed `---` fence, or non-string name/description / non-object metadata |
| `empty-body` | info | Body is nearly empty, so the skill carries no instructions |
| `managed-drift` | warn | A file installed by `update` was modified afterwards |
| `managed-missing` | warn | Recorded in the lock, but the local file is gone |
| `managed-unsafe` | warn | Path traversal or another unsafe path in the lock |
| `lock-version-unsupported` | info | Lock is newer than this tool; parsed in compatibility mode |

## Forward compatibility

- **Lock**: supports v1 (string versions, no hashes) and v2 (per-file sha1). A newer lock version is parsed in compatibility mode, unknown fields are ignored, and a single `lock-version-unsupported` notice is emitted.
- **Catalog `index.json`**: only `skills[].name/version/files` is read; any future fields are ignored.
- **Skill frontmatter**: only `name`, `description`, `metadata.opencode/autoinvoke` and `disable-model-invocation` are read; everything else is ignored.
- **Paths**: both OpenCode 2.0 locations (`.opencode/skills`, `~/.config/opencode/skills`) and compatibility locations (`.claude/skills`, `.agents/skills`, searched upward level by level).
- The updater always writes the highest lock version this tool supports, so older readers never break on new fields.

## Discovery sources (low → high precedence)

1. `~/.claude/skills`
2. project `.claude/skills` (from the project root up to the current directory)
3. `~/.agents/skills`
4. project `.agents/skills`
5. `~/.cursor/skills`
6. project `.cursor/skills`
7. `~/.grok/skills`
8. project `.grok/skills`
9. `~/.config/opencode/skills`
10. project `.opencode/skills`
11. the `skills` array in `opencode.json(c)` (2.x) or `skills.paths` (1.x); relative paths resolve from the working directory; supports `~/`, absolute paths and HTTP catalogs

## JSON output

`check --json`, `scan --json` and `update --json` all print structured JSON, ready for CI or a web report. Fields include `summary`, `findings[]` and `skills[]` (with `managed: { version, url, root }`).

## Security

This tool reads and writes skill files. Before using it against a real setup:

- `update` downloads catalog content **without signature verification** — treat catalogs as code;
- `fix` / `--prune` move or delete files — preview with `--dry-run` first;
- it is **not a sandbox** and does not constrain what an agent can do.

See [SECURITY.md](SECURITY.md) for the full threat model, hardening checklist and private vulnerability reporting.

## Caveats and known limitations

**Install / plugin**

- OpenCode **2.x**: add `"plugins": ["opencode-skills-doctor"]` to `opencode.jsonc` — done.
- OpenCode **1.x**: needs `npm i --prefix ~/.config/opencode opencode-skills-doctor` plus a one-line local plugin file (`export { SkillsDoctorPlugin } from "opencode-skills-doctor/v1"`), because 1.x resolves plugins differently and `@opencode-ai/plugin` is an optional peer.
- 1.x has no plugin-registered `/skills-doctor` command; `skills-doctor install` writes a markdown command file instead.

**Safety / behavior**

- `fix` defaults to **project-only**; pass `--all` to touch global sources. Archived files go to `.skills-doctor-archive/<timestamp>/` (reversible; originals are moved, not deleted).
- `fix` only touches **shadowed** definitions. It never edits the effective skill and never rewrites descriptions or bodies.
- `fix --hide` only adds `metadata.opencode/autoinvoke: false`; the skill stays loadable with `@id`.
- Shadowing follows OpenCode's precedence: later registration wins; on a tie, the `SKILL.md` directory form wins. If the runtime disagrees, trust the runtime.
- This is **not** a security sandbox: it audits configuration and files, it does not constrain what the agent can do.

**Measurement**

- The default `budget` (1200 tokens) is a recommendation, not a hard limit. Tune it with `.skills-doctor.json` or `--budget`.
- Token counts are heuristic (CJK ≈ 1.7 chars/token, the rest ≈ 4 chars/token) — good for comparisons, not for billing.
- `check` is offline; ask a catalog for new versions with `update --check-only`.
- Config precedence is assumed: global config < project config < `skills` array order.

## FAQ and troubleshooting

**A skill I created does not appear.**
Check: does the file have a `description`? Is it hidden via `opencode/autoinvoke: false` or `disable-model-invocation`? Is the ID derived from the path (directory name for `SKILL.md`, filename for flat `.md`)? Is an earlier/later source shadowing it? `skills-doctor scan` shows the winning definition for each ID.

**`fix` did nothing.**
`fix` only archives **shadowed** duplicates and defaults to project-only. Run `skills-doctor fix --dry-run` to see what it would do, and `--all` to include global sources. Content issues (long descriptions, large bodies) are reported, not rewritten.

**`check` says the budget is exceeded but the agent feels fine.**
The token numbers are heuristics, and the 1,200-token budget is a recommendation. Tune it with `--budget` or `.skills-doctor.json`; treat the report as a relative comparison, not billing.

**Where did `fix` move my files?**
Into `.skills-doctor-archive/<timestamp>/` inside the same skill source. Move them back to restore.

**Does it update skills automatically in the background?**
No daemon. Run `skills-doctor update` when you want to sync; use `--check-only` to just list available updates.

**Does it work on OpenCode 1.x?**
Yes — the CLI works on both lines, and `skills-doctor install` wires up the 1.x plugin (local plugin entry + generated command). 1.x has no `/skills-doctor` command registration from plugins, so the installer writes a command file instead.

**Why does the plugin cost tokens if it runs locally?**
Executing code is free, but the tool definition is part of the model's context. That is why the CLI mode exists: zero context cost.

## Roadmap

- v0.5: CI governance (baseline that only reports new issues, official GitHub Action), content-aware suggestions (which skills are never used), catalog signature verification
- Later: V1/Claude skill migration report

## Development and contributing

```powershell
npm test          # 50 tests (node test/doctor.test.mjs)
npm run bench     # lint timing for 100/500/1000 skills
```

- CI runs on ubuntu/macos/windows × Node 20/22/24; `prepublishOnly` re-runs the tests before every publish.
- Issues and PRs are welcome: for behavior changes, open an issue first with the scenario and expected output. Link the issue in the PR.
- Keep the CLI dependency-free and the output bilingual (`--lang en|zh`) — both are project invariants.
- Security reports: see [SECURITY.md](SECURITY.md); do not open a public issue for vulnerabilities.
- Release notes live in [CHANGELOG.md](CHANGELOG.md).

### Project layout

| Path | Purpose |
|---|---|
| `src/audit.mjs` | one-call audit used by CLI, plugin and MCP |
| `src/discover.mjs` | source discovery, precedence, JSONC parsing |
| `src/lint.mjs` | rules, token budget, near-duplicate detection |
| `src/fix.mjs` | archive / hide |
| `src/catalog.mjs` | updater, lockfile, retries, atomic writes |
| `src/managed.mjs` | lock verification and drift detection |
| `src/cli.mjs` | command dispatch and output |
| `src/i18n.mjs` | English/Chinese strings |
| `src/mcp.mjs` | MCP stdio server |
| `src/plugin.mjs` / `src/plugin-v1.mjs` | OpenCode 2.x / 1.x entries |
| `src/install.mjs` | one-command OpenCode integration |

MIT
