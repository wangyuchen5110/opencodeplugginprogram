# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x | ✅ |
| < 0.3 | ❌ |

Pre-1.0: only the latest minor receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub private vulnerability reporting:

<https://github.com/wangyuchen5110/opencodeplugginprogram/security/advisories/new>

Include the version, a reproduction, the impact, and a suggested fix if you have one. Best-effort response within 7 days.

## What this tool does with your system

- Runs locally with the privileges of the invoking user. **No telemetry.**
- Network access only for `update` (HTTP catalogs) and for `npx` when you install/run the package that way.
- Reads skill files and frontmatter, `opencode.json(c)` / `opencode.jsonc`, and `.skills-doctor.lock.json`. It does **not** read model credentials, API keys, or conversation content.
- Writes only on explicit commands:
  - `fix` — moves shadowed definitions into `.skills-doctor-archive/`, optionally edits `metadata.opencode/autoinvoke` (`--hide`);
  - `update` — writes downloaded files into a skill directory and updates the lock;
  - everything else (`check`, `scan`, `mcp`) is read-only.

## Risk areas and mitigations

### `update` downloads untrusted content

- There is **no signature verification**. The catalog's `version` field is trusted as-is.
- Downloads are restricted to the same origin as `index.json`; path traversal (`..`, absolute paths, schemes) is rejected; files are written only under the target skill directory.
- Downloaded skills are **instructions for an agent**. Treat catalogs as code: use a catalog you control, pin it, review diffs, and run `update --check-only` before applying.
- The updater executes no code from the catalog. It only fetches and writes files.

### `fix` and `--prune` change files

- `fix` archives only definitions that are **shadowed** (never loaded). The effective skill is not moved. Archived files go to `.skills-doctor-archive/<timestamp>/` and can be restored by moving them back.
- `fix` defaults to **project-only**; `--all` extends it to global sources (`~/.config/opencode/skills`, `~/.claude/skills`, ...).
- `update --prune` **deletes** skill directories that disappeared from a catalog. Without `--prune` they are only reported.
- Always use `--dry-run` first and review the paths that would change.

### MCP server and plugins

- `skills-doctor mcp` only runs the local audit. It does not proxy, execute, or store MCP content.
- The OpenCode plugin runs inside the OpenCode process with your privileges. It registers one tool and one command; it does not intercept unrelated tool calls.
- The MCP client / plugin may start the package through `npx`, which downloads the published package from npm. Pin a version (`opencode-skills-doctor@0.3.9`) if you need reproducibility.

### Not a sandbox

This tool audits configuration and files. **It does not constrain what an agent can do.** Use the permission and sandbox controls of your agent runtime (OpenCode permissions, OS sandboxing, containers) for containment.

## Hardening checklist

- Run `check` and `fix --dry-run` before letting `fix` or `--prune` modify anything.
- Use `--no-global` on CI unless you explicitly want machine-wide skills audited.
- Pin the package version in automation: `npx -y opencode-skills-doctor@0.3.9 check --strict`.
- Review `.skills-doctor-archive/` and delete it when you no longer need the backups.
- Treat every catalog and every downloaded `SKILL.md` as code you are installing.

## Out of scope

- Vulnerabilities in OpenCode, Claude Code, Codex, Codeium/Kimi Code, DeepSeek Harness, or any other host runtime.
- Malicious content inside third-party skills or catalogs (that is a trust decision for the operator; see above).
- Behavior of the models that read the skills.
