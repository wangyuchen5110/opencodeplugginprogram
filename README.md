# skills-doctor

[![test](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml/badge.svg)](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml)

Local scanner, linter, fixer and updater for **OpenCode skills** — zero dependencies, Node ≥ 20.

**English** | [简体中文](README.zh-CN.md)

## Why

On every model step, OpenCode advertises every skill that has a `description` — the model sees `ID + name + description` for each of them. As skills pile up, this turns into **context bloat, colliding descriptions, shadowed IDs, edits to the wrong file, and skills that silently stop working**.

`skills-doctor` surfaces all of that locally, and can also update skills from an HTTP catalog and verify the result.

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
```

- Only shadowed duplicates are touched; the effective definition is never moved;
- Files installed by `update` are skipped — use `update` to bring them back;
- After fixing, `check` should report no `shadowed` findings.

### `update` (updater)

Reads HTTP catalogs from the `skills` array in `opencode.json(c)`, compares `version`, and downloads whatever changed.

```powershell
skills-doctor update                 # installs into .opencode/skills by default (where opencode reads)
skills-doctor update --check-only    # only report available updates
skills-doctor update --into .\team-skills
```

- The output directory is a real OpenCode skill directory, so **`check` picks the update up immediately**;
- Writes `.skills-doctor.lock.json` (schema v2: a sha1 for every file);
- `check` reads that lock: shows managed versions, detects hand edits (`managed-drift`) and missing files (`managed-missing`);
- Running `update` again re-downloads drifted files (self-healing).

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
7. the `skills` array in `opencode.json(c)` (relative paths resolve from the working directory; supports `~/`, absolute paths and HTTP catalogs)

## JSON output

`check --json`, `scan --json` and `update --json` all print structured JSON, ready for CI or a web report. Fields include `summary`, `findings[]` and `skills[]` (with `managed: { version, url, root }`).

## Known limitations

- `check` is offline; use `update --check-only` to ask a catalog for new versions.
- Token counts are heuristic (CJK ≈ 1.7 chars/token, the rest ≈ 4 chars/token) — good for comparisons, not for billing.
- Config precedence is assumed: global config < project config < `skills` array order. If OpenCode differs, trust the runtime.
- No automatic file rewriting yet (v0.2 plans `--fix`: archive shadowed definitions, normalize IDs, trim descriptions).

## Roadmap

- v0.3: OpenCode plugin form, exposing the report as a `skills_doctor` tool
- v0.4: configurable rules (`.skills-doctor.json`); `fix` for content issues (trim descriptions, hide low-frequency skills)
- Later: V1/Claude skill migration report; catalog signature verification

## Development

```powershell
npm test
```

Coverage: frontmatter parsing, source discovery and precedence, shadowing/duplication/budget rules, catalog download and lock, drift detection and self-healing, old/new lock compatibility, CLI JSON output and exit codes.

MIT
