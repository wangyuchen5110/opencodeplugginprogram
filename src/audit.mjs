import path from "node:path"
import { discoverSources, scanAll } from "./discover.mjs"
import { lint, summarize, SEVERITY_ORDER } from "./lint.mjs"
import { inspectManaged } from "./managed.mjs"
import { loadConfig } from "./config.mjs"
import { translator, normalizeLang, detectLang } from "./i18n.mjs"

/**
 * 一次完整审计：扫描来源 → 检测 → 托管校验。
 * CLI、插件、脚本共用同一个入口。
 */
export function auditSkills({
  cwd = process.cwd(),
  includeGlobal = true,
  lang = null,
  configPath = null,
  budget = null,
  staleDays = null,
} = {}) {
  const loaded = loadConfig(cwd, configPath)
  const config = loaded.config
  const resolvedLang = normalizeLang(lang) ?? normalizeLang(config.lang) ?? detectLang()
  const t = translator(resolvedLang)

  const discovered = scanAll(discoverSources({ cwd, includeGlobal }))
  const managedInfo = inspectManaged(discovered.scans, { t })

  const effectiveBudget = Number.isFinite(budget) && budget > 0 ? budget : config.budget ?? 1200
  const effectiveStale = Number.isFinite(staleDays) && staleDays >= 0 ? staleDays : config.staleDays ?? 0

  const findings = [
    ...lint(discovered.skills, {
      budget: effectiveBudget,
      staleDays: effectiveStale,
      ruleOverrides: config.rules,
      ignore: config.ignore,
      t,
    }),
    ...managedInfo.findings,
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  const summary = summarize(discovered.skills)
  const counts = {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warn").length,
    infos: findings.filter((f) => f.severity === "info").length,
  }

  return {
    cwd: path.resolve(cwd),
    projectRoot: discovered.projectRoot,
    lang: resolvedLang,
    config: { file: loaded.file, error: loaded.error ?? null, ...config },
    budget: effectiveBudget,
    staleDays: effectiveStale,
    sources: discovered.sources,
    catalogs: discovered.catalogs,
    missing: discovered.missing,
    skills: discovered.skills,
    managed: managedInfo.managed,
    summary,
    findings,
    counts,
  }
}

/** 把审计结果渲染成适合给 agent / PR 评论用的 markdown。 */
export function formatMarkdown(audit, { limit = 25 } = {}) {
  const lines = []
  lines.push("# skills-doctor")
  lines.push("")
  lines.push(`Workdir: \`${audit.cwd}\``)
  lines.push(
    `Skills: ${audit.summary.total} definitions, ${audit.summary.unique} unique IDs, ` +
      `${audit.summary.advertised} advertised, ~${audit.summary.advertisedTokens} description tokens (budget ${audit.budget})`,
  )
  lines.push("")

  if (!audit.findings.length) {
    lines.push("No problems found.")
    return lines.join("\n")
  }

  lines.push(`Findings: ${audit.counts.errors} error, ${audit.counts.warnings} warn, ${audit.counts.infos} info`)
  lines.push("")
  for (const finding of audit.findings.slice(0, limit)) {
    lines.push(`- **${finding.severity}** \`${finding.rule}\` — ${finding.message}`)
  }
  if (audit.findings.length > limit) lines.push(`- …and ${audit.findings.length - limit} more`)
  lines.push("")
  lines.push("Next: run `npx opencode-skills-doctor fix` to archive shadowed definitions, or hide low-frequency skills.")
  return lines.join("\n")
}
