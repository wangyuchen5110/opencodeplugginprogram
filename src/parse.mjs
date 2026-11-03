// 极简 frontmatter / YAML 子集解析 + 文本度量工具。
// 只服务 skills 场景：name、description、metadata.opencode/autoinvoke、
// disable-model-invocation 等，不追求完整 YAML。

import { createHash } from "node:crypto"

/** @param {string} text */
export function parseFrontmatter(text) {
  // A UTF-8 BOM (Windows editors add one) would otherwise hide the opening `---`
  // and make the whole skill look like it has no frontmatter.
  const source = String(text ?? "").replace(/^\uFEFF/, "")
  const empty = { data: {}, body: source, hasFrontmatter: false }
  if (!source.startsWith("---")) return empty

  const lines = source.split(/\r?\n/)
  if (lines[0].trim() !== "---") return empty

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i
      break
    }
  }
  if (end === -1) return empty

  return {
    data: parseYamlLite(lines.slice(1, end)),
    body: lines.slice(end + 1).join("\n"),
    hasFrontmatter: true,
  }
}

function leadingSpaces(line) {
  return line.length - line.replace(/^[ \t]*/, "").length
}

function coerce(value) {
  const v = value.trim()
  if (v === "true") return true
  if (v === "false") return false
  if (v === "null" || v === "~") return null
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).replace(/\\"/g, '"')
  }
  return v
}

/** @param {string[]} lines */
export function parseYamlLite(lines) {
  const root = {}
  const stack = [{ indent: -1, obj: root }]

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim() || raw.trim().startsWith("#")) continue

    const indent = leadingSpaces(raw)
    const content = raw.trim()

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].obj

    // key 不含冒号；value 可以含冒号（如 "Prepare: notes"）
    const m = /^([^:#]+?)\s*:\s*(.*)$/.exec(content)
    if (!m) continue
    const key = m[1].trim()
    const rest = m[2].trim()

    if (rest === "") {
      const child = {}
      parent[key] = child
      stack.push({ indent, obj: child })
      continue
    }

    // 块标量：| 或 >
    if (/^[|>][+-]?$/.test(rest)) {
      const block = []
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.trim() === "") {
          block.push("")
          j++
          continue
        }
        if (leadingSpaces(next) > indent) {
          block.push(next)
          j++
        } else break
      }
      const nonEmpty = block.filter((l) => l.trim())
      const minIndent = nonEmpty.length ? Math.min(...nonEmpty.map(leadingSpaces)) : 0
      const joined = block.map((l) => l.slice(minIndent)).join("\n")
      parent[key] = rest.startsWith(">") ? joined.replace(/\n+/g, " ").trim() : joined.trim()
      i = j - 1
      continue
    }

    parent[key] = coerce(rest)
  }

  return root
}

const CJK_CHAR = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/

function isCjkUnit(code) {
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

function isAsciiWord(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/** 一个英文词在 BPE 里通常是 1 个 token；超过 6 个字符后每 4 个字符再加 1。 */
function latinWordTokens(length) {
  if (length <= 6) return 1
  return 1 + Math.ceil((length - 6) / 4)
}

/**
 * 按词切分的 token 估算，比「字符数 / 4」接近模型的真实切法：
 * - 空白不计
 * - 每个 CJK 字符 1 token（Grok / Claude / GPT-4o 这一档）
 * - 英文词 1 token 起，长词和长标识符按每 4 个额外字符加 1
 * - 连字符会把标识符切开，标点各自计 1
 */
export function estimateTokens(text) {
  const str = String(text ?? "")
  let tokens = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code === 32 || code === 9 || code === 10 || code === 13) continue
    if (isCjkUnit(code)) {
      tokens++
      continue
    }
    if (isAsciiWord(code)) {
      let length = 0
      while (i < str.length && isAsciiWord(str.charCodeAt(i))) {
        length++
        i++
      }
      i--
      tokens += latinWordTokens(length)
      continue
    }
    tokens++
  }
  return tokens
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "to", "of", "for", "in", "on", "with", "when", "use", "using", "used",
  "this", "that", "skill", "skills", "user", "users", "want", "wants", "wanted", "please", "from", "into",
  "by", "as", "is", "are", "be", "it", "its", "their", "your", "you", "if", "then", "than", "via", "over",
  "about", "how", "what", "which", "can", "will", "just", "also", "not", "but", "at", "we", "our", "them",
  "的", "了", "和", "与", "或", "在", "为", "用", "使用", "当", "技能", "用户", "一个", "进行", "可以", "这个", "以及", "把", "将", "对", "从",
])

/**
 * 描述里真正用来路由的词。丢掉套话（use this skill when…）和过短的英文词。
 * 中文没有空格，用相邻二字作为特征，避免整句变成一个 token。
 */
export function distinctiveTokenSet(text) {
  const set = new Set()
  const str = String(text ?? "").toLowerCase()
  let prevCjk = ""
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (isCjkUnit(code)) {
      const ch = str[i]
      if (prevCjk && !STOPWORDS.has(prevCjk) && !STOPWORDS.has(ch)) set.add(prevCjk + ch)
      prevCjk = STOPWORDS.has(ch) ? "" : ch
      continue
    }
    prevCjk = ""
    if (!isAsciiWord(code)) continue
    let j = i
    while (j < str.length && isAsciiWord(str.charCodeAt(j))) j++
    const word = str.slice(i, j)
    if (word.length >= 3 && !STOPWORDS.has(word)) set.add(word)
    i = j - 1
  }
  return set
}

/**
 * 一条会被展示给模型的 skill，每步付出的描述 token。
 * 扫描时已经算过的 `stepTokens` 直接复用；description 被改写（例如精简预览）时重算。
 */
export function advertisedStepTokens(skill, description = skill?.description ?? "") {
  if (skill && description === skill.description && Number.isFinite(skill.stepTokens)) return skill.stepTokens
  return estimateTokens(`${skill?.id ?? ""} ${skill?.displayName ?? ""} ${description}`)
}

/** 终端显示宽度（CJK 记 2 列） */
export function displayWidth(text) {
  let width = 0
  for (const ch of String(text ?? "")) {
    width += CJK_CHAR.test(ch) ? 2 : 1
  }
  return width
}

export function padDisplay(text, width) {
  const str = String(text ?? "")
  const diff = width - displayWidth(str)
  return diff > 0 ? str + " ".repeat(diff) : str
}

/** @param {string} text */
export function sha1(text) {
  return createHash("sha1").update(text).digest("hex")
}
