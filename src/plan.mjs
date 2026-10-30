import { estimateTokens } from "./parse.mjs"
import { resolveWinners } from "./lint.mjs"

export const DEFAULT_DESC_TARGET = 160
export const DEFAULT_STEPS = 100

function costOf(skill, description = skill.description) {
  return estimateTokens(`${skill.id} ${skill.displayName} ${description}`)
}

/**
 * 把 description 截到目标长度，优先在句子边界断开（中英文标点都算）。
 * 纯函数：相同输入永远得到相同输出，便于在报告里预览「如果这么改会省多少」。
 */
export function trimDescription(text, limit = DEFAULT_DESC_TARGET) {
  const value = String(text ?? "")
  if (value.length <= limit) return value
  const slice = value.slice(0, limit)
  const cut = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("."),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("？"),
    slice.lastIndexOf("；"),
    slice.lastIndexOf(";"),
    slice.lastIndexOf("\n"),
  )
  const trimmed = cut >= limit * 0.5 ? value.slice(0, cut + 1).trim() : slice.trim()
  return trimmed || slice.trim()
}

/** 在候选中选「数量最少」的一组，使节省量 ≥ gap；按单项节省降序取前缀即为最优。 */
function pickMinimal(items, gap) {
  if (gap <= 0) return { count: 0, savings: 0, items: [], enough: true }
  const sorted = [...items].sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id))
  const picked = []
  let savings = 0
  for (const item of sorted) {
    if (savings >= gap) break
    picked.push(item)
    savings += item.tokens
  }
  return { count: picked.length, savings, items: picked, enough: savings >= gap }
}

/**
 * 预算规划：当前每步消耗多少、精简到多少、隐藏多少、最终能省多少。
 *
 * 规则：
 * - 只有会被「展示给模型」的定义才有成本；被遮蔽的重复定义省不出 token（诚实很重要）。
 * - 精简 description 不改变可发现性；隐藏（autoinvoke: false）省掉整条成本，但仍可用 @id 加载。
 * - 推荐方案先精简所有超长描述，再按「单项节省最大」贪心隐藏，直到进入预算。
 *   被隐藏的技能若也被精简过，其节省按原始成本计，不会重复计算。
 */
export function planBudget(
  audit,
  { budget = audit.budget, descTarget = DEFAULT_DESC_TARGET, steps = DEFAULT_STEPS } = {},
) {
  const target = Number.isFinite(budget) && budget > 0 ? budget : audit.budget
  const winners = [...resolveWinners(audit.skills).values()]
  const advertised = winners.filter((skill) => skill.advertised)

  const current = advertised.reduce((sum, skill) => sum + costOf(skill), 0)
  const gap = Math.max(0, current - target)

  // 1) 精简：所有 description 超过目标的，按句子边界截断
  const trimMap = new Map()
  const trims = []
  for (const skill of advertised) {
    if (skill.description.length <= descTarget) continue
    const preview = trimDescription(skill.description, descTarget)
    const before = costOf(skill)
    const after = costOf(skill, preview)
    const saving = Math.max(0, before - after)
    if (!saving) continue
    trimMap.set(skill.id, { preview, cost: after })
    trims.push({
      id: skill.id,
      file: skill.file,
      before,
      after,
      saving,
      preview,
    })
  }
  trims.sort((a, b) => b.saving - a.saving || a.id.localeCompare(b.id))
  const trimSavings = trims.reduce((sum, item) => sum + item.saving, 0)

  // 2) 只隐藏（不精简）的方案
  const hideCandidates = advertised.map((skill) => ({
    id: skill.id,
    file: skill.file,
    tokens: costOf(skill),
  }))
  const hideOnly = pickMinimal(hideCandidates, gap)

  // 3) 推荐方案：先精简，再在「精简后的成本」上隐藏
  const afterTrim = advertised.map((skill) => ({
    id: skill.id,
    file: skill.file,
    tokens: trimMap.get(skill.id)?.cost ?? costOf(skill),
    originalTokens: costOf(skill),
  }))
  const postTrimTotal = afterTrim.reduce((sum, item) => sum + item.tokens, 0)
  const recommendedHides = pickMinimal(afterTrim, Math.max(0, postTrimTotal - target))
  const hideSavings = recommendedHides.savings
  const savings = trimSavings + hideSavings
  const final = Math.max(0, current - savings)

  return {
    cwd: audit.cwd,
    budget: target,
    descTarget,
    steps,
    current,
    gap,
    advertised: advertised.length,
    trim: {
      count: trims.length,
      savings: trimSavings,
      items: trims,
    },
    hideOnly: {
      count: hideOnly.count,
      savings: hideOnly.savings,
      final: Math.max(0, current - hideOnly.savings),
      enough: hideOnly.enough,
      items: hideOnly.items,
    },
    recommended: {
      trims: trims.map((item) => item.id),
      hides: recommendedHides.items,
      trimSavings,
      hideSavings,
      savings,
      final,
      reachable: final <= target,
      stepsSavings: savings * steps,
      hidesEverything: advertised.length > 0 && recommendedHides.count === advertised.length,
    },
  }
}
