import { estimateTokens } from "./parse.mjs"

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

/** 每个 ID 的实际生效定义（注册顺序越后优先级越高）。 */
export function resolveWinners(skills) {
  const winners = new Map()
  for (const skill of skills) {
    const current = winners.get(skill.id)
    if (!current || skill.order >= current.order) winners.set(skill.id, skill)
  }
  return winners
}

export function lint(skills, options = {}) {
  const budget = options.budget ?? 1200
  const staleDays = options.staleDays ?? 0
  const now = options.now ?? Date.now()
  const findings = []
  const add = (rule, severity, message, extra = {}) => findings.push({ rule, severity, message, ...extra })

  // 1) 同一 ID 多处定义 → 遮蔽
  for (const [id, defs] of byId(skills)) {
    if (defs.length <= 1) continue
    const winner = defs.slice().sort((a, b) => b.order - a.order)[0]
    const losers = defs.filter((d) => d !== winner)
    add("shadowed", "warn", `ID "${id}" 有 ${defs.length} 处定义，实际生效的是 ${winner.file}；其余 ${losers.length} 处被遮蔽（白占体积、容易改错文件）`, {
      skills: [id],
      files: defs.map((d) => d.file),
    })

    const flat = defs.filter((d) => d.form === "flat")
    const dirs = defs.filter((d) => d.form === "dir")
    for (const f of flat) {
      for (const d of dirs) {
        if (f.source.dir !== d.source.dir) continue
        add("flat-dir-collision", "warn", `同一来源同时存在 ${f.file} 与 ${d.file}（ID 都是 "${id}"），语义不明确`, {
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
    add("duplicate-content", "warn", `这些 skill 的正文完全相同：${ids.join(", ")}`, { skills: ids })
  }

  // 3) 单条检查
  for (const skill of skills) {
    if (!skill.description) {
      add("missing-description", "info", `"${skill.id}" 没有 description，模型不会发现它（只能 @${skill.id} 手动加载）`, { skills: [skill.id] })
    } else if (skill.description.length > 240) {
      add("long-description", "warn", `"${skill.id}" 的 description 有 ${skill.description.length} 字符，每个模型步骤都会占上下文`, { skills: [skill.id] })
    }

    if (skill.hidden) {
      add("hidden-skill", "info", `"${skill.id}" 被隐藏（autoinvoke/disable-model-invocation），不会出现在模型列表里`, { skills: [skill.id] })
    }

    if (!ID_PATTERN.test(skill.id) || skill.id.length > 64) {
      add("invalid-id", "info", `"${skill.id}" 不符合推荐的 kebab-case ID 规范（1-64 字符、小写）`, { skills: [skill.id] })
    }

    if (skill.bodyTokens > 4000) {
      add("large-body", "warn", `"${skill.id}" 正文约 ${skill.bodyTokens} tokens，被调用时会整段塞进上下文`, { skills: [skill.id] })
    }

    if (staleDays > 0 && skill.mtime > 0 && now - skill.mtime > staleDays * 86400000) {
      const days = Math.round((now - skill.mtime) / 86400000)
      add("stale-skill", "info", `"${skill.id}" 已经 ${days} 天没有更新`, { skills: [skill.id] })
    }
  }

  // 4) 上下文预算（只算会被模型看到的）
  const winners = resolveWinners(skills)
  const advertised = [...winners.values()].filter((s) => s.advertised)
  const advertisedTokens = advertised.reduce(
    (sum, s) => sum + estimateTokens(`${s.id} ${s.displayName} ${s.description}`),
    0,
  )

  if (advertisedTokens > budget * 2) {
    add("token-budget", "error", `模型每步要看到的 skill 描述约 ${advertisedTokens} tokens，超过预算 ${budget} 的 2 倍`, {
      value: advertisedTokens,
    })
  } else if (advertisedTokens > budget) {
    add("token-budget", "warn", `模型每步要看到的 skill 描述约 ${advertisedTokens} tokens，超过预算 ${budget}`, {
      value: advertisedTokens,
    })
  }

  if (advertised.length > 100) {
    add("too-many-skills", "error", `有 ${advertised.length} 个 skill 会展示给模型（建议 ≤ 60）`, { value: advertised.length })
  } else if (advertised.length > 60) {
    add("too-many-skills", "warn", `有 ${advertised.length} 个 skill 会展示给模型（建议 ≤ 60）`, { value: advertised.length })
  }

  // 5) 描述近似
  const withDesc = advertised.filter((s) => s.description)
  const pairs = []
  for (let i = 0; i < withDesc.length; i++) {
    for (let j = i + 1; j < withDesc.length; j++) {
      const a = withDesc[i]
      const b = withDesc[j]
      if (a.id === b.id) continue
      const score = jaccard(tokenSet(a.description), tokenSet(b.description))
      if (score >= NEAR_DUPLICATE_THRESHOLD) pairs.push({ a: a.id, b: b.id, score })
    }
  }
  for (const pair of pairs.slice(0, 15)) {
    add("near-duplicate-description", "warn", `"${pair.a}" 与 "${pair.b}" 的描述相似度 ${(pair.score * 100).toFixed(0)}%，模型容易选错`, {
      skills: [pair.a, pair.b],
    })
  }

  return findings.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity])
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
    advertisedTokens: advertised.reduce(
      (sum, s) => sum + estimateTokens(`${s.id} ${s.displayName} ${s.description}`),
      0,
    ),
    bodyTokens: skills.reduce((sum, s) => sum + s.bodyTokens, 0),
  }
}
