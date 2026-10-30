import fs from "node:fs"
import path from "node:path"
import { discoverSources, scanAll } from "./discover.mjs"
import { resolveWinners, SEVERITY_ORDER } from "./lint.mjs"
import { updateCatalogs, LOCK_NAME } from "./catalog.mjs"
import { inspectManaged } from "./managed.mjs"
import { planFixes, applyFixes, hideSkills } from "./fix.mjs"
import { auditSkills } from "./audit.mjs"
import { loadConfig } from "./config.mjs"
import { startMcpServer } from "./mcp.mjs"
import { installOpenCode, uninstallOpenCode } from "./install.mjs"
import { writeHtmlReport, openReport } from "./html.mjs"
import { planBudget } from "./plan.mjs"
import {
  checkForUpdate,
  resolveMode,
  upgradeCommand,
  applyUpgrade,
  openReleasePage,
  RELEASES_URL,
} from "./self-update.mjs"
import { padDisplay } from "./parse.mjs"
import { detectLang, normalizeLang, translator } from "./i18n.mjs"

const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""),
)

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
  "invalid-frontmatter": "hint.invalid-frontmatter",
  "empty-body": "hint.empty-body",
  "broken-reference": "hint.broken-reference",
  "reference-outside-skill": "hint.reference-outside-skill",
}

