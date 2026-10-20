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
export function planFixes(skills, managed = new Map(), { now = new Date() } = {}) {
  const winners = resolveWinners(skills)
  const byId = new Map()
  for (const skill of skills) {
    if (!byId.has(skill.id)) byId.set(skill.id, [])
    byId.get(skill.id).push(skill)
  }

  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const plan = []
  const skipped = []

  for (const [id, defs] of byId) {
    if (defs.length <= 1) continue
    const winner = winners.get(id)
    for (const loser of defs) {
      if (loser === winner) continue
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

  return { plan, skipped }
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
