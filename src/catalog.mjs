import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { translator } from "./i18n.mjs"

export const LOCK_NAME = ".skills-doctor.lock.json"
export const LOCK_VERSION = 2

function sha1Buffer(buffer) {
  return createHash("sha1").update(buffer).digest("hex")
}

function safeRelPath(p) {
  if (typeof p !== "string" || !p.trim()) return false
  if (path.isAbsolute(p)) return false
  const normalized = p.replace(/\\/g, "/")
  if (normalized.split("/").some((seg) => seg === "..")) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false
  return true
}

function resolveInside(baseDir, rel, t) {
  const base = path.resolve(baseDir)
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(t("catalog.unsafePath", { rel }))
  }
  return target
}

export function validateCatalogEntry(entry, t = translator("en")) {
  const problems = []
  if (!entry || typeof entry !== "object") return [t("catalog.entryNotObject")]
  if (typeof entry.name !== "string" || !entry.name.trim()) problems.push(t("catalog.missingName"))
  if (typeof entry.version !== "string" && typeof entry.version !== "number") {
    problems.push(t("catalog.missingVersion"))
  }
  if (!Array.isArray(entry.files) || entry.files.length === 0) {
    problems.push(t("catalog.missingFiles"))
  } else {
    for (const file of entry.files) {
      if (!safeRelPath(file)) problems.push(t("catalog.safePath", { file }))
    }
    const hasEntryFile =
      entry.files.includes("SKILL.md") ||
      (typeof entry.name === "string" && entry.files.includes(`${entry.name}.md`))
    if (!hasEntryFile) problems.push(t("catalog.missingEntryFile"))
  }
  return problems
}

/** 读取某目录下的 lock（容忍旧版本、未来版本、BOM、损坏）。 */
export function readLockFile(dir) {
  const file = path.join(dir, LOCK_NAME)
  if (!fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
    if (!parsed || typeof parsed !== "object" || typeof parsed.catalogs !== "object" || !parsed.catalogs) return null
    return parsed
  } catch {
    return null
  }
}

function lockEntryVersion(entry) {
  if (typeof entry === "string") return entry
  if (entry && typeof entry === "object" && entry.version != null) return String(entry.version)
  return null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** fetch + 有限重试（5xx 与网络错误），避免 catalog 抖动直接失败。 */
async function fetchWithRetry(fetchImpl, url, timeoutMs, attempts = 3) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (res.status >= 500 && attempt < attempts - 1) {
        await sleep(200 * 2 ** attempt)
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt < attempts - 1) await sleep(200 * 2 ** attempt)
    }
  }
  throw lastError ?? new Error("fetch failed")
}

/** 先写临时文件再原子替换，避免中途失败留下半截文件。 */
function writeFileAtomic(target, data) {
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  fs.writeFileSync(tmp, data)
  try {
    fs.renameSync(tmp, target)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {}
    throw err
  }
}

