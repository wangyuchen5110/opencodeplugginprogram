import { estimateTokens } from "./parse.mjs"
import { translator } from "./i18n.mjs"

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 }

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NEAR_DUPLICATE_THRESHOLD = 0.75

function tokenSet(text) {
  const tokens = String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
  return new Set(tokens)
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

function byId(skills) {
  const map = new Map()
  for (const skill of skills) {
    if (!map.has(skill.id)) map.set(skill.id, [])
    map.get(skill.id).push(skill)
  }
  return map
}

/** 每个 ID 的实际生效定义（注册顺序越后优先级越高；同序时 SKILL.md 目录形式优先）。 */
export function resolveWinners(skills) {
  const winners = new Map()
  for (const skill of skills) {
    const current = winners.get(skill.id)
    const better =
      !current ||
      skill.order > current.order ||
      (skill.order === current.order && skill.form === "dir" && current.form !== "dir")
    if (better) winners.set(skill.id, skill)
  }
  return winners
}

export function lint(skills, options = {}) {
  const t = options.t ?? translator("en")
  const budget = options.budget ?? 1200
  const staleDays = options.staleDays ?? 0
  const now = options.now ?? Date.now()
  const findings = []
  const add = (rule, severity, message, extra = {}) => findings.push({ rule, severity, message, ...extra })

  const winners = resolveWinners(skills)

  // 1) 同一 ID 多处定义 → 遮蔽
  for (const [id, defs] of byId(skills)) {
    if (defs.length <= 1) continue
    const winner = winners.get(id)
    const losers = defs.filter((d) => d !== winner)
    add(
      "shadowed",
      "warn",
      t("lint.shadowed", {
        id,
        count: defs.length,
        winner: winner.file,
        losers: losers.length,
      }),
      { skills: [id], files: defs.map((d) => d.file) },
    )

    const flat = defs.filter((d) => d.form === "flat")
    const dirs = defs.filter((d) => d.form === "dir")
    for (const f of flat) {
      for (const d of dirs) {
        if (f.source.dir !== d.source.dir) continue
        add("flat-dir-collision", "warn", t("lint.flatDirCollision", { flat: f.file, dir: d.file, id }), {
          skills: [id],
          files: [f.file, d.file],
        })
      }
    }
  }

  // 2) 正文完全重复
  const byHash = new Map()
  for (const skill of skills) {
    if (!byHash.has(skill.hash)) byHash.set(skill.hash, [])
    byHash.get(skill.hash).push(skill)
  }
  let dupGroups = 0
  for (const [, group] of byHash) {
    const ids = [...new Set(group.map((s) => s.id))]
    if (ids.length <= 1) continue
    dupGroups++
    if (dupGroups > 10) break
    add("duplicate-content", "warn", t("lint.duplicateContent", { ids: ids.join(", ") }), { skills: ids })
  }

  // 3) 单条检查
  for (const skill of skills) {
    if (!skill.description) {
      add("missing-description", "info", t("lint.missingDescription", { id: skill.id }), { skills: [skill.id] })
    } else if (skill.description.length > 240) {
      add("long-description", "warn", t("lint.longDescription", { id: skill.id, chars: skill.description.length }), {
        skills: [skill.id],
      })
    }

    if (skill.hidden) {
      add("hidden-skill", "info", t("lint.hiddenSkill", { id: skill.id }), { skills: [skill.id] })
    }

    if (!ID_PATTERN.test(skill.id) || skill.id.length > 64) {
      add("invalid-id", "info", t("lint.invalidId", { id: skill.id }), { skills: [skill.id] })
    }

    if (skill.bodyTokens > 4000) {
      add("large-body", "warn", t("lint.largeBody", { id: skill.id, tokens: skill.bodyTokens }), {
        skills: [skill.id],
      })
    }

    if (staleDays > 0 && skill.mtime > 0 && now - skill.mtime > staleDays * 86400000) {
      const days = Math.round((now - skill.mtime) / 86400000)
      add("stale-skill", "info", t("lint.staleSkill", { id: skill.id, days }), { skills: [skill.id] })
    }
  }

  // 4) 上下文预算（只算会被模型看到的）
  const advertised = [...winners.values()].filter((s) => s.advertised)
  const described = advertised.filter((s) => s.description)
  const advertisedTokens = described.reduce(
    (sum, s) => sum + estimateTokens(`${s.id} ${s.displayName} ${s.description}`),
    0,
  )

  if (advertisedTokens > budget * 2) {
    add("token-budget", "error", t("lint.tokenBudgetError", { tokens: advertisedTokens, budget }), {
      value: advertisedTokens,
    })
  } else if (advertisedTokens > budget) {
    add("token-budget", "warn", t("lint.tokenBudget", { tokens: advertisedTokens, budget }), {
      value: advertisedTokens,
    })
  }

  if (advertised.length > 100) {
    add("too-many-skills", "error", t("lint.tooManySkills", { count: advertised.length }), {
      value: advertised.length,
    })
  } else if (advertised.length > 60) {
    add("too-many-skills", "warn", t("lint.tooManySkills", { count: advertised.length }), {
      value: advertised.length,
    })
  }

  // 5) 描述近似（token 集合只算一次；先按集合大小做 0.75 上界预筛）
  const withDesc = described.map((skill) => ({ skill, tokens: tokenSet(skill.description) }))
  const pairs = []
  for (let i = 0; i < withDesc.length; i++) {
    for (let j = i + 1; j < withDesc.length; j++) {
      const a = withDesc[i]
      const b = withDesc[j]
      if (a.skill.id === b.skill.id) continue
      const min = Math.min(a.tokens.size, b.tokens.size)
      const max = Math.max(a.tokens.size, b.tokens.size)
      // Jaccard ≤ min/max，所以比值低于阈值时不可能达到阈值
      if (!min || min / max < NEAR_DUPLICATE_THRESHOLD) continue
      const score = jaccard(a.tokens, b.tokens)
      if (score >= NEAR_DUPLICATE_THRESHOLD) pairs.push({ a: a.skill.id, b: b.skill.id, score })
    }
  }
  for (const pair of pairs.slice(0, 15)) {
    add(
      "near-duplicate-description",
      "warn",
      t("lint.nearDuplicate", { a: pair.a, b: pair.b, score: (pair.score * 100).toFixed(0) }),
      { skills: [pair.a, pair.b] },
    )
  }

  return applyOverrides(findings, options)
}

const SEVERITIES = new Set(["error", "warn", "info"])

function applyOverrides(findings, options) {
  const overrides = options.ruleOverrides ?? {}
  const ignore = new Set(options.ignore ?? [])

  const result = []
  for (const finding of findings) {
    const override = overrides[finding.rule]
    if (override === "off") continue
    const severity = SEVERITIES.has(override) ? override : finding.severity
    if (ignore.size && Array.isArray(finding.skills) && finding.skills.every((id) => ignore.has(id))) {
      if (severity !== "error") continue
    }
    result.push(severity === finding.severity ? finding : { ...finding, severity })
  }

  return result.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity])
}

export function summarize(skills) {
  const winners = resolveWinners(skills)
  const advertised = [...winners.values()].filter((s) => s.advertised)
  return {
    total: skills.length,
    unique: winners.size,
    advertised: advertised.length,
    hidden: [...winners.values()].filter((s) => s.hidden).length,
    shadowed: skills.length - winners.size,
    advertisedTokens: advertised
      .filter((s) => s.description)
      .reduce((sum, s) => sum + estimateTokens(`${s.id} ${s.displayName} ${s.description}`), 0),
    bodyTokens: skills.reduce((sum, s) => sum + s.bodyTokens, 0),
  }
}
