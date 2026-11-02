import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

export const ENTRY_ID = "mcp-skills-doctor"
export const SERVER_NAME = "skills_doctor"
export const SKILL_NAME = "skills-doctor-audit"

const ENTRIES = `- id: ${ENTRY_ID}
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

function copySkill(source, target, dryRun, act, dry) {
  if (!fs.existsSync(source)) return false
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

/** 在 cordis.patch.yml 里追加 MCP 条目（幂等）。 */
function appendEntry(patchFile, dryRun, act, dry) {
  const existing = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, "utf8") : ""
  if (existing.includes(ENTRY_ID) || existing.includes(`serverName: ${SERVER_NAME}`)) {
    act(`MCP entry already present in ${patchFile}`)
    return false
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  if (dryRun) {
    dry(`append ${ENTRY_ID} to ${patchFile}`)
    return true
  }
  if (existing) fs.copyFileSync(patchFile, `${patchFile}.bak-${stamp}`)
  const header = existing
    ? (existing.endsWith("\n") ? "" : "\n")
    : "# DSH profile patch layer\n"
  const next = `${existing}${header}${existing.trim() ? "\n" : ""}${ENTRIES}`
  fs.writeFileSync(patchFile, next, "utf8")
  act(`appended ${ENTRY_ID} to ${patchFile}`)
  return true
}

function removeEntry(patchFile, dryRun, act, dry) {
  if (!fs.existsSync(patchFile)) return false
  const text = fs.readFileSync(patchFile, "utf8")
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => line.trim() === `- id: ${ENTRY_ID}`)
  if (index < 0) return false

  let end = index + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() === "" || /^[ \t]/.test(line)) end++
    else break
  }
  if (dryRun) {
    dry(`remove ${ENTRY_ID} from ${patchFile}`)
    return true
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  fs.copyFileSync(patchFile, `${patchFile}.bak-${stamp}`)
  fs.writeFileSync(patchFile, lines.slice(0, index).concat(lines.slice(end)).join("\n"), "utf8")
  act(`removed ${ENTRY_ID} from ${patchFile}`)
  return true
}

function removeSkill(target, dryRun, act, dry) {
  const file = path.join(target, "SKILL.md")
  if (!fs.existsSync(file)) return false
  const text = fs.readFileSync(file, "utf8")
  if (!text.includes("Skill audit workflow")) {
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

  appendEntry(patchFile, dryRun, act, dry)
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
