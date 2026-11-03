import { advertisedStepTokens, distinctiveTokenSet } from "./parse.mjs"
import { resolveWinners } from "./lint.mjs"

export const DEFAULT_DESC_TARGET = 160
export const DEFAULT_STEPS = 100

function costOf(skill, description = skill.description) {
  return advertisedStepTokens(skill, description)
}

function firstSentenceEnd(value) {
  const match = /[.!?。！？]/.exec(value)
  return match ? match.index + 1 : -1
}

/**
 * 目录里只需要路由用的第一句。第一句放得进上限就只留它；
 * 第一句本身超长时，再在分句标点处断开，最后才按字符硬切。
 * 纯函数：相同输入永远得到相同输出。
 */
export function trimDescription(text, limit = DEFAULT_DESC_TARGET) {
  const value = String(text ?? "").trim()
  if (value.length <= limit) return value
  const sentenceEnd = firstSentenceEnd(value)
  if (sentenceEnd > 0 && sentenceEnd <= limit) return value.slice(0, sentenceEnd).trim()
  const slice = value.slice(0, limit)
  const cut = Math.max(
    slice.lastIndexOf("，"),
    slice.lastIndexOf(","),
    slice.lastIndexOf("；"),
    slice.lastIndexOf(";"),
    slice.lastIndexOf("、"),
    slice.lastIndexOf("\n"),
  )
  const trimmed = cut >= limit * 0.5 ? value.slice(0, cut).trim() : slice.trim()
  return trimmed || slice.trim()
}

/** 这条描述有多少已经被别的 skill 说过。1 = 触发词是别人的子集，0 = 完全独特。 */
function redundancyOf(id, sets) {
  const mine = sets.get(id)
  if (!mine || mine.size < 3) return 0.35
  let best = 0
  for (const [other, tokens] of sets) {
    if (other === id || !tokens?.size) continue
    let shared = 0
    for (const token of mine) if (tokens.has(token)) shared++
    const covered = shared / mine.size
    if (covered > best) best = covered
  }
  return best
}

/**
 * 选一组隐藏项盖住缺口。排序不是「谁最贵藏谁」，而是节省 × 重复度：
 * 触发词已经被别的 skill 覆盖的，优先藏；独特的留到最后。
 */
function pickPreserving(items, gap) {
  if (gap <= 0) return { count: 0, savings: 0, items: [], enough: true }
  const score = (item) => item.tokens * (0.15 + 0.85 * item.redundancy)
  const sorted = [...items].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
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
 * - 推荐方案先把超长描述收成第一句，再优先隐藏「触发词已经被别的 skill 覆盖」的条目。
 *   被隐藏的技能若也被精简过，其节省按精简后的成本计，不会把同一份 token 算两次。
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

  const tokenSets = new Map(advertised.map((skill) => [skill.id, distinctiveTokenSet(skill.description)]))

  // 2) 只隐藏（不精简）的方案。重复的先藏。
  const hideCandidates = advertised.map((skill) => ({
    id: skill.id,
    file: skill.file,
    tokens: costOf(skill),
    redundancy: redundancyOf(skill.id, tokenSets),
  }))
  const hideOnly = pickPreserving(hideCandidates, gap)

  // 3) 推荐方案：先精简，再在「精简后的成本」上按重复度隐藏
  const afterTrim = advertised.map((skill) => ({
    id: skill.id,
    file: skill.file,
    tokens: trimMap.get(skill.id)?.cost ?? costOf(skill),
    originalTokens: costOf(skill),
    redundancy: redundancyOf(skill.id, tokenSets),
  }))
  const postTrimTotal = afterTrim.reduce((sum, item) => sum + item.tokens, 0)
  const recommendedHides = pickPreserving(afterTrim, Math.max(0, postTrimTotal - target))
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
