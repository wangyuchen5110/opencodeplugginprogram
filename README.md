<p align="center">
  <img src="https://raw.githubusercontent.com/wangyuchen5110/opencodeplugginprogram/main/docs/assets/banner.svg" alt="skills-doctor — audit the hidden token cost of agent skills" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-doctor"><img src="https://img.shields.io/npm/v/opencode-skills-doctor?style=flat-square&color=3fb950" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-doctor"><img src="https://img.shields.io/npm/dw/opencode-skills-doctor?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/wangyuchen5110/opencodeplugginprogram/stargazers"><img src="https://img.shields.io/github/stars/wangyuchen5110/opencodeplugginprogram?style=flat-square&color=58a6ff" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-3fb950?style=flat-square" alt="Node ≥ 20">
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/opencode-skills-doctor?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml"><img src="https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml/badge.svg?style=flat-square" alt="tests"></a>
</p>

<p align="center">
  <b>Audit, fix and update the skills your coding agent loads.</b><br>
  Measure the per-step token tax, find shadowed duplicates and broken references — then fix them safely.
</p>

<p align="center">
  English · <a href="docs/README.zh-CN.md">简体中文</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="SECURITY.md">Security</a> · <a href="docs/REFERENCE.md">Full reference</a>
</p>

---

## The 30-second version

Every agent skill with a `description` is advertised to the model on **every single step**. On a machine with 29 skills that is **~3,074 tokens per step** — before the model reads a line of your code. Duplicates silently shadow each other, descriptions drift, and references to files that no longer exist go unnoticed.

`skills-doctor` measures that cost, shows which definition actually wins, and fixes it:

| | |
|---|---|
| **Find** | token budget, shadowed duplicates, flat/dir collisions, long descriptions, oversized bodies, broken references, invalid frontmatter, stale skills |
| **Fix** | archive shadowed definitions (reversible), hide low-frequency skills, trim descriptions with a measured plan |
| **Update** | sync skills from HTTP catalogs with a lockfile, drift detection and `--prune` |
| **Report** | terminal, JSON, or a self-contained HTML report |
| **Run it** | CLI · OpenCode plugin (1.x/2.x/Desktop) · MCP server · DeepSeek Harness skill |

## See it

<p align="center">
  <img src="https://raw.githubusercontent.com/wangyuchen5110/opencodeplugginprogram/main/docs/assets/report.png" alt="skills-doctor HTML report" width="82%">
</p>

A real `check --html` run: summary cards, the context-budget bar, filterable findings, and the exact potential savings.

## Quick start

```powershell
# terminal report
npx -y opencode-skills-doctor check

# how many tokens can I actually cut?
npx -y opencode-skills-doctor plan

# shareable HTML report
npx -y opencode-skills-doctor check --html report.html --open
```

Example `plan` output on a real setup:

```text
current: ~3,124 tokens/step (30 advertised)   budget: 1,200

Option A — trim descriptions   26 skills → 1,606  (−1,518)
Option B — hide skills         11 skills → 1,200  (−1,924)
Recommended                     trim 26 + hide 2 → 1,184  (−1,940)
over 100 steps that saves ~194,000 tokens
```

## Install

```powershell
# OpenCode — plugin + /skills-doctor, /skills-report, /skills-upgrade commands
npx -y opencode-skills-doctor install              # auto-detects 1.x / 2.x / Desktop
npx -y opencode-skills-doctor install --client desktop

# DeepSeek Harness — MCP tool + audit skill, one command
npx -y opencode-skills-doctor install --client dsh
```

**Claude Code, Codex, Grok or any MCP client** — register the server once:

```powershell
npx -y opencode-skills-doctor mcp
```

```json
{ "mcpServers": { "skills-doctor": { "command": "npx", "args": ["-y", "opencode-skills-doctor", "mcp"] } } }
```

Nothing to configure for **skills discovery**: it reads `.opencode/skills`, `.claude/skills`, `.agents/skills`, `.grok/skills`, `.cursor/skills` and their user-level equivalents. See the [full reference](docs/REFERENCE.md) for OpenCode 1.x, DSH YAML, Codex TOML and Claude Code details.

## Commands

| Command | What it does |
|---|---|
| `check` | audit sources, conflicts, budget and broken references (default) |
| `plan` | exact token savings: what to trim, what to hide, projected over N steps |
| `scan` | every skill with its source, precedence and cost |
| `fix` | archive shadowed definitions (reversible) or hide low-frequency skills |
| `update` | sync skills from HTTP catalogs, verify hashes, detect drift |
| `install` / `uninstall` | wire into OpenCode (1.x/2.x/Desktop) or DeepSeek Harness |
| `upgrade` | check for / apply a newer skills-doctor itself |
| `mcp` | run as an MCP server |

All commands accept `--json`, `--lang en|zh`, `--budget`, `--root` and `--no-global`. Full flags, rules and configuration live in the [reference](docs/REFERENCE.md).

## Works where you work

| Agent | How |
|---|---|
| **OpenCode 2.x** | `plugins: ["opencode-skills-doctor"]` → tool + commands + budget warning |
| **OpenCode 1.x** | `install` writes the local plugin entry and markdown commands |
| **OpenCode Desktop** | shares the CLI config; `--client desktop` detects the app and its bundled core |
| **DeepSeek Harness** | `install --client dsh` adds the MCP entry and the `skills-doctor-audit` skill |
| **Claude Code / Codex** | MCP server (`npx -y opencode-skills-doctor mcp`) |
| **Grok CLI / Cursor** | their skill roots are scanned natively |

## Why it is safe

- `fix` only archives **shadowed** definitions, moving them into `.skills-doctor-archive/<timestamp>/` — reversible, and the effective skill is never touched.
- `plan` is pure math: no LLM calls, no network, no file changes.
- `update` blocks path traversal, writes atomically, verifies sha1 and detects drift.
- It is **not** a sandbox; read [SECURITY.md](SECURITY.md) before pointing it at a real setup.

## Development

```powershell
npm test          # 58 tests (node test/doctor.test.mjs)
npm run bench     # lint timing for 100/500/1000 skills
```

CI runs ubuntu/macos/windows × Node 20/22/24; `prepublishOnly` re-runs the tests. Issues and PRs are welcome — see the [reference](docs/REFERENCE.md).

[Full reference](docs/REFERENCE.md) · [中文 README](docs/README.zh-CN.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

MIT
