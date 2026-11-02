---
name: skills-doctor-audit
description: Audit installed agent skills for per-step token cost, shadowed duplicates, broken references and budget overruns, then propose concrete fixes.
whenToUse: Use when the user mentions too many skills, context bloat, token cost, duplicate or missing skills, or asks for a skill health check.
metadata:
  author: wangyuchen5110
  source: opencode-skills-doctor
---

# Skill audit workflow

Audit the user's installed skills and turn the result into a short, actionable answer.
Never modify skill files without explicit confirmation.

## 1. Run the read-only audit

```powershell
npx -y opencode-skills-doctor check --json
```

Read `summary.advertisedTokens` (cost per model step), `summary.advertised` and `findings[]`.
If the command fails, fall back to `opencode-skills-doctor` when installed globally, or ask the user to run it from the repo.

## 2. Explain the top findings

Report at most three findings, in plain language, each with its token impact:

- `token-budget` — descriptions cost roughly N tokens on **every** model step;
- `shadowed` — the same skill ID loads from several places, only one wins;
- `long-description` / `large-body` — descriptions or bodies that are paid on every step / every invocation;
- `broken-reference` — a `references/` or `scripts/` file the skill points at is missing.

## 3. Show what can actually be saved

```powershell
npx -y opencode-skills-doctor plan --json
```

Report `recommended.savings` (per step), `recommended.final` and `recommended.stepsSavings`
(per 100 steps). Explain the difference: trimming descriptions keeps discoverability; hiding a skill
(`autoinvoke: false`) removes it from the advertised list but keeps `@id` loading.

## 4. Propose fixes — do not apply silently

- Hide low-frequency skills: `npx -y opencode-skills-doctor fix --hide id1,id2`
- Archive shadowed duplicates (reversible): `npx -y opencode-skills-doctor fix`
- Trim descriptions manually, keeping them discoverable
- Ask first, then re-run `check` to confirm the new cost

## 5. Optional shareable report

```powershell
npx -y opencode-skills-doctor check --html skills-report.html --open
```
