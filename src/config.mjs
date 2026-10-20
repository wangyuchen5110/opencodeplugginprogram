import fs from "node:fs"
import path from "node:path"

export const CONFIG_NAME = ".skills-doctor.json"

function normalize(raw) {
  const config = {}
  if (Number.isFinite(raw?.budget) && raw.budget > 0) config.budget = raw.budget
  if (Number.isFinite(raw?.staleDays) && raw.staleDays >= 0) config.staleDays = raw.staleDays
  if (typeof raw?.lang === "string") config.lang = raw.lang
  if (raw?.rules && typeof raw.rules === "object") {
    config.rules = {}
    for (const [rule, level] of Object.entries(raw.rules)) {
      if (level === "off" || level === "info" || level === "warn" || level === "error") config.rules[rule] = level
    }
  }
  if (Array.isArray(raw?.ignore)) config.ignore = raw.ignore.filter((id) => typeof id === "string")
  return config
}

/**
 * 读取配置（默认 <cwd>/.skills-doctor.json）。
 * 解析失败时返回 { error, file }，调用方决定是否继续。
 */
export function loadConfig(cwd, configPath = null) {
  const file = configPath ? path.resolve(cwd, configPath) : path.join(cwd, CONFIG_NAME)
  if (!fs.existsSync(file)) return { file, config: {} }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
    return { file, config: normalize(raw) }
  } catch (err) {
    return { file, config: {}, error: String(err?.message ?? err) }
  }
}
