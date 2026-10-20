import { auditSkills } from "./audit.mjs"

const cache = new Map()
const warned = new Set()

/**
 * 每个会话最多注入一次「skill 预算超标」提醒。
 * 只在存在 error（默认预算超标 2 倍）时提醒，避免刷屏。
 */
export function budgetWarning({ cwd = process.cwd(), sessionID = "global", ttlMs = 60000, includeGlobal = true } = {}) {
  const key = `${cwd}::${sessionID}`
  if (warned.has(key)) return null

  const now = Date.now()
  let entry = cache.get(cwd)
  if (!entry || now - entry.at > ttlMs) {
    const audit = auditSkills({ cwd, includeGlobal })
    const over = audit.counts.errors > 0
    entry = {
      at: now,
      text: over
        ? `[skills-doctor] ${audit.summary.unique} skills use ~${audit.summary.advertisedTokens} tokens of descriptions per step (budget ${audit.budget}); ${audit.counts.errors} error(s), ${audit.counts.warnings} warning(s). Use the skills_doctor tool for details, then hide low-frequency skills with \`skills-doctor fix --hide <ids>\`.`
        : null,
    }
    cache.set(cwd, entry)
  }

  if (!entry.text) return null
  warned.add(key)
  return entry.text
}

/** 测试用：清空缓存与已提醒集合。 */
export function resetWarningState() {
  cache.clear()
  warned.clear()
}