function parseArgs(argv) {
  const options = {
    command: "check",
    root: process.cwd(),
    global: true,
    budget: null,
    staleDays: null,
    strict: false,
    json: false,
    lang: null,
    config: null,
    dryRun: false,
    all: false,
    hide: [],
    into: null,
    checkOnly: false,
    prune: false,
    configDir: null,
    noNpm: false,
    html: null,
    open: false,
    apply: false,
    updateCheck: true,
    descTarget: 160,
    steps: 100,
    help: false,
    version: false,
  }

  const args = [...argv]
  const commands = new Set(["check", "scan", "plan", "update", "fix", "install", "uninstall", "upgrade", "mcp", "help"])
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
      case "--desc-target":
        options.descTarget = Number(args[++i])
        break
      case "--steps":
        options.steps = Number(args[++i])
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
      case "--config":
        options.config = args[++i] ?? null
        break
      case "--dry-run":
        options.dryRun = true
        break
      case "--all":
        options.all = true
        break
      case "--hide":
        options.hide.push(
          ...String(args[++i] ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        )
        break
      case "--into":
        options.into = path.resolve(args[++i] ?? ".")
        break
      case "--check-only":
        options.checkOnly = true
        break
      case "--prune":
        options.prune = true
        break
      case "--config-dir":
        options.configDir = path.resolve(args[++i] ?? ".")
        break
      case "--no-npm":
        options.noNpm = true
        break
      case "--html": {
        const next = args[i + 1]
        if (next && !next.startsWith("-")) {
          options.html = path.resolve(next)
          i++
        } else {
          options.html = path.resolve("skills-report.html")
        }
        break
      }
      case "--open":
        options.open = true
        break
      case "--apply":
        options.apply = true
        break
      case "--no-update-check":
        options.updateCheck = false
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

  if (options.budget !== null && (!Number.isFinite(options.budget) || options.budget <= 0)) options.budget = null
  if (options.staleDays !== null && (!Number.isFinite(options.staleDays) || options.staleDays < 0)) options.staleDays = null
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

function buildCheckResult(audit, options) {
  return {
    tool: "skills-doctor",
    version: pkg.version,
    lang: audit.lang,
    cwd: audit.cwd,
    projectRoot: audit.projectRoot,
    config: audit.config,
    budget: audit.budget,
    staleDays: audit.staleDays,
    sources: audit.sources.map((s) => ({
      kind: s.kind,
      scope: s.scope,
      dir: s.dir,
      order: s.order,
      exists: fs.existsSync(s.dir),
    })),
    catalogs: audit.catalogs,
    missing: audit.missing,
    summary: audit.summary,
    managed: { count: audit.managed.size },
    findings: audit.findings,
    counts: audit.counts,
    exitCode: audit.counts.errors > 0 || (options.strict && audit.counts.warnings > 0) ? 1 : 0,
  }
}

function printCheck(audit, result, options, t) {
  const { summary, counts } = audit
  console.log(bold(t("check.title", { version: result.version })))
  console.log(dim(t("check.workdir", { dir: result.cwd })))
  console.log(dim(t("check.projectRoot", { dir: result.projectRoot })))
  if (result.config.error) {
    console.log(yellow(t("config.error", { file: result.config.file, error: result.config.error })))
  } else if (fs.existsSync(result.config.file)) {
    console.log(dim(t("check.config", { file: result.config.file })))
  }
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
  if (result.catalogs.length) console.log(dim(t("check.catalogs", { count: result.catalogs.length })))
  if (result.managed.count > 0) console.log(dim(t("check.managed", { count: result.managed.count })))
  for (const missing of result.missing) {
    if (missing.kind === "config-error") {
      console.log(yellow(t("check.configError", { path: missing.path, error: missing.error })))
    } else if (missing.kind === "missing-path") {
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

  if (audit.summary.advertisedTokens > audit.budget) {
    const plan = planBudget(audit)
    if (plan.recommended.savings > 0) {
      console.log("")
      console.log(yellow(t("check.planHint", { tokens: plan.recommended.savings })))
    }
  }
}

function printPlan(plan, t) {
  console.log(bold(t("plan.title")))
  console.log(dim(t("plan.current", { tokens: plan.current, count: plan.advertised })))
  console.log(dim(t("plan.budget", { budget: plan.budget, gap: plan.gap })))
  console.log(dim(t("plan.steps", { steps: plan.steps })))
  console.log("")

  const sessionLine = (savings) => {
    if (plan.steps > 0 && savings > 0) console.log(dim(t("plan.session", { tokens: savings * plan.steps, steps: plan.steps })))
  }

  if (plan.current <= plan.budget) {
    console.log(green(t("plan.under")))
    if (plan.trim.count) {
      console.log("")
      console.log(bold(t("plan.trimTitle", { chars: plan.descTarget })))
      console.log(
        t("plan.trimLine", {
          count: plan.trim.count,
          savings: plan.trim.savings,
          final: Math.max(0, plan.current - plan.trim.savings),
        }),
      )
      sessionLine(plan.trim.savings)
    }
    return
  }

  console.log(bold(t("plan.trimTitle", { chars: plan.descTarget })))
  if (plan.trim.count) {
    console.log(
      t("plan.trimLine", {
        count: plan.trim.count,
        savings: plan.trim.savings,
        final: Math.max(0, plan.current - plan.trim.savings),
      }),
    )
    for (const item of plan.trim.items.slice(0, 10)) {
      console.log(dim(t("plan.trimItem", { id: item.id, saving: item.saving })))
    }
    if (plan.trim.items.length > 10) console.log(dim(t("plan.more", { count: plan.trim.items.length - 10 })))
  } else {
    console.log(dim(t("plan.trimNone")))
  }
  console.log("")

  console.log(bold(t("plan.hideTitle")))
  if (plan.hideOnly.count) {
    console.log(
      t("plan.hideLine", {
        count: plan.hideOnly.count,
        savings: plan.hideOnly.savings,
        final: plan.hideOnly.final,
      }),
    )
  } else {
    console.log(dim(t("plan.hideNone")))
  }
  console.log("")

  console.log(bold(t("plan.recTitle")))
  console.log(
    t("plan.recLine", {
      trims: plan.trim.count,
      hides: plan.recommended.hides.length,
      final: plan.recommended.final,
      savings: plan.recommended.savings,
    }),
  )
  for (const item of plan.recommended.hides) {
    console.log(dim(t("plan.hideItem", { id: item.id, tokens: item.tokens })))
  }
  if (plan.recommended.hidesEverything) console.log(yellow(t("plan.hidesAll")))
  sessionLine(plan.recommended.savings)
  console.log("")
  console.log(dim(t("plan.next")))
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
    prune: options.prune,
    t,
  })

  if (options.json) {
    console.log(JSON.stringify({ lockPath, checkOnly: options.checkOnly, prune: options.prune, results }, null, 2))
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
    if (result.removedFiles.length) console.log(dim(t("update.removedFiles", { count: result.removedFiles.length })))
    if (result.pruned.length) {
      console.log(yellow(t("update.pruned", { count: result.pruned.length, names: result.pruned.join(", ") })))
    } else if (result.orphaned.length) {
      console.log(yellow(t("update.orphaned", { count: result.orphaned.length })))
    }
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

function runFix(audit, options, t) {
  const { plan, skipped, skippedGlobal } = planFixes(audit.skills, audit.managed, { includeGlobal: options.all })
  const archived = applyFixes(plan, { dryRun: options.dryRun })
  const hideCandidates = options.all ? audit.skills : audit.skills.filter((s) => s.source.scope !== "global")
  const hidden = options.hide.length
    ? hideSkills(hideCandidates, options.hide, { dryRun: options.dryRun })
    : { changed: [], errors: [], missing: [] }

  const errors = [...archived.errors, ...hidden.errors]

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          tool: "skills-doctor",
          version: pkg.version,
          lang: audit.lang,
          dryRun: options.dryRun,
          all: options.all,
          archived: archived.moved.map((m) => ({ id: m.id, from: m.from, to: m.target })),
          hidden: hidden.changed,
          skipped: skipped.map((s) => ({ id: s.id, file: s.file })),
          skippedGlobal: skippedGlobal.map((s) => ({ id: s.id, file: s.file })),
          missing: hidden.missing,
          errors: errors.map((e) => ({ id: e.id, error: e.error })),
        },
        null,
        2,
      ),
    )
    return errors.length ? 1 : 0
  }

  const nothing =
    !plan.length && !skipped.length && !skippedGlobal.length && !hidden.changed.length && !hidden.missing.length
  if (nothing) {
    console.log(bold(t("fix.title")))
    console.log(`  ${t("fix.none")}`)
    return 0
  }

  console.log(bold(t("fix.title")))
  if (options.dryRun) console.log(dim(t("fix.dryRun")))
  for (const item of archived.moved) console.log(green(t("fix.moved", { from: item.from, to: item.target })))
  for (const item of hidden.changed) console.log(green(t("fix.hidden", { id: item.id, file: item.file })))
  for (const item of skipped) console.log(dim(t("fix.skippedManaged", { path: item.file })))
  for (const item of skippedGlobal) console.log(dim(t("fix.skippedGlobal", { path: item.file })))
  for (const id of hidden.missing) console.log(yellow(t("fix.unknownHide", { id })))
  for (const item of errors) console.log(red(t("fix.error", { path: item.file ?? item.from, error: item.error })))
  console.log("")
  console.log(
    t("fix.summary", {
      moved: archived.moved.length,
      hidden: hidden.changed.length,
      skipped: skipped.length + skippedGlobal.length,
    }),
  )
  console.log(dim(t("fix.rerun")))
  return errors.length ? 1 : 0
}

