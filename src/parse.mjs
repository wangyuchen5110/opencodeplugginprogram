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

/** 粗略 token 估算：CJK 约 1.7 字/token，其余约 4 字符/token。按码元计数，和旧的正则结果一致。 */
export function estimateTokens(text) {
  const str = String(text ?? "")
  let cjk = 0
  for (let i = 0; i < str.length; i++) if (isCjkUnit(str.charCodeAt(i))) cjk++
  return Math.ceil(cjk * 1.7 + (str.length - cjk) / 4)
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
