import fs from "node:fs"
import path from "node:path"
import { discoverSources, scanAll } from "./discover.mjs"
import { lint, resolveWinners, summarize, SEVERITY_ORDER } from "./lint.mjs"
import { updateCatalogs, LOCK_NAME } from "./catalog.mjs"
import { inspectManaged } from "./managed.mjs"
import { padDisplay } from "./parse.mjs"

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))

const HELP = `skills-doctor ${pkg.version} — OpenCode skill 本地检测器 / 更新器

用法:
  skills-doctor check  [options]   检查 skill 来源、冲突与上下文预算（默认命令）
  skills-doctor scan   [options]   列出所有 skill 及其来源/优先级
  skills-doctor update [options]   对比并拉取 HTTP catalog 里的 skill（更新器）

选项:
  --root <dir>        以该目录为工作目录（默认当前目录）
  --no-global         不扫描 ~/.claude、~/.agents、~/.config/opencode
  --budget <n>        模型每步可看的 description token 预算（默认 1200）
  --stale-days <n>    超过 n 天未更新的 skill 给出提示（默认关闭）
  --strict            有 warning 也返回非 0
  --json              输出 JSON
  --into <dir>        update 的落盘目录（默认 .opencode/skills，opencode 会直接读取）
  --check-only        update 只报告可用更新，不下载
  -h, --help          帮助
  -v, --version       版本

退出码: 0 正常；1 有 error（--strict 时含 warning）；2 参数/运行错误
`

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
const red = (t) => paint("31", t)
const yellow = (t) => paint("33", t)
const cyan = (t) => paint("36", t)
const dim = (t) => paint("2", t)
const bold = (t) => paint("1", t)

const HINTS = {
  shadowed: "删掉被遮蔽的旧定义，或改用不同 ID；否则你改的和实际加载的可能不是同一份。",
  "flat-dir-collision": "同一来源里两种形式二选一，避免 ID 语义不清。",
  "duplicate-content": "合并成一份，另一处改为引用。",
  "near-duplicate-description": "把 description 写得更具体，或直接合并成一个 skill。",
  "missing-description": "补 description——模型只能看到 ID、name、description。",
  "long-description": "description 压到一两句话，细节放正文或 references/。",
  "large-body": "正文拆到 references/，SKILL.md 只保留流程。",
  "token-budget": "精简 description，或把低频 skill 设为 metadata.opencode/autoinvoke: false 隐藏。",
  "too-many-skills": "低频 skill 关掉 autoinvoke，用 @id 手动加载。",
  "invalid-id": "改成小写 kebab-case，并与目录名对齐。",
  "hidden-skill": "确认是刻意隐藏；隐藏的 skill 不会出现在模型列表里。",
  "stale-skill": "确认内容没过期，或删掉。",
}

function parseArgs(argv) {
  const options = {
    command: "check",
    root: process.cwd(),
    global: true,
    budget: 1200,
    staleDays: 0,
    strict: false,
    json: false,
    into: null,
    checkOnly: false,
    help: false,
    version: false,
  }

  const args = [...argv]
  const commands = new Set(["check", "scan", "update", "help"])
  if (args[0] && commands.has(args[0])) {
    options.command = args.shift()
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--root":
        options.root = path.resolve(args[++i] ?? ".")
        break
      case "--no-global":
        options.global = false
        break
      case "--budget":
        options.budget = Number(args[++i])
        break
      case "--stale-days":
        options.staleDays = Number(args[++i])
        break
      case "--strict":
        options.strict = true
        break
      case "--json":
        options.json = true
        break
      case "--into":
        options.into = path.resolve(args[++i] ?? ".")
        break
      case "--check-only":
        options.checkOnly = true
        break
      case "-h":
      case "--help":
        options.help = true
        break
      case "-v":
      case "--version":
        options.version = true
        break
      default:
        if (arg.startsWith("-")) {
          console.error(`未知参数: ${arg}`)
          process.exit(2)
        }
    }
  }

  if (!Number.isFinite(options.budget) || options.budget <= 0) options.budget = 1200
  if (!Number.isFinite(options.staleDays) || options.staleDays < 0) options.staleDays = 0
  return options
}

function serializeSkills(skills, managed = new Map()) {
  return skills.map((s) => ({
    id: s.id,
    form: s.form,
    file: s.file,
    kind: s.source.kind,
    scope: s.source.scope,
    order: s.order,
    advertised: s.advertised,
    hidden: s.hidden,
    descriptionChars: s.description.length,
    descriptionTokens: s.descriptionTokens,
    bodyTokens: s.bodyTokens,
    bytes: s.bytes,
    mtime: s.mtime ? new Date(s.mtime).toISOString() : null,
    managed: managed.get(s.file) ?? null,
  }))
}

