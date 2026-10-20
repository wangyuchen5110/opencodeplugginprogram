import fs from "node:fs"
import path from "node:path"
import { discoverSources, scanAll } from "./discover.mjs"
import { lint, resolveWinners, summarize, SEVERITY_ORDER } from "./lint.mjs"
import { updateCatalogs, LOCK_NAME } from "./catalog.mjs"
import { inspectManaged } from "./managed.mjs"
import { planFixes, applyFixes } from "./fix.mjs"
import { padDisplay } from "./parse.mjs"
import { detectLang, normalizeLang, translator } from "./i18n.mjs"

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
const red = (t) => paint("31", t)
const yellow = (t) => paint("33", t)
const green = (t) => paint("32", t)
const cyan = (t) => paint("36", t)
const dim = (t) => paint("2", t)
const bold = (t) => paint("1", t)

const HINT_KEYS = {
  shadowed: "hint.shadowed",
  "flat-dir-collision": "hint.flat-dir-collision",
  "duplicate-content": "hint.duplicate-content",
  "near-duplicate-description": "hint.near-duplicate-description",
  "missing-description": "hint.missing-description",
  "long-description": "hint.long-description",
  "large-body": "hint.large-body",
  "token-budget": "hint.token-budget",
  "too-many-skills": "hint.too-many-skills",
  "invalid-id": "hint.invalid-id",
  "hidden-skill": "hint.hidden-skill",
  "stale-skill": "hint.stale-skill",
}

function parseArgs(argv) {
  const options = {
    command: "check",
    root: process.cwd(),
    global: true,
    budget: 1200,
    staleDays: 0,
    strict: false,
    json: false,
    lang: null,
    dryRun: false,
    into: null,
    checkOnly: false,
    help: false,
    version: false,
  }

  const args = [...argv]
  const commands = new Set(["check", "scan", "update", "fix", "help"])
  if (args[0] && commands.has(args[0])) {
    options.command = args.shift()
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--root":
        options.root = path.resolve(args[++i] ?? ".")
        break
      case "--no-global":
        options.global = false
        break
      case "--budget":
        options.budget = Number(args[++i])
        break
      case "--stale-days":
        options.staleDays = Number(args[++i])
        break
      case "--strict":
        options.strict = true
        break
      case "--json":
        options.json = true
        break
      case "--lang":
        options.lang = args[++i] ?? null
        break
      case "--dry-run":
        options.dryRun = true
        break
      case "--into":
        options.into = path.resolve(args[++i] ?? ".")
        break
      case "--check-only":
        options.checkOnly = true
        break
      case "-h":
      case "--help":
        options.help = true
        break
      case "-v":
      case "--version":
        options.version = true
        break
      default:
        if (arg.startsWith("-")) {
          console.error(`unknown option: ${arg}`)
          process.exit(2)
        }
    }
  }

  if (!Number.isFinite(options.budget) || options.budget <= 0) options.budget = 1200
  if (!Number.isFinite(options.staleDays) || options.staleDays < 0) options.staleDays = 0
  return options
}

function serializeSkills(skills, managed = new Map()) {
  return skills.map((s) => ({
    id: s.id,
    form: s.form,
    file: s.file,
    kind: s.source.kind,
    scope: s.source.scope,
    order: s.order,
    advertised: s.advertised,
    hidden: s.hidden,
    descriptionChars: s.description.length,
    descriptionTokens: s.descriptionTokens,
    bodyTokens: s.bodyTokens,
    bytes: s.bytes,
    mtime: s.mtime ? new Date(s.mtime).toISOString() : null,
    managed: managed.get(s.file) ?? null,
  }))
}

