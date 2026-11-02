import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const APP_NAME = "OpenCode"

/** 各平台 OpenCode Desktop 的常见安装位置。 */
export function desktopCandidates(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local")
    return [
      path.join(local, "Programs", "@opencode-aidesktop", "OpenCode.exe"),
      path.join(local, "Programs", "opencode", "OpenCode.exe"),
      path.join(local, "Programs", "opencode-desktop", "OpenCode.exe"),
      path.join(local, "opencode-desktop", "OpenCode.exe"),
    ]
  }
  if (platform === "darwin") {
    return ["/Applications/OpenCode.app/Contents/MacOS/OpenCode", path.join(home, "Applications", "OpenCode.app", "Contents", "MacOS", "OpenCode")]
  }
  return ["/usr/bin/opencode-desktop", "/usr/local/bin/opencode-desktop", "/opt/OpenCode/opencode-desktop", "/opt/opencode-desktop/opencode-desktop"]
}

function asarPathFor(exe) {
  if (process.platform === "darwin" || exe.includes(".app")) {
    return path.join(path.dirname(path.dirname(path.dirname(path.dirname(exe)))), "Resources", "app.asar")
  }
  return path.join(path.dirname(exe), "resources", "app.asar")
}

/**
 * 读取 app.asar 里的 package.json.version（不解包整个 asar）。
 * asar 头结构：[u32 4][u32 headerSize][u32 stringSize][u32 jsonSize][json][content…]
 */
export function readAsarVersion(asarFile) {
  let fd
  try {
    fd = fs.openSync(asarFile, "r")
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const jsonSize = head.readUInt32LE(12)
    if (!jsonSize || jsonSize > 64 * 1024 * 1024) return null
    const json = Buffer.alloc(jsonSize)
    fs.readSync(fd, json, 0, jsonSize, 16)
    const header = JSON.parse(json.toString("utf8"))
    const entry = header?.files?.["package.json"]
    if (!entry || typeof entry.offset !== "string") return null
    const size = Number(entry.size ?? 0)
    if (!Number.isFinite(size) || size <= 0 || size > 1024 * 1024) return null
    const contentStart = 8 + headerSize
    const data = Buffer.alloc(size)
    fs.readSync(fd, data, 0, size, contentStart + Number(entry.offset))
    const pkg = JSON.parse(data.toString("utf8"))
    return typeof pkg.version === "string" ? pkg.version : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }
}

/**
 * 探测本机是否装了 OpenCode Desktop，并读取它内置 core 的版本。
 * Desktop 与 CLI 共用 ~/.config/opencode，所以插件/命令配置不需要第二份。
 */
export function detectDesktop({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  for (const exe of desktopCandidates(platform, env, home)) {
    if (!fs.existsSync(exe)) continue
    const version = readAsarVersion(asarPathFor(exe))
    return { installed: true, exe, version, asar: asarPathFor(exe) }
  }
  return { installed: false, exe: null, version: null, asar: null }
}

export const DESKTOP_APP = APP_NAME