function pruneEmptyDirs(dir, stopDir) {
  const stop = path.resolve(stopDir)
  let current = path.resolve(dir)
  while (current !== stop && current.startsWith(stop + path.sep)) {
    try {
      if (fs.readdirSync(current).length > 0) return
      fs.rmdirSync(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}

/** 本地文件是否仍与 lock 里的哈希一致（无哈希时视为一致）。 */
function filesMatch(into, name, files, t) {
  if (!files || typeof files !== "object") return true
  for (const [rel, expected] of Object.entries(files)) {
    const target = resolveInside(path.join(into, name), rel, t)
    if (!fs.existsSync(target)) return false
    if (sha1Buffer(fs.readFileSync(target)) !== expected) return false
  }
  return true
}

/** 抓取 <url>/index.json。未知字段一律忽略（向上兼容）。 */
export async function fetchCatalogIndex(url, { fetchImpl = fetch, timeoutMs = 15000, t = translator("en") } = {}) {
  const base = url.replace(/\/+$/, "")
  const res = await fetchWithRetry(fetchImpl, `${base}/index.json`, timeoutMs)
  if (!res.ok) throw new Error(t("catalog.indexHttp", { status: res.status }))
  const json = await res.json()
  if (!json || !Array.isArray(json.skills)) throw new Error(t("catalog.indexShape"))
  return { base, skills: json.skills }
}

/**
 * 更新器：对比 HTTP catalog 的 version，必要时下载到 into 目录并写 lock。
 * lock 里记录每个文件的 sha1，检测器据此判断「更新后是否被改过」。
 */
export async function updateCatalogs(
  catalogs,
  { into = process.cwd(), checkOnly = false, fetchImpl = fetch, t = translator("en"), prune = false } = {},
) {
  const lockPath = path.join(into, LOCK_NAME)
  const lock = readLockFile(into) ?? { version: LOCK_VERSION, catalogs: {} }
  const lockTooNew = Number(lock.version ?? 1) > LOCK_VERSION
  const results = []

  for (const catalog of catalogs) {
    const result = {
      url: catalog.url,
      error: null,
      updated: [],
      unchanged: [],
      invalid: [],
      orphaned: [],
      pruned: [],
      removedFiles: [],
      files: 0,
    }
    try {
      const { base, skills } = await fetchCatalogIndex(catalog.url, { fetchImpl, t })
      const baseUrl = new URL(base + "/")
      const previousSkills = lock.catalogs[catalog.url]?.skills ?? {}
      const nextSkills = {}

      for (const entry of skills) {
        const problems = validateCatalogEntry(entry, t)
        if (problems.length) {
          result.invalid.push({ name: String(entry?.name ?? "?"), problems })
          continue
        }
        const version = String(entry.version)
        const previousVersion = lockEntryVersion(previousSkills[entry.name])
        const prevEntry = previousSkills[entry.name]
        const prevHashes = prevEntry && typeof prevEntry === "object" ? prevEntry.files : null
        const drifted = previousVersion === version && prevHashes ? !filesMatch(into, entry.name, prevHashes, t) : false

        if (previousVersion === version && !drifted) {
          result.unchanged.push(entry.name)
          nextSkills[entry.name] = typeof prevEntry === "string" ? { version: prevEntry, files: {} } : prevEntry
          continue
        }

        if (checkOnly) {
          result.updated.push({ name: entry.name, version, previous: previousVersion, reason: drifted ? "drift" : null })
          continue
        }

        const hashes = {}
        for (const file of entry.files) {
          const encodedPath = file.split("/").map(encodeURIComponent).join("/")
          const fileUrl = new URL(`${encodeURIComponent(entry.name)}/${encodedPath}`, baseUrl)
          if (fileUrl.origin !== baseUrl.origin) throw new Error(t("catalog.crossOrigin", { file }))
          const res = await fetchWithRetry(fetchImpl, fileUrl, 30000)
          if (!res.ok) throw new Error(t("catalog.fileHttp", { name: entry.name, file, status: res.status }))
          const buffer = Buffer.from(await res.arrayBuffer())
          const target = resolveInside(path.join(into, entry.name), file, t)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          writeFileAtomic(target, buffer)
          hashes[file] = sha1Buffer(buffer)
          result.files++
        }

        // 新版本里已被删除的文件：从本地清掉，避免旧文件残留
        if (prevHashes) {
          for (const oldFile of Object.keys(prevHashes)) {
            if (entry.files.includes(oldFile)) continue
            const target = resolveInside(path.join(into, entry.name), oldFile, t)
            if (!fs.existsSync(target)) continue
            fs.rmSync(target, { force: true })
            result.removedFiles.push({ name: entry.name, file: oldFile })
            pruneEmptyDirs(path.dirname(target), path.join(into, entry.name))
          }
        }

        nextSkills[entry.name] = { version, files: hashes }
        result.updated.push({ name: entry.name, version, previous: previousVersion, reason: drifted ? "drift" : null })
      }

      const validNames = new Set(
        skills.filter((entry) => validateCatalogEntry(entry, t).length === 0).map((entry) => entry.name),
      )
      const orphaned = Object.keys(previousSkills).filter((name) => !validNames.has(name))
      result.orphaned = orphaned

      if (!checkOnly) {
        if (prune) {
          for (const name of orphaned) {
            const dir = resolveInside(into, name, t)
            if (!fs.existsSync(dir)) continue
            fs.rmSync(dir, { recursive: true, force: true })
            result.pruned.push(name)
          }
        } else {
          // 不 prune 时保留 lock 记录，方便下次继续跟踪
          for (const name of orphaned) nextSkills[name] = previousSkills[name]
        }
      }

      if (!checkOnly) lock.catalogs[catalog.url] = { skills: nextSkills }
    } catch (err) {
      result.error = String(err?.message ?? err)
    }
    results.push(result)
  }

  if (!checkOnly && results.some((r) => !r.error)) {
    lock.version = LOCK_VERSION
    lock.generatedAt = new Date().toISOString()
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    writeFileAtomic(lockPath, JSON.stringify(lock, null, 2) + "\n")
  }

  return { lockPath, lockTooNew, results }
}