function runCheck(discovered, options, managedInfo, t) {
  const findings = [
    ...lint(discovered.skills, { budget: options.budget, staleDays: options.staleDays, t }),
    ...managedInfo.findings,
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const summary = summarize(discovered.skills)
  const errors = findings.filter((f) => f.severity === "error").length
  const warnings = findings.filter((f) => f.severity === "warn").length
  const infos = findings.filter((f) => f.severity === "info").length
  const exitCode = errors > 0 || (options.strict && warnings > 0) ? 1 : 0

  return {
    tool: "skills-doctor",
    version: pkg.version,
    cwd: path.resolve(options.root),
    projectRoot: discovered.projectRoot,
    sources: discovered.sources.map((s) => ({
      kind: s.kind,
      scope: s.scope,
      dir: s.dir,
      order: s.order,
      exists: fs.existsSync(s.dir),
    })),
    catalogs: discovered.catalogs,
    missing: discovered.missing,
    summary,
    managed: { count: managedInfo.managed.size },
    findings,
    counts: { errors, warnings, infos },
    exitCode,
  }
}

function printCheck(result, options, t) {
  const { summary, counts } = result
  console.log(bold(t("check.title", { version: result.version })))
  console.log(dim(t("check.workdir", { dir: result.cwd })))
  console.log(dim(t("check.projectRoot", { dir: result.projectRoot })))
  console.log(
    t("check.sources", {
      total: result.sources.length,
      existing: result.sources.filter((s) => s.exists).length,
      definitions: summary.total,
      unique: summary.unique,
      advertised: summary.advertised,
      tokens: summary.advertisedTokens,
    }),
  )
  if (result.catalogs.length) {
    console.log(dim(t("check.catalogs", { count: result.catalogs.length })))
  }
  if (result.managed.count > 0) {
    console.log(dim(t("check.managed", { count: result.managed.count })))
  }
  for (const missing of result.missing) {
    if (missing.kind === "config-error") {
      console.log(yellow(t("check.configError", { path: missing.path, error: missing.error })))
    } else {
      console.log(yellow(t("check.missingPath", { path: missing.path })))
    }
  }
  console.log("")

  if (!result.findings.length) {
    console.log(bold(t("check.none")))
  } else {
    const badge = { error: red("[E]"), warn: yellow("[W]"), info: cyan("[i]") }
    for (const finding of result.findings) {
      console.log(`${badge[finding.severity]} ${dim(finding.rule)}  ${finding.message}`)
    }
    console.log("")
    console.log(
      t("check.summary", { errors: counts.errors, warnings: counts.warnings, infos: counts.infos }) +
        (options.strict ? t("check.strict") : ""),
    )
  }

  const usedRules = [...new Set(result.findings.map((f) => f.rule))].filter((r) => HINT_KEYS[r])
  if (usedRules.length) {
    console.log("")
    console.log(bold(t("check.hints")))
    for (const rule of usedRules) console.log(dim(`  - ${t(HINT_KEYS[rule])}`))
  }
}

function printScan(discovered, options, managed, t) {
  const winners = resolveWinners(discovered.skills)
  const rows = discovered.skills
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id) || a.order - b.order)
    .map((s) => {
      const info = managed.get(s.file)
      return {
        id: s.id + (winners.get(s.id) === s ? " *" : "") + (info ? ` @${info.version}` : ""),
        scope: s.source.scope,
        adv: s.advertised ? "yes" : "no",
        tokens: String(s.descriptionTokens),
        body: String(s.bodyTokens),
        file: s.file,
      }
    })

  console.log(bold(t("scan.title", { version: pkg.version })))
  console.log(dim(t("scan.workdir", { dir: path.resolve(options.root) })))
  console.log(dim(t("scan.projectRoot", { dir: discovered.projectRoot })))
  console.log("")

  const widths = {
    id: Math.max(4, ...rows.map((r) => r.id.length)) + 2,
    scope: 8,
    adv: 4,
    tokens: 7,
    body: 6,
  }
  console.log(
    dim(
      padDisplay(t("scan.col.id"), widths.id) +
        padDisplay(t("scan.col.scope"), widths.scope) +
        padDisplay(t("scan.col.adv"), widths.adv) +
        padDisplay(t("scan.col.desc"), widths.tokens) +
        padDisplay(t("scan.col.body"), widths.body) +
        t("scan.col.file"),
    ),
  )
  for (const row of rows) {
    console.log(
      padDisplay(row.id, widths.id) +
        padDisplay(row.scope, widths.scope) +
        padDisplay(row.adv, widths.adv) +
        padDisplay(row.tokens, widths.tokens) +
        padDisplay(row.body, widths.body) +
        dim(row.file),
    )
  }
  console.log("")
  console.log(dim(t("scan.winner")))
  if (discovered.catalogs.length) {
    console.log(dim(t("scan.catalogs", { urls: discovered.catalogs.map((c) => c.url).join(", ") })))
  }
}

