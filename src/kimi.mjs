import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

export const SERVER_NAME = "skills-doctor"
export const SKILL_NAME = "skills-doctor-audit"

const ENTRY = { command: "npx", args: ["-y", "opencode-skills-doctor", "mcp"] }

export function kimiHome(env = process.env) {
  return env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code")
}

function skillSourceDir() {
  return fileURLToPath(new URL("../skills/dsh-skills-doctor", import.meta.url))
}

function readJson(file) {
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
  } catch {
    return null
  }
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

export function installKimi({ home = kimiHome(), dryRun = false } = {}) {
  const actions = []
  const errors = []
  const act = (message) => actions.push(message)
  const dry = (message) => actions.push(`[dry-run] ${message}`)

  const mcpFile = path.join(home, "mcp.json")
  const skillDir = path.join(home, "skills", SKILL_NAME)

  const config = readJson(mcpFile)
  if (config === null) {
    errors.push(`cannot parse ${mcpFile}`)
    return { ok: false, home, mcpFile, skillDir, actions, errors, dryRun }
  }
  config.mcpServers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {}

  const existing = config.mcpServers[SERVER_NAME]
  const same = existing && existing.command === ENTRY.command && JSON.stringify(existing.args) === JSON.stringify(ENTRY.args)
  if (same) {
    act(`${SERVER_NAME} already present in ${mcpFile}`)
  } else if (dryRun) {
    dry(`add ${SERVER_NAME} to mcpServers in ${mcpFile}`)
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    if (fs.existsSync(mcpFile)) fs.copyFileSync(mcpFile, `${mcpFile}.bak-${stamp}`)
    config.mcpServers[SERVER_NAME] = ENTRY
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2) + "\n", "utf8")
    act(`wrote ${SERVER_NAME} to ${mcpFile}`)
  }

  copySkill(skillSourceDir(), skillDir, dryRun, act, dry)
  return { ok: errors.length === 0, home, mcpFile, skillDir, actions, errors, dryRun }
}

export function uninstallKimi({ home = kimiHome(), dryRun = false } = {}) {
  const actions = []
  const errors = []
  const act = (message) => actions.push(message)
  const dry = (message) => actions.push(`[dry-run] ${message}`)

  const mcpFile = path.join(home, "mcp.json")
  const skillDir = path.join(home, "skills", SKILL_NAME)

  const config = readJson(mcpFile)
  if (config && config.mcpServers && config.mcpServers[SERVER_NAME]) {
    if (dryRun) {
      dry(`remove ${SERVER_NAME} from ${mcpFile}`)
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      fs.copyFileSync(mcpFile, `${mcpFile}.bak-${stamp}`)
      delete config.mcpServers[SERVER_NAME]
      fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2) + "\n", "utf8")
      act(`removed ${SERVER_NAME} from ${mcpFile}`)
    }
  }

  removeSkill(skillDir, dryRun, act, dry)
  return { ok: errors.length === 0, home, mcpFile, skillDir, actions, errors, dryRun }
}
