const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:|#|\/|~)/i
const GLOB_LIKE = /[*?[\]{}]/

function cleanTarget(raw) {
  let target = String(raw ?? "").trim()
  if (!target) return null
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1).trim()
  target = target.split("#")[0].split("?")[0].trim()
  if (!target) return null
  return target
}

/**
 * 从 SKILL.md 正文里提取「看起来是相对文件路径」的引用：
 * - markdown 链接 [x](path)
 * - 行内代码 `references/foo.md`
 * 跳过 URL、绝对路径、~/、占位符、glob。
 */
export function extractReferences(body) {
  const refs = new Set()

  const add = (raw) => {
    let target = cleanTarget(raw)
    if (!target) return
    if (URL_LIKE.test(target)) return
    if (GLOB_LIKE.test(target)) return
    if (target.includes("<") || target.includes(">") || target.includes("${")) return
    if (target.startsWith("$") || target.startsWith("-")) return
    if (/\s/.test(target)) return

    const looksLikePath = target.includes("/") || /\.(md|markdown|sh|bash|py|ts|js|mjs|cjs|json|ya?ml|toml|txt|svg|png|jpe?g|gif|webp|csv)$/i.test(target)
    if (!looksLikePath) return
    refs.add(target)
  }

  for (const match of String(body ?? "").matchAll(/\]\(\s*([^)\s]+)\s*\)/g)) add(match[1])
  for (const match of String(body ?? "").matchAll(/`([^`\n]+)`/g)) add(match[1])

  return [...refs]
}
