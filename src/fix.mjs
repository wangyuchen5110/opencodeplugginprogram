import fs from "node:fs"
import path from "node:path"
import { resolveWinners } from "./lint.mjs"

export const ARCHIVE_DIR = ".skills-doctor-archive"

function collectSkillMds(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    let kind = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other"
    if (entry.isSymbolicLink()) {
      try {
        kind = fs.statSync(full).isDirectory() ? "dir" : "file"
      } catch {
        continue
      }
    }
    if (kind === "dir") collectSkillMds(full, out)
    else if (entry.name === "SKILL.md") out.push(full)
  }
  return out
}

function archiveTarget(skill, stamp) {
  const sourceDir = skill.source.dir
  const inner = skill.form === "dir" ? path.dirname(skill.file) : skill.file
  const rel = path.relative(sourceDir, inner)
  return path.join(sourceDir, ARCHIVE_DIR, stamp, rel)
}

/**
 * 规划安全的结构性修复：只归档「被遮蔽、永远不会加载」的定义。
 * 由更新器管理的文件不碰（应通过 update 恢复）。
 */
export function planFixes(skills, managed = new Map(), { now = new Date(), includeGlobal = false } = {}) {
  const winners = resolveWinners(skills)
  const byId = new Map()
  for (const skill of skills) {
    if (!byId.has(skill.id)) byId.set(skill.id, [])
    byId.get(skill.id).push(skill)
  }

  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const plan = []
  const skipped = []
  const skippedGlobal = []

  for (const [id, defs] of byId) {
    if (defs.length <= 1) continue
    const winner = winners.get(id)
    for (const loser of defs) {
      if (loser === winner) continue
      if (!includeGlobal && loser.source.scope === "global") {
        skippedGlobal.push(loser)
        continue
      }
      if (managed.has(loser.file)) {
        skipped.push(loser)
        continue
      }
      let from = loser.file
      if (loser.form === "dir") {
        const dir = path.dirname(loser.file)
        // 目录里若还有别的 SKILL.md，只挪这一个文件，避免误伤其他 skill
        from = collectSkillMds(dir).length > 1 ? loser.file : dir
      }
      plan.push({ id, from, file: loser.file, winner: winner.file, target: archiveTarget(loser, stamp) })
    }
  }

  return { plan, skipped, skippedGlobal }
}

export function applyFixes(plan, { dryRun = false } = {}) {
  const moved = []
  const errors = []

  for (const fix of plan) {
    if (dryRun) {
      moved.push(fix)
      continue
    }
    try {
      let target = fix.target
      let n = 1
      while (fs.existsSync(target)) target = `${fix.target}-${n++}`
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.renameSync(fix.from, target)
      moved.push({ ...fix, target })
    } catch (err) {
      errors.push({ ...fix, error: String(err?.message ?? err) })
    }
  }

  return { moved, errors }
}

/** 在 frontmatter 里把 metadata.opencode/autoinvoke 设为 false。 */
export function setAutoinvokeFalse(text) {
  const lines = text.split(/\r?\n/)
  const snippet = ["metadata:", "  opencode/autoinvoke: false"]
  if (lines[0]?.trim() !== "---") return ["---", ...snippet, "---", ...lines].join("\n")

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i
      break
    }
  }
  if (end === -1) return ["---", ...snippet, "---", ...lines].join("\n")

  const fm = lines.slice(1, end)
  const metaIdx = fm.findIndex((line) => /^metadata\s*:/.test(line.trim()))
  if (metaIdx === -1) {
    return [lines[0], ...fm, ...snippet, ...lines.slice(end)].join("\n")
  }

  const metaIndent = fm[metaIdx].length - fm[metaIdx].trimStart().length
  let j = metaIdx + 1
  while (j < fm.length && (fm[j].trim() === "" || fm[j].length - fm[j].trimStart().length > metaIndent)) j++

  const block = fm.slice(metaIdx + 1, j)
  let replaced = false
  for (let k = 0; k < block.length; k++) {
    if (/^\s*opencode\/autoinvoke\s*:/.test(block[k])) {
      block[k] = " ".repeat(metaIndent + 2) + "opencode/autoinvoke: false"
      replaced = true
    }
  }
  if (!replaced) block.unshift(" ".repeat(metaIndent + 2) + "opencode/autoinvoke: false")

  return [lines[0], ...fm.slice(0, metaIdx + 1), ...block, ...fm.slice(j), ...lines.slice(end)].join("\n")
}

/**
 * 隐藏指定 ID 的 skill（给生效版本加 autoinvoke: false）。
 * 用于给上下文预算减压：skill 仍可用 @id 手动加载。
 */
export function hideSkills(skills, ids, { dryRun = false } = {}) {
  const winners = resolveWinners(skills)
  const wanted = [...new Set(ids)]
  const changed = []
  const errors = []
  const missing = []

  for (const id of wanted) {
    const skill = winners.get(id)
    if (!skill) {
      missing.push(id)
      continue
    }
    try {
      if (!dryRun) {
        const text = fs.readFileSync(skill.file, "utf8")
        fs.writeFileSync(skill.file, setAutoinvokeFalse(text), "utf8")
      }
      changed.push({ id, file: skill.file })
    } catch (err) {
      errors.push({ id, file: skill.file, error: String(err?.message ?? err) })
    }
  }

  return { changed, errors, missing }
}
