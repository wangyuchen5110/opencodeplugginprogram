# skills-doctor

[![test](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml/badge.svg)](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml)

Local scanner, linter, fixer, updater and **OpenCode plugin** for skills — zero dependencies, Node ≥ 20.

**English** | [简体中文](README.zh-CN.md)

## Why

On every model step, OpenCode advertises every skill that has a `description` — the model sees `ID + name + description` for each of them. Skills are not free: they are a permanent context tax on every request.

**What this costs.** 29 skills with long descriptions ≈ **3,000+ tokens every step**. Over a 100-step session that is ~300k tokens of pure overhead — spent before the model reads a single line of your code. Just imagine what if there are much more skills u download without awareness.Plus, some skills are Out-Of-Date now. This tool help u recognise your skill respository much well.

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

## Commands

All commands accept `--lang en|zh` (default: auto from the system locale) and `--json`.

### `check` (default)

Scans every skill source, reports problems, the context budget and fix hints.

```powershell
skills-doctor check
skills-doctor check --json
skills-doctor check --budget 800 --strict    # for CI
skills-doctor check --root .\some-project --no-global
```

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

## Configuration

Optional `.skills-doctor.json` in the working directory (or pass `--config <file>`):

```json
{
  "budget": 1200,
  "staleDays": 180,
  "lang": "en",
  "rules": { "long-description": "off", "hidden-skill": "info" },
  "ignore": ["legacy-skill"]
}
```

`rules` accepts `off`, `info`, `warn` or `error`; `ignore` drops findings that only involve those IDs. CLI flags override the file.

## OpenCode plugin

The package also exports an OpenCode 2.x plugin:

```jsonc
// opencode.jsonc
{
  "plugins": ["opencode-skills-doctor"]
}
```

It registers:

- the `skills_doctor` tool (namespace `skills`) — the agent can audit with `{ directory?, budget? }` and gets a markdown report;
- the `/skills-doctor` command — asks the agent to run the audit and summarize fixes.

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

It registers the same `skills_doctor` tool (1.x has no `/skills-doctor` command hook).

> The package root entry is the V2 plugin and requires OpenCode 2.x. The CLI works on both lines.

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
5. `~/.config/opencode/skills`
6. project `.opencode/skills`
7. the `skills` array in `opencode.json(c)` (2.x) or `skills.paths` (1.x); relative paths resolve from the working directory; supports `~/`, absolute paths and HTTP catalogs

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
- 1.x has **no `/skills-doctor` command** — only the `skills_doctor` tool.

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

## Roadmap

- v0.4: content-aware suggestions (which skills are never used), catalog signature verification
- Later: V1/Claude skill migration report

## Development

```powershell
npm test
```

Coverage: frontmatter parsing, source discovery and precedence, shadowing/duplication/budget rules, catalog download and lock, drift detection and self-healing, old/new lock compatibility, CLI JSON output and exit codes.

MIT
