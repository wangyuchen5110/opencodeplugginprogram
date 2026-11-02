import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

export const ENTRY_ID = "mcp-skills-doctor"
export const SERVER_NAME = "skills_doctor"
export const SKILL_NAME = "skills-doctor-audit"

// DSH 的 cordis.patch.yml 是 patch 列表：新增条目必须放在 insert 下，
// 裸条目会被当成「覆盖不存在的 id」而跳过。
const INSERT_BLOCK = `- insert:
    - id: ${ENTRY_ID}
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: ${SERVER_NAME}
        transport: stdio
        command: npx
        args: ["-y", "opencode-skills-doctor", "mcp"]
`

export function dshHome(env = process.env) {
  return env.DSH_HOME || path.join(os.homedir(), ".dsh")
}

export function profileDir(home, profile) {
  return path.join(home, "profiles", profile)
}

/** DSH profile 目录（含 package.json 的子目录）。 */
export function listProfiles(home) {
  const dir = path.join(home, "profiles")
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "package.json")))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function pickProfile({ home, profile }) {
  const profiles = listProfiles(home)
  if (profile) {
    if (!profiles.includes(profile)) {
      return { error: `DSH profile "${profile}" not found under ${path.join(home, "profiles")}` }
    }
    return { profile, profiles }
  }
  if (profiles.includes("desktop")) return { profile: "desktop", profiles }
  if (profiles.length === 1) return { profile: profiles[0], profiles }
  if (!profiles.length) return { error: `no DSH profile found under ${path.join(home, "profiles")}` }
  return { error: `multiple DSH profiles found (${profiles.join(", ")}); pass --profile <name>` }
}

function skillSourceDir() {
  return fileURLToPath(new URL("../skills/dsh-skills-doctor", import.meta.url))
}

function indentOf(line) {
  return (line.match(/^[ \t]*/) ?? [""])[0].length
}

function blockEnd(lines, start) {
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() === "" || indentOf(line) > 0) end++
    else break
  }
  return end
}

/** 找到包含我们 id 的 insert 块，或旧版裸条目。 */
function findEntry(lines, id) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (indentOf(line) === 0 && /^-\s*insert:\s*$/.test(line)) {
      const end = blockEnd(lines, i)
      const block = lines.slice(i, end).join("\n")
      if (block.includes(id)) return { type: "insert", start: i, end }
      i = end - 1
      continue
    }
    if (indentOf(line) === 0 && line.trim() === `- id: ${id}`) {
      return { type: "legacy", start: i, end: blockEnd(lines, i) }
    }
  }
  return null
}

function removeEntryBlock(text, id) {
  const lines = text.split(/\r?\n/)
  const found = findEntry(lines, id)
  if (!found) return { text, changed: false, type: null }

  if (found.type === "insert") {
    const block = lines.slice(found.start, found.end)
    const rows = block.filter((line) => /^\s+- id:/.test(line))
    if (rows.length > 1) {
      // insert 块里还有别人的条目：只摘掉我们这一行及其子行
      const rowIndex = block.findIndex((line) => line.trim() === `- id: ${id}`)
      let rowEnd = rowIndex + 1
      while (
        rowEnd < block.length &&
        (block[rowEnd].trim() === "" || indentOf(block[rowEnd]) > indentOf(block[rowIndex]))
      ) {
        rowEnd++
      }
      const kept = [...lines.slice(0, found.start), ...block.slice(0, rowIndex), ...block.slice(rowEnd), ...lines.slice(found.end)]
      return { text: kept.join("\n"), changed: true, type: "insert-row" }
    }
  }

  const kept = [...lines.slice(0, found.start), ...lines.slice(found.end)]
  return { text: kept.join("\n"), changed: true, type: found.type }
}

function appendInsert(text) {
  const header = text.trim() ? (text.endsWith("\n") ? "\n" : "\n\n") : ""
  return `${text}${header}${INSERT_BLOCK}`
}

