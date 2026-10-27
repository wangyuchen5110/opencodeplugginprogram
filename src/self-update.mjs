import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync, spawn } from "node:child_process"

export const REGISTRY_URL =
  process.env.SKILLS_DOCTOR_REGISTRY_URL || "https://registry.npmjs.org/opencode-skills-doctor/latest"
export const RELEASES_URL = "https://github.com/wangyuchen5110/opencodeplugginprogram/releases/latest"

export const CACHE_DIR = path.join(os.homedir(), ".skills-doctor")
export const CACHE_FILE = path.join(CACHE_DIR, "self-update.json")
const DAY_MS = 24 * 60 * 60 * 1000

let cachedVersion = null
/** 当前安装版本（读取包内 package.json，插件/MCP 里也能用）。 */
export function toolVersion() {
  if (cachedVersion) return cachedVersion
  try {
    const file = new URL("../package.json", import.meta.url)
    cachedVersion = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")).version ?? "0.0.0"
  } catch {
    cachedVersion = "0.0.0"
  }
  return cachedVersion
}

/** 语义化版本比较：只看 major.minor.patch，预发布版视为更低。 */
export function compareVersions(a, b) {
  const parse = (value) => {
    const [core, pre = ""] = String(value ?? "").trim().replace(/^v/i, "").split("-")
    const numbers = core.split(".").map((part) => Number.parseInt(part, 10) || 0)
    return { numbers: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0], pre }
  }
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] > right.numbers[i] ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre > right.pre ? 1 : -1
}

/** off | notify | open；环境变量 SKILLS_DOCTOR_UPDATE_CHECK 可以强制关闭/开启。 */
export function resolveMode(config = {}, env = process.env) {
  const envValue = String(env.SKILLS_DOCTOR_UPDATE_CHECK ?? "").trim().toLowerCase()
  if (["0", "false", "off", "no"].includes(envValue)) return "off"
  if (["1", "true", "on", "yes"].includes(envValue)) return "notify"

  const value = config.checkUpdates ?? config.updateCheck
  if (value === false) return "off"
  if (value === true) return "notify"
  if (value === "off" || value === "notify" || value === "open") return value
  return "notify"
}

export async function fetchLatest({ fetchImpl = globalThis.fetch, url = REGISTRY_URL, timeoutMs = 4000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node runtime")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const version = String(data?.version ?? "").trim()
    if (!version) throw new Error("missing version")
    return { version, url: RELEASES_URL }
  } finally {
    clearTimeout(timer)
  }
}

function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
  } catch {
    return null
  }
}

function writeCache(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8")
  } catch {}
}

/**
 * 检查工具自身是否有新版本。
 * 返回 null（没有/关闭/失败）或 { latest, url, current, checkedAt, cached }。
 */
export async function checkForUpdate({
  current,
  mode = "notify",
  ttlMs = DAY_MS,
  now = Date.now(),
  fetchImpl,
  cacheFile = CACHE_FILE,
  force = false,
} = {}) {
  if (mode === "off" || !current) return null
  const cache = readCache(cacheFile)

  if (!force && cache && cache.current === current && Number.isFinite(cache.checkedAt) && now - cache.checkedAt < ttlMs) {
    if (cache.latest && compareVersions(cache.latest, current) > 0) return { ...cache, cached: true }
    return null
  }

  try {
    const latest = await fetchLatest({ fetchImpl })
    writeCache(cacheFile, { current, latest: latest.version, url: latest.url, checkedAt: now })
    if (compareVersions(latest.version, current) > 0) {
      return { latest: latest.version, url: latest.url, current, checkedAt: now, cached: false }
    }
    return null
  } catch {
    return null
  }
}

export function upgradeCommand() {
  return "npm install -g opencode-skills-doctor@latest"
}

/** 真正执行全局升级；调用方负责确认（CLI 的 --apply）。 */
export function applyUpgrade({ spawnImpl = spawnSync, npm = process.platform === "win32" ? "npm.cmd" : "npm" } = {}) {
  const result = spawnImpl(npm, ["install", "-g", "opencode-skills-doctor@latest", "--no-audit", "--no-fund"], {
    stdio: "inherit",
    env: process.env,
    timeout: 300000,
  })
  return result.status === 0
}

export function openReleasePage({ url = RELEASES_URL, spawnImpl = spawn } = {}) {
  try {
    if (process.platform === "win32") spawnImpl("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref()
    else if (process.platform === "darwin") spawnImpl("open", [url], { detached: true, stdio: "ignore" }).unref()
    else spawnImpl("xdg-open", [url], { detached: true, stdio: "ignore" }).unref()
  } catch {}
}
