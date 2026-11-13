#!/usr/bin/env node
// Render a `skills-doctor check --json` report as GitHub-flavoured markdown and
// decide whether the job should fail. Used by action.yml, but plain enough to
// run by hand: `node scripts/action-summary.mjs audit.json --fail-on warn`.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MAX_ROWS = 10
const MAX_MESSAGE = 180

export const FAIL_MODES = ["error", "warn", "never"]

function escCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim()
}

function clip(value, limit = MAX_MESSAGE) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export function decideFail(audit, failOn = "error") {
  const mode = FAIL_MODES.includes(failOn) ? failOn : "error"
  if (mode === "never") return false
  if (audit.counts.errors > 0) return true
  return mode === "warn" && audit.counts.warnings > 0
}

/** Markdown block for `$GITHUB_STEP_SUMMARY` / a PR comment. */
export function renderSummary(audit, { failOn = "error", limit = MAX_ROWS } = {}) {
  const { summary, counts, findings } = audit
  const tokens = summary.advertisedTokens
  const budget = audit.budget
  const over = tokens > budget
  const lines = []

  lines.push("### skills-doctor")
  lines.push("")

  const cost = over
    ? `**~${tokens}** description tokens/step — **over** the ${budget} budget by ${tokens - budget}`
    : `**~${tokens}** description tokens/step — within the ${budget} budget`
  lines.push(`${cost} · ${summary.total} skill${summary.total === 1 ? "" : "s"} (${summary.advertised} advertised)`)
  lines.push("")
  lines.push(`\`${counts.errors} error\` · \`${counts.warnings} warn\` · \`${counts.infos} info\``)
  lines.push("")

  if (!findings.length) {
    lines.push("No findings. 🎉")
  } else {
    lines.push("| severity | rule | message |")
    lines.push("| --- | --- | --- |")
    for (const finding of findings.slice(0, limit)) {
      lines.push(`| ${escCell(finding.severity)} | ${escCell(finding.rule)} | ${escCell(clip(finding.message))} |`)
    }
    if (findings.length > limit) lines.push(`| … | … | ${findings.length - limit} more finding(s) |`)
    lines.push("")
    lines.push("<details><summary>Full report</summary>")
    lines.push("")
    lines.push("```")
    lines.push(`npx -y opencode-skills-doctor check --root ${audit.cwd}`)
    lines.push("```")
    lines.push("</details>")
  }

  lines.push("")
  lines.push("<sub>next: `npx -y opencode-skills-doctor plan` · `fix --dry-run`</sub>")

  if (decideFail(audit, failOn)) {
    const reason =
      counts.errors > 0 ? `${counts.errors} error(s)` : `${counts.warnings} warning(s)`
    lines.push("")
    lines.push(`> ❌ failing this job: ${reason} (fail-on: \`${failOn}\`)`)
  }

  return lines.join("\n") + "\n"
}

function parseArgs(argv) {
  const options = { json: null, out: null, failOn: "error", help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--out") options.out = argv[++i]
    else if (arg === "--fail-on") options.failOn = argv[++i]
    else if (arg === "-h" || arg === "--help") options.help = true
    else if (!arg.startsWith("-")) options.json = arg
    else {
      console.error(`unknown option: ${arg}`)
      process.exit(2)
    }
  }
  if (!FAIL_MODES.includes(options.failOn)) {
    console.error(`unsupported --fail-on: ${options.failOn} (expected ${FAIL_MODES.join(" | ")})`)
    process.exit(2)
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.json) {
    console.log(`Usage: node scripts/action-summary.mjs <audit.json> [--fail-on error|warn|never] [--out <file>]

Reads the JSON printed by \`skills-doctor check --json\`, writes markdown, and
exits non-zero when the audit should fail the job.`)
    process.exit(options.help ? 0 : 2)
  }

  let audit
  try {
    audit = JSON.parse(fs.readFileSync(options.json, "utf8").replace(/^\uFEFF/, ""))
  } catch (err) {
    console.error(`cannot read audit JSON ${options.json}: ${String(err?.message ?? err)}`)
    process.exit(2)
  }

  const markdown = renderSummary(audit, { failOn: options.failOn })
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true })
    fs.writeFileSync(options.out, markdown, "utf8")
  } else {
    process.stdout.write(markdown)
  }

  process.exit(decideFail(audit, options.failOn) ? 1 : 0)
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
