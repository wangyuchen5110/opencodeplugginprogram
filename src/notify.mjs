import { auditSkills, formatChat } from "./audit.mjs"

const settled = new Set()
const visible = new Set()

function keyOf(cwd, sessionID) {
  return `${cwd}::${sessionID}`
}

/** 这条会话里，用户已经能在时间线上看到通知。 */
export function chatNoticeVisible(cwd, sessionID) {
  return visible.has(keyOf(cwd, sessionID))
}

/**
 * 往 OpenCode 会话里发一条用户能看见的通知。
 * 带 description 的 synthetic 会单独出现在对话里；resume 为 false 时不另开一轮模型。
 * 每个会话最多自动发一次。force 用于用户明确执行了 /skills-doctor。
 */
export async function postChatNotice({
  sessionID,
  cwd = process.cwd(),
  includeGlobal = true,
  synthetic,
  resume = false,
  force = false,
  when = "problems",
} = {}) {
  if (!sessionID || typeof synthetic !== "function") return null
  const key = keyOf(cwd, sessionID)
  if (!force && settled.has(key)) return null

  const audit = auditSkills({ cwd, includeGlobal })
  const notable = audit.findings.some((finding) => finding.severity === "error" || finding.severity === "warn")
  if (when === "problems" && !notable) {
    settled.add(key)
    return null
  }

  const text = formatChat(audit)
  try {
    await synthetic({
      sessionID,
      text,
      description: "skills-doctor",
      resume,
    })
  } catch {
    if (!force) settled.add(key)
    return null
  }

  settled.add(key)
  visible.add(key)
  return text
}

/** 测试用。 */
export function resetChatNotices() {
  settled.clear()
  visible.clear()
}