function runCheck(discovered, options, managedInfo) {
  const findings = [...lint(discovered.skills, { budget: options.budget, staleDays: options.staleDays }), ...managedInfo.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  const summary = summarize(discovered.skills)
  const errors = findings.filter((f) => f.severity === "error").length
  const warnings = findings.filter((f) => f.severity === "warn").length
  const infos = findings.filter((f) => f.severity === "info").length
  const exitCode = errors > 0 || (options.strict && warnings > 0) ? 1 : 0

  return {
    tool: "skills-doctor",
    version: pkg.version,
    cwd: path.resolve(options.root),
    projectRoot: discovered.projectRoot,
    sources: discovered.sources.map((s) => ({ kind: s.kind, scope: s.scope, dir: s.dir, order: s.order, exists: fs.existsSync(s.dir) })),
    catalogs: discovered.catalogs,
    missing: discovered.missing,
    summary,
    managed: { count: managedInfo.managed.size },
    findings,
    counts: { errors, warnings, infos },
    exitCode,
  }
}

function printCheck(result, options) {
  const { summary, counts } = result
  console.log(bold(`skills-doctor ${result.version}`))
  console.log(dim(`  工作目录: ${result.cwd}`))
  console.log(dim(`  项目根:   ${result.projectRoot}`))
  console.log(
    `  来源: ${result.sources.length} 个（存在 ${result.sources.filter((s) => s.exists).length} 个）` +
      `  定义: ${summary.total}  唯一 ID: ${summary.unique}  会展示: ${summary.advertised}` +
      `  描述预算: ~${summary.advertisedTokens} tokens`,
  )
  if (result.catalogs.length) {
    console.log(dim(`  HTTP catalog: ${result.catalogs.length} 个（用 update --check-only 查版本）`))
  }
  if (result.managed.count > 0) {
    console.log(dim(`  由更新器管理: ${result.managed.count} 个（lock 版本校验，见 managed-* 提示）`))
  }
  for (const missing of result.missing) {
    if (missing.kind === "config-error") {
      console.log(yellow(`  ! 配置文件无法解析: ${missing.path}（${missing.reason}）`))
    } else {
      console.log(yellow(`  ! 配置里引用的路径不存在: ${missing.path}`))
    }
  }
  console.log("")

  if (!result.findings.length) {
    console.log(bold("没有发现问题。"))
  } else {
    const badge = { error: red("[E]"), warn: yellow("[W]"), info: cyan("[i]") }
    for (const finding of result.findings) {
      console.log(`${badge[finding.severity]} ${dim(finding.rule)}  ${finding.message}`)
    }
    console.log("")
    console.log(
      `${counts.errors} error, ${counts.warnings} warn, ${counts.infos} info` +
        (options.strict ? "（--strict：warning 也会非 0 退出）" : ""),
    )
  }

  const usedRules = [...new Set(result.findings.map((f) => f.rule))].filter((r) => HINTS[r])
  if (usedRules.length) {
    console.log("")
    console.log(bold("建议:"))
    for (const rule of usedRules) console.log(dim(`  - ${HINTS[rule]}`))
  }
}

function printScan(discovered, options, managed = new Map()) {
  const winners = resolveWinners(discovered.skills)
  const rows = discovered.skills
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id) || a.order - b.order)
    .map((s) => {
      const info = managed.get(s.file)
      return {
        id: s.id + (winners.get(s.id) === s ? " *" : "") + (info ? ` @${info.version}` : ""),
        scope: s.source.scope,
        kind: s.source.kind,
        adv: s.advertised ? "yes" : "no",
        tokens: String(s.descriptionTokens),
        body: String(s.bodyTokens),
        file: s.file,
      }
    })

  console.log(bold(`skills-doctor ${pkg.version} — scan`))
  console.log(dim(`  工作目录: ${path.resolve(options.root)}`))
  console.log(dim(`  项目根:   ${discovered.projectRoot}`))
  console.log("")

  const widths = {
    id: Math.max(4, ...rows.map((r) => r.id.length)) + 2,
    scope: 8,
    adv: 4,
    tokens: 7,
    body: 6,
  }
  console.log(
    dim(
      padDisplay("ID", widths.id) +
        padDisplay("scope", widths.scope) +
        padDisplay("adv", widths.adv) +
        padDisplay("desc", widths.tokens) +
        padDisplay("body", widths.body) +
        "file",
    ),
  )
  for (const row of rows) {
    console.log(
      padDisplay(row.id, widths.id) +
        padDisplay(row.scope, widths.scope) +
        padDisplay(row.adv, widths.adv) +
        padDisplay(row.tokens, widths.tokens) +
        padDisplay(row.body, widths.body) +
        dim(row.file),
    )
  }
  console.log("")
  console.log(dim("  * = 该 ID 的实际生效定义（注册顺序越后优先级越高）"))
  if (discovered.catalogs.length) {
    console.log(dim(`  HTTP catalog: ${discovered.catalogs.map((c) => c.url).join(", ")}`))
  }
}

