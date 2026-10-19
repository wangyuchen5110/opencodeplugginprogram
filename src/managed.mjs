import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { LOCK_VERSION, readLockFile } from "./catalog.mjs"

function sha1Buffer(buffer) {
  return createHash("sha1").update(buffer).digest("hex")
}

/**
 * 检测「由更新器管理」的 skill：
 *  - lock 里的版本号（供 scan/check 展示）
 *  - lock 里记录的文件 sha1 是否仍与本地一致（drift）
 *  - lock 版本高于本工具支持版本时，按兼容模式继续解析
 */
export function inspectManaged(scans) {
  const findings = []
  const managed = new Map()

  const add = (rule, severity, message, extra = {}) => findings.push({ rule, severity, message, ...extra })

  for (const scan of scans) {
    if (!scan.exists) continue
    const lock = readLockFile(scan.source.dir)
    if (!lock) continue

    const lockVersion = Number(lock.version ?? 1)
    if (Number.isFinite(lockVersion) && lockVersion > LOCK_VERSION) {
      add(
        "lock-version-unsupported",
        "info",
        `lock 版本 ${lockVersion} 高于本工具支持的 ${LOCK_VERSION}，已按兼容模式解析（未知字段忽略）`,
        { file: path.join(scan.source.dir, ".skills-doctor.lock.json") },
      )
    }

    for (const [url, catalog] of Object.entries(lock.catalogs)) {
      const skills = catalog && typeof catalog === "object" ? catalog.skills ?? {} : {}
      for (const [name, entry] of Object.entries(skills)) {
        const version = typeof entry === "string" ? entry : entry?.version
        const skill = scan.skills.find((s) => s.id === name)

        if (!skill) {
          add("managed-missing", "warn", `catalog 记录 ${name}@${version}，但本地没有对应文件（可能被删除或改名）`, {
            skills: [name],
          })
          continue
        }

        managed.set(skill.file, { version, url, root: scan.source.dir })

        const files = entry && typeof entry === "object" && entry.files && typeof entry.files === "object" ? entry.files : null
        if (!files) continue

        const base = path.dirname(skill.file)
        const resolvedBase = path.resolve(base)
        for (const [rel, expected] of Object.entries(files)) {
          const target = path.resolve(base, rel)
          if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
            add("managed-unsafe", "warn", `lock 里 ${name} 的文件路径不安全: ${rel}`, { skills: [name] })
            continue
          }
          if (!fs.existsSync(target)) {
            add("managed-drift", "warn", `"${name}" 的 ${rel} 缺失（更新后被删除了？）`, { skills: [name] })
            continue
          }
          const actual = sha1Buffer(fs.readFileSync(target))
          if (actual !== expected) {
            add("managed-drift", "warn", `"${name}" 的 ${rel} 在更新后被修改过（drift），下次 update 会覆盖`, {
              skills: [name],
            })
          }
        }
      }
    }
  }

  return { findings, managed, lockVersion: LOCK_VERSION }
}