async function runUpdate(discovered, options, cwd, t) {
  const into = options.into ? path.resolve(options.into) : path.join(cwd, ".opencode", "skills")
  if (!discovered.catalogs.length) {
    console.log(bold(t("update.title")))
    console.log(`  ${t("update.noCatalogs")}`)
    return 0
  }

  const { lockPath, results, lockTooNew } = await updateCatalogs(discovered.catalogs, {
    into,
    checkOnly: options.checkOnly,
    t,
  })

  if (options.json) {
    console.log(JSON.stringify({ lockPath, checkOnly: options.checkOnly, results }, null, 2))
    return results.some((r) => r.error) ? 1 : 0
  }

  console.log(bold(t(options.checkOnly ? "update.titleCheckOnly" : "update.title")))
  console.log(dim(t("update.into", { dir: into })))
  console.log("")
  for (const result of results) {
    console.log(cyan(result.url))
    if (result.error) {
      console.log(red(t("update.failed", { error: result.error })))
      continue
    }
    if (result.updated.length) {
      const label = t(options.checkOnly ? "update.labelAvailable" : "update.labelUpdated")
      const items = result.updated
        .map((u) => {
          if (u.reason === "drift") return t("update.driftRepair", { name: u.name, version: u.version })
          if (u.previous) return t("update.versionBump", { name: u.name, previous: u.previous, version: u.version })
          return t("update.versioned", { name: u.name, version: u.version })
        })
        .join(", ")
      console.log(green(t("update.updated", { label, count: result.updated.length, items })))
    }
    if (result.unchanged.length) console.log(dim(t("update.unchanged", { count: result.unchanged.length })))
    if (result.files) console.log(dim(t("update.files", { count: result.files })))
    for (const invalid of result.invalid) {
      console.log(yellow(t("update.skipped", { name: invalid.name, problems: invalid.problems.join("; ") })))
    }
    if (!result.updated.length && !result.unchanged.length && !result.invalid.length) {
      console.log(dim(t("update.empty")))
    }
  }
  console.log("")
  console.log(dim(t("update.lock", { path: lockPath, name: LOCK_NAME })))
  if (lockTooNew) console.log(yellow(t("update.lockTooNew")))
  if (!options.checkOnly && results.some((r) => !r.error)) {
    console.log(dim(t("update.detector", { dir: into })))
  }
  return results.some((r) => r.error) ? 1 : 0
}

function runFix(discovered, options, managedInfo, t) {
  const { plan, skipped } = planFixes(discovered.skills, managedInfo.managed)
  const { moved, errors } = applyFixes(plan, { dryRun: options.dryRun })

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          tool: "skills-doctor",
          version: pkg.version,
          dryRun: options.dryRun,
          archived: moved.map((m) => ({ id: m.id, from: m.from, to: m.target })),
          skipped: skipped.map((s) => ({ id: s.id, file: s.file })),
          errors: errors.map((e) => ({ id: e.id, from: e.from, error: e.error })),
        },
        null,
        2,
      ),
    )
    return errors.length ? 1 : 0
  }

  if (!plan.length && !skipped.length) {
    console.log(bold(t("fix.title")))
    console.log(`  ${t("fix.none")}`)
    return 0
  }

  console.log(bold(t("fix.title")))
  if (options.dryRun) console.log(dim(t("fix.dryRun")))
  for (const item of moved) console.log(green(t("fix.moved", { from: item.from, to: item.target })))
  for (const item of skipped) console.log(dim(t("fix.skippedManaged", { path: item.file })))
  for (const item of errors) console.log(red(t("fix.error", { path: item.from, error: item.error })))
  console.log("")
  console.log(t("fix.summary", { moved: moved.length, skipped: skipped.length }))
  console.log(dim(t("fix.rerun")))
  return errors.length ? 1 : 0
}

export async function main(argv) {
  const options = parseArgs(argv)

  if (options.lang && !normalizeLang(options.lang)) {
    console.error(`unsupported --lang: ${options.lang} (expected en or zh)`)
    process.exit(2)
  }
  const lang = normalizeLang(options.lang) ?? detectLang()
  const t = translator(lang)

  if (options.help || options.command === "help") {
    console.log(t("help", { version: pkg.version }))
    return
  }
  if (options.version) {
    console.log(pkg.version)
    return
  }

  const cwd = path.resolve(options.root)
  const discovered = scanAll(discoverSources({ cwd, includeGlobal: options.global }))
  const managedInfo = inspectManaged(discovered.scans, { t })

  if (options.command === "scan") {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            tool: "skills-doctor",
            version: pkg.version,
            lang,
            cwd,
            skills: serializeSkills(discovered.skills, managedInfo.managed),
          },
          null,
          2,
        ),
      )
      return
    }
    printScan(discovered, options, managedInfo.managed, t)
    return
  }

  if (options.command === "update") {
    process.exitCode = await runUpdate(discovered, options, cwd, t)
    return
  }

  if (options.command === "fix") {
    process.exitCode = runFix(discovered, options, managedInfo, t)
    return
  }

  const result = runCheck(discovered, options, managedInfo, t)
  if (options.json) {
    console.log(JSON.stringify({ ...result, lang, skills: serializeSkills(discovered.skills, managedInfo.managed) }, null, 2))
  } else {
    printCheck(result, options, t)
  }
  process.exitCode = result.exitCode
}