function ensureEntry(patchFile, dryRun, act, dry) {
  const existing = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, "utf8") : ""
  const lines = existing.split(/\r?\n/)
  const found = findEntry(lines, ENTRY_ID)

  if (found && found.type === "insert") {
    act(`MCP insert entry already present in ${patchFile}`)
    return false
  }

  let next = existing
  if (found && found.type === "legacy") {
    next = removeEntryBlock(existing, ENTRY_ID).text
    act(`migrating legacy patch row in ${patchFile}`)
  }
  next = appendInsert(next)

  if (dryRun) {
    dry(`write ${ENTRY_ID} insert block to ${patchFile}`)
    return true
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  if (existing) fs.copyFileSync(patchFile, `${patchFile}.bak-${stamp}`)
  fs.writeFileSync(patchFile, next, "utf8")
  act(`wrote ${ENTRY_ID} insert block to ${patchFile}`)
  return true
}

function removeEntry(patchFile, dryRun, act, dry) {
  if (!fs.existsSync(patchFile)) return false
  const text = fs.readFileSync(patchFile, "utf8")
  const result = removeEntryBlock(text, ENTRY_ID)
  if (!result.changed) return false
  if (dryRun) {
    dry(`remove ${ENTRY_ID} from ${patchFile}`)
    return true
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  fs.copyFileSync(patchFile, `${patchFile}.bak-${stamp}`)
  fs.writeFileSync(patchFile, result.text, "utf8")
  act(`removed ${ENTRY_ID} from ${patchFile}`)
  return true
}

function copySkill(source, target, dryRun, act, dry) {
  const file = path.join(source, "SKILL.md")
  if (!fs.existsSync(file)) return false
  const targetFile = path.join(target, "SKILL.md")
  if (fs.existsSync(targetFile) && fs.readFileSync(targetFile, "utf8") === fs.readFileSync(file, "utf8")) {
    act(`skill already up to date ${target}`)
    return true
  }
  if (dryRun) {
    dry(`install skill ${SKILL_NAME} into ${target}`)
    return true
  }
  fs.mkdirSync(target, { recursive: true })
  fs.copyFileSync(file, targetFile)
  act(`wrote skill ${targetFile}`)
  return true
}

function removeSkill(target, dryRun, act, dry) {
  const file = path.join(target, "SKILL.md")
  if (!fs.existsSync(file)) return false
  if (!fs.readFileSync(file, "utf8").includes("Skill audit workflow")) {
    act(`kept ${target} (not the generated skill)`)
    return false
  }
  if (dryRun) {
    dry(`delete skill ${target}`)
    return true
  }
  fs.rmSync(target, { recursive: true, force: true })
  act(`deleted skill ${target}`)
  return true
}

export function installDsh({ home = dshHome(), profile = null, dryRun = false } = {}) {
  const actions = []
  const errors = []
  const dry = (message) => actions.push(`[dry-run] ${message}`)
  const act = (message) => actions.push(message)

  const picked = pickProfile({ home, profile })
  if (picked.error) {
    errors.push(picked.error)
    return { ok: false, home, actions, errors, dryRun }
  }

  const dir = profileDir(home, picked.profile)
  const patchFile = path.join(dir, "cordis.patch.yml")
  const skillDir = path.join(home, "skills", SKILL_NAME)

  if (dryRun) dry(`profile: ${picked.profile} (${dir})`)
  else act(`profile: ${picked.profile}`)

  ensureEntry(patchFile, dryRun, act, dry)
  copySkill(skillSourceDir(), skillDir, dryRun, act, dry)

  return { ok: errors.length === 0, home, profile: picked.profile, patchFile, skillDir, actions, errors, dryRun }
}

export function uninstallDsh({ home = dshHome(), profile = null, dryRun = false } = {}) {
  const actions = []
  const errors = []
  const dry = (message) => actions.push(`[dry-run] ${message}`)
  const act = (message) => actions.push(message)

  const picked = pickProfile({ home, profile })
  if (picked.error) {
    errors.push(picked.error)
    return { ok: false, home, actions, errors, dryRun }
  }

  const dir = profileDir(home, picked.profile)
  const patchFile = path.join(dir, "cordis.patch.yml")
  const skillDir = path.join(home, "skills", SKILL_NAME)

  removeEntry(patchFile, dryRun, act, dry)
  removeSkill(skillDir, dryRun, act, dry)
  return { ok: errors.length === 0, home, profile: picked.profile, patchFile, skillDir, actions, errors, dryRun }
}