async function maybeNotifyUpdate({ options, config, t }) {
  if (!options.updateCheck) return
  if (options.json || !process.stdout.isTTY || process.env.CI) return
  const mode = resolveMode(config)
  if (mode === "off") return
  const update = await checkForUpdate({ current: pkg.version, mode })
  if (!update) return
  console.log("")
  console.log(
    dim(
      t("update.toolAvailable", {
        latest: update.latest,
        current: pkg.version,
        cmd: "npx opencode-skills-doctor@latest check",
        url: update.url,
      }),
    ),
  )
  if (mode === "open") openReleasePage({ url: update.url })
}

export async function main(argv) {
  const options = parseArgs(argv)

  if (options.lang && !normalizeLang(options.lang)) {
    console.error(`unsupported --lang: ${options.lang} (expected en or zh)`)
    process.exit(2)
  }

  const cwd = path.resolve(options.root)
  const loaded = loadConfig(cwd, options.config)
  const lang = normalizeLang(options.lang) ?? normalizeLang(loaded.config.lang) ?? detectLang()
  const t = translator(lang)

  if (options.help || options.command === "help") {
    console.log(t("help", { version: pkg.version }))
    return
  }
  if (options.version) {
    console.log(pkg.version)
    return
  }

  if (options.command === "mcp") {
    startMcpServer({ version: pkg.version })
    return
  }

  if (options.command === "install") {
    const result = installOpenCode({
      configDir: options.configDir ?? undefined,
      dryRun: options.dryRun,
      installPackage: !options.noNpm,
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(bold(t("install.title")))
      console.log(dim(t("install.version", { version: result.version ?? "unknown" })))
      console.log(dim(t("install.configDir", { dir: result.configDir })))
      if (result.dryRun) console.log(dim(t("install.dryRun")))
      for (const action of result.actions) console.log(`  · ${action}`)
      for (const error of result.errors) console.log(red(t("install.error", { error })))
      console.log("")
      console.log(result.errors.length ? red(t("install.failed")) : dim(t("install.next")))
    }
    process.exitCode = result.errors.length ? 1 : 0
    return
  }

  if (options.command === "uninstall") {
    const result = uninstallOpenCode({
      configDir: options.configDir ?? undefined,
      dryRun: options.dryRun,
      removePackage: !options.noNpm,
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(bold(t("uninstall.title")))
      console.log(dim(t("install.version", { version: result.version ?? "unknown" })))
      console.log(dim(t("install.configDir", { dir: result.configDir })))
      if (result.dryRun) console.log(dim(t("install.dryRun")))
      for (const action of result.actions) console.log(`  · ${action}`)
      for (const error of result.errors) console.log(red(t("install.error", { error })))
      console.log("")
      console.log(result.errors.length ? red(t("install.failed")) : dim(t("uninstall.next")))
    }
    process.exitCode = result.errors.length ? 1 : 0
    return
  }

  if (options.command === "upgrade") {
    const update = await checkForUpdate({ current: pkg.version, force: true })
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            current: pkg.version,
            latest: update?.latest ?? pkg.version,
            updateAvailable: Boolean(update),
            url: update?.url ?? RELEASES_URL,
            command: upgradeCommand(),
          },
          null,
          2,
        ),
      )
    } else {
      console.log(bold(t("upgrade.title")))
      console.log(dim(t("upgrade.current", { version: pkg.version })))
      if (update) {
        console.log(t("upgrade.available", { latest: update.latest, current: pkg.version }))
        console.log(dim(t("upgrade.command", { cmd: upgradeCommand() })))
        console.log(dim(t("upgrade.open", { url: update.url })))
        if (options.open) openReleasePage({ url: update.url })
        if (options.apply) {
          if (applyUpgrade()) console.log(green(t("upgrade.done")))
          else {
            console.log(red(t("upgrade.failed", { cmd: upgradeCommand() })))
            process.exitCode = 1
          }
        }
      } else {
        console.log(green(t("upgrade.upToDate")))
      }
    }
    return
  }

  if (options.command === "plan") {
    const audit = auditSkills({
      cwd,
      includeGlobal: options.global,
      lang,
      configPath: options.config,
      budget: options.budget,
      staleDays: options.staleDays,
    })
    const plan = planBudget(audit, { descTarget: options.descTarget, steps: options.steps })
    if (options.json) console.log(JSON.stringify(plan, null, 2))
    else printPlan(plan, t)
    return
  }

  if (options.command === "check") {
    const audit = auditSkills({
      cwd,
      includeGlobal: options.global,
      lang,
      configPath: options.config,
      budget: options.budget,
      staleDays: options.staleDays,
    })
    const result = buildCheckResult(audit, options)

    let htmlPath = null
    if (options.html) {
      htmlPath = writeHtmlReport(audit, options.html)
      if (options.open) openReport(htmlPath)
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          { ...result, html: htmlPath, skills: serializeSkills(audit.skills, audit.managed) },
          null,
          2,
        ),
      )
    } else {
      printCheck(audit, result, options, t)
      if (htmlPath) console.log(dim(t("check.htmlSaved", { path: htmlPath })))
      await maybeNotifyUpdate({ options, config: loaded.config, t })
    }
    process.exitCode = result.exitCode
    return
  }

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
    await maybeNotifyUpdate({ options, config: loaded.config, t })
    return
  }

  if (options.command === "update") {
    process.exitCode = await runUpdate(discovered, options, cwd, t)
    return
  }

  if (options.command === "fix") {
    const audit = auditSkills({
      cwd,
      includeGlobal: options.global,
      lang,
      configPath: options.config,
      budget: options.budget,
      staleDays: options.staleDays,
    })
    process.exitCode = runFix(audit, options, t)
  }
}
