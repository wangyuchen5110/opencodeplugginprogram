import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { parseFrontmatter, estimateTokens, sha1 } from "./parse.mjs"

const CONFIG_FILES = ["opencode.jsonc", "opencode.json"]
const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", ".venv", "__pycache__"])

export function expandHome(p, home = os.homedir()) {
  if (p === "~") return home
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2))
  return p
}

/** 去掉 JSONC 的注释和尾逗号，字符串内的内容不动。 */
export function stripJsonc(text) {
  let out = ""
  let inString = false
  let escaped = false
  let inLine = false
  let inBlock = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inLine) {
      if (ch === "\n") {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "/" && next === "/") {
      inLine = true
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      i++
      continue
    }
    out += ch
  }

  return out.replace(/,(\s*[}\]])/g, "$1")
}

export function readJsoncFile(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")
  return JSON.parse(stripJsonc(text))
}

export function findProjectRoot(start) {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** root 到 cwd 的路径链（远端在前，cwd 在最后）。 */
export function pathChain(root, cwd) {
  const stop = path.resolve(root)
  const start = path.resolve(cwd)
  const rel = path.relative(stop, start)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return [start]

  const chain = []
  let dir = start
  for (;;) {
    chain.push(dir)
    if (dir === stop) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return chain.reverse()
}

function configCandidates(dir) {
  return CONFIG_FILES.map((name) => path.join(dir, name))
}

function isUnder(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/**
 * 返回 skill 来源（顺序即优先级，越后越高）。这是多个 agent 的并集，
 * 不同 agent 的真实优先级可能不同（Grok 的 local 最高，OpenCode 的 config 最高）：
 *  1. ~/.claude/skills
 *  2. 项目 .claude/skills（远端 → cwd）
 *  3. ~/.agents/skills
 *  4. 项目 .agents/skills（远端 → cwd）
 *  5. ~/.cursor/skills
 *  6. 项目 .cursor/skills
 *  7. ~/.grok/skills
 *  8. 项目 .grok/skills
 *  9. ~/.config/opencode/skills
 * 10. 项目 .opencode/skills（项目根 → cwd）
 * 11. opencode.json(c) 里的 skills 数组 / skills.paths
 */
export function discoverSources({ cwd = process.cwd(), home = os.homedir(), includeGlobal = true } = {}) {
  const projectRoot = findProjectRoot(cwd) ?? path.resolve(cwd)
  const projectChain = pathChain(projectRoot, cwd)
  const sources = []
  const catalogs = []
  const missing = []
  const seen = new Set()

  const addSource = (kind, scope, dir) => {
    const abs = path.resolve(dir)
    if (seen.has(abs)) return
    seen.add(abs)
    sources.push({ kind, scope, dir: abs, order: sources.length })
  }

  if (includeGlobal) addSource("claude-global", "global", path.join(home, ".claude", "skills"))
  for (const dir of projectChain) addSource("claude-project", "project", path.join(dir, ".claude", "skills"))

  if (includeGlobal) addSource("agents-global", "global", path.join(home, ".agents", "skills"))
  for (const dir of projectChain) addSource("agents-project", "project", path.join(dir, ".agents", "skills"))

  if (includeGlobal) addSource("cursor-global", "global", path.join(home, ".cursor", "skills"))
  for (const dir of projectChain) addSource("cursor-project", "project", path.join(dir, ".cursor", "skills"))

  if (includeGlobal) addSource("grok-global", "global", path.join(home, ".grok", "skills"))
  for (const dir of projectChain) addSource("grok-project", "project", path.join(dir, ".grok", "skills"))

  if (includeGlobal) addSource("opencode-global", "global", path.join(home, ".config", "opencode", "skills"))
  for (const dir of projectChain) addSource("opencode-project", "project", path.join(dir, ".opencode", "skills"))

  const configFiles = []
  if (includeGlobal) {
    for (const file of configCandidates(path.join(home, ".config", "opencode"))) {
      if (fs.existsSync(file)) configFiles.push(file)
    }
  }
  for (const dir of projectChain) {
    for (const file of configCandidates(dir)) {
      if (fs.existsSync(file)) configFiles.push(file)
    }
  }

  for (const file of configFiles) {
    let config
    try {
      config = readJsoncFile(file)
    } catch (err) {
      missing.push({ kind: "config-error", path: file, error: err.message })
      continue
    }
    // 2.x: skills: [...]；1.x: skills: { paths: [...] }
    const entries = Array.isArray(config?.skills)
      ? config.skills
      : Array.isArray(config?.skills?.paths)
        ? config.skills.paths
        : []
    for (const entry of entries) {
      if (typeof entry !== "string" || !entry.trim()) continue
      const value = entry.trim()
      if (/^https?:\/\//i.test(value)) {
        catalogs.push({ url: value, config: file })
        continue
      }
      const expanded = expandHome(value, home)
      const abs = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded)
      if (fs.existsSync(abs)) {
        addSource("config-path", isUnder(projectRoot, file) ? "project" : "global", abs)
      } else missing.push({ kind: "missing-path", path: abs, entry: value, config: file })
    }
  }

  return { sources, catalogs, missing, configs: configFiles, projectRoot }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function isSkippable(name) {
  return name.startsWith(".") || SKIP_DIRS.has(name)
}

/** 跟随符号链接判断实际类型；坏链接返回 "broken"。 */
function direntKind(fullPath, entry) {
  if (entry.isSymbolicLink()) {
    try {
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) return "dir"
      if (stat.isFile()) return "file"
      return "other"
    } catch {
      return "broken"
    }
  }
  if (entry.isDirectory()) return "dir"
  if (entry.isFile()) return "file"
  return "other"
}

function walkForSkillMd(dir, source, out, depth, seen) {
  if (depth > 8) return
  let real
  try {
    real = fs.realpathSync(dir)
  } catch {
    return
  }
  if (seen.has(real)) return
  seen.add(real)

  for (const entry of safeReaddir(dir)) {
    if (isSkippable(entry.name)) continue
    const full = path.join(dir, entry.name)
    const kind = direntKind(full, entry)
    if (kind === "dir") {
      walkForSkillMd(full, source, out, depth + 1, seen)
    } else if (kind === "file" && entry.name === "SKILL.md") {
      out.push(buildSkill({ id: path.basename(dir), file: full, source, form: "dir" }))
    }
  }
}

function buildSkill({ id, file, source, form }) {
  let text = ""
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    text = ""
  }
  const { data, body, hasFrontmatter } = parseFrontmatter(text)
  const startsWithFence = /^---\r?\n/.test(text)
  const frontmatterBroken = startsWithFence && !hasFrontmatter
  const frontmatterInvalid =
    hasFrontmatter &&
    ((data.name !== undefined && typeof data.name !== "string") ||
      (data.description !== undefined && typeof data.description !== "string") ||
      (data.metadata !== undefined && (typeof data.metadata !== "object" || data.metadata === null)))
  const autoinvoke = data?.metadata?.["opencode/autoinvoke"]
  const disabled = data?.["disable-model-invocation"]
  const description = typeof data.description === "string" ? data.description.trim() : ""
  const displayName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : id
  const hidden = autoinvoke === false || disabled === true
  let mtime = 0
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch {}

  return {
    id,
    form,
    file,
    source,
    order: source.order,
    displayName,
    description,
    autoinvoke,
    disabled,
    hidden,
    advertised: Boolean(description) && !hidden,
    hasFrontmatter,
    frontmatterBroken,
    frontmatterInvalid,
    body,
    bodyChars: body.trim().length,
    bodyTokens: estimateTokens(body),
    bytes: Buffer.byteLength(text),
    descriptionTokens: estimateTokens(description),
    hash: sha1(body.replace(/\s+/g, " ").trim()),
    mtime,
  }
}

export function scanSource(source) {
  if (!fs.existsSync(source.dir)) return { source, skills: [], exists: false }
  const stat = fs.statSync(source.dir)
  if (!stat.isDirectory()) return { source, skills: [], exists: false }

  const skills = []
  for (const entry of safeReaddir(source.dir)) {
    if (isSkippable(entry.name)) continue
    const full = path.join(source.dir, entry.name)
    const kind = direntKind(full, entry)
    if (kind === "file" && /\.md$/i.test(entry.name)) {
      const id = entry.name.replace(/\.md$/i, "")
      skills.push(buildSkill({ id, file: full, source, form: "flat" }))
    } else if (kind === "dir") {
      walkForSkillMd(full, source, skills, 1, new Set())
    }
  }
  return { source, skills, exists: true }
}

export function scanAll(discovered) {
  const scans = discovered.sources.map(scanSource)
  return {
    ...discovered,
    scans,
    skills: scans.flatMap((s) => s.skills),
  }
}