async function runUpdate(discovered, options, cwd) {
  const into = options.into ? path.resolve(options.into) : path.join(cwd, ".opencode", "skills")
  if (!discovered.catalogs.length) {
    console.log(bold("更新器"))
    console.log("  没有配置 HTTP catalog。在 opencode.json(c) 的 skills 数组里写 https://... 即可。")
    return 0
  }

  const { lockPath, results, lockTooNew } = await updateCatalogs(discovered.catalogs, {
    into,
    checkOnly: options.checkOnly,
  })

  if (options.json) {
    console.log(JSON.stringify({ lockPath, checkOnly: options.checkOnly, results }, null, 2))
    return results.some((r) => r.error) ? 1 : 0
  }

  console.log(bold(`更新器${options.checkOnly ? "（仅检查）" : ""}`))
  console.log(dim(`  落盘目录: ${into}`))
  console.log("")
  for (const result of results) {
    console.log(cyan(result.url))
    if (result.error) {
      console.log(red(`  ✗ 失败: ${result.error}`))
      continue
    }
    if (result.updated.length) {
      const label = options.checkOnly ? "可更新" : "已更新"
      const parts = result.updated.map((u) => {
        if (u.reason === "drift") return `${u.name} ${u.version}（修复 drift）`
        return u.previous ? `${u.name} ${u.previous}→${u.version}` : `${u.name} ${u.version}`
      })
      console.log(`  ✓ ${label} ${result.updated.length}: ${parts.join(", ")}`)
    }
    if (result.unchanged.length) console.log(dim(`  · 未变 ${result.unchanged.length}`))
    if (result.files) console.log(dim(`  · 写入文件 ${result.files}`))
    for (const invalid of result.invalid) {
      console.log(yellow(`  ! 跳过 ${invalid.name}: ${invalid.problems.join("; ")}`))
    }
    if (!result.updated.length && !result.unchanged.length && !result.invalid.length) {
      console.log(dim("  · catalog 为空"))
    }
  }
  console.log("")
  console.log(dim(`  lock: ${lockPath}（${LOCK_NAME}）`))
  if (lockTooNew) {
    console.log(yellow("  ! lock 版本比本工具新，已按兼容模式解析（未知字段忽略）"))
  }
  if (!options.checkOnly && results.some((r) => !r.error)) {
    console.log(dim(`  check 现在可以直接检测到这些 skill（${into} 是 opencode 会读取的目录）`))
  }
  return results.some((r) => r.error) ? 1 : 0
}

export async function main(argv) {
  const options = parseArgs(argv)

  if (options.help || options.command === "help") {
    console.log(HELP)
    return
  }
  if (options.version) {
    console.log(pkg.version)
    return
  }

  const cwd = path.resolve(options.root)
  const discovered = scanAll(discoverSources({ cwd, includeGlobal: options.global }))
  const managedInfo = inspectManaged(discovered.scans)

  if (options.command === "scan") {
    if (options.json) {
      console.log(
        JSON.stringify(
          { tool: "skills-doctor", version: pkg.version, cwd, skills: serializeSkills(discovered.skills, managedInfo.managed) },
          null,
          2,
        ),
      )
      return
    }
    printScan(discovered, options, managedInfo.managed)
    return
  }

  if (options.command === "update") {
    process.exitCode = await runUpdate(discovered, options, cwd)
    return
  }

  const result = runCheck(discovered, options, managedInfo)
  if (options.json) {
    console.log(JSON.stringify({ ...result, skills: serializeSkills(discovered.skills, managedInfo.managed) }, null, 2))
  } else {
    printCheck(result, options)
  }
  process.exitCode = result.exitCode
}
