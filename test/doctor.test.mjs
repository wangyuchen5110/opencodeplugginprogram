import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { fileURLToPath } from "node:url"

import { parseFrontmatter, estimateTokens, displayWidth } from "../src/parse.mjs"
import { discoverSources, scanAll, stripJsonc, findProjectRoot, pathChain } from "../src/discover.mjs"
import { lint, resolveWinners, summarize } from "../src/lint.mjs"
import { updateCatalogs, validateCatalogEntry } from "../src/catalog.mjs"
import { planFixes, applyFixes, hideSkills } from "../src/fix.mjs"
import { auditSkills, formatMarkdown } from "../src/audit.mjs"
import { normalizeLang, translator } from "../src/i18n.mjs"
import { main } from "../src/cli.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))

/** 在进程内跑 CLI，避免沙箱里 spawn 子进程被拒。 */
async function runCli(argv) {
  const logs = []
  const originalLog = console.log
  const originalError = console.error
  const originalExitCode = process.exitCode
  console.log = (...args) => logs.push(args.join(" "))
  console.error = (...args) => logs.push(args.join(" "))
  try {
    await main(argv)
    return { output: logs.join("\n"), exitCode: process.exitCode ?? 0 }
  } finally {
    console.log = originalLog
    console.error = originalError
    process.exitCode = originalExitCode
  }
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skills-doctor-"))
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function skill(dir, id, frontmatter = "description: test skill", body = "body") {
  write(path.join(dir, id, "SKILL.md"), `---\n${frontmatter}\n---\n${body}\n`)
}

test("frontmatter: 基本字段、含冒号的值、嵌套 metadata", () => {
  const text = [
    "---",
    'name: "Git Release"',
    "description: Prepare: notes",
    "metadata:",
    "  opencode/autoinvoke: false",
    "disable-model-invocation: true",
    "---",
    "# Body",
  ].join("\n")

  const { data, body, hasFrontmatter } = parseFrontmatter(text)
  assert.equal(hasFrontmatter, true)
  assert.equal(data.name, "Git Release")
  assert.equal(data.description, "Prepare: notes")
  assert.equal(data.metadata["opencode/autoinvoke"], false)
  assert.equal(data["disable-model-invocation"], true)
  assert.match(body, /# Body/)
})

test("frontmatter: 块标量 >", () => {
  const { data } = parseFrontmatter("---\ndescription: >\n  line one\n  line two\n---\nbody")
  assert.equal(data.description, "line one line two")
})

test("frontmatter: 没有 frontmatter 时原样返回", () => {
  const { data, body, hasFrontmatter } = parseFrontmatter("# plain markdown")
  assert.equal(hasFrontmatter, false)
  assert.deepEqual(data, {})
  assert.equal(body, "# plain markdown")
})

test("token/宽度估算对 CJK 合理", () => {
  assert.ok(estimateTokens("你好世界") >= 2)
  assert.ok(estimateTokens("hello world") >= 2)
  assert.equal(displayWidth("abc"), 3)
  assert.equal(displayWidth("中文"), 4)
})

test("stripJsonc: 注释与尾逗号", () => {
  const raw = `{
    // line comment
    "skills": ["./a", "./b"], /* block */
    "name": "http://not-a-comment",
  }`
  const parsed = JSON.parse(stripJsonc(raw))
  assert.deepEqual(parsed.skills, ["./a", "./b"])
  assert.equal(parsed.name, "http://not-a-comment")
})

test("discovery: 全局/项目/兼容目录/配置数组，且 config 优先级最高", () => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))

  skill(path.join(project, ".opencode", "skills"), "alpha")
  write(path.join(project, ".opencode", "skills", "beta.md"), "---\ndescription: flat skill\n---\n")
  skill(path.join(project, ".claude", "skills"), "gamma")
  skill(path.join(project, "extra"), "delta")
  write(path.join(project, "opencode.jsonc"), `{ "skills": ["./extra"] }`)

  const found = scanAll(discoverSources({ cwd: project, home }))
  const ids = found.skills.map((s) => s.id).sort()
  assert.deepEqual(ids, ["alpha", "beta", "delta", "gamma"])

  const byId = new Map(found.skills.map((s) => [s.id, s]))
  assert.ok(byId.get("delta").order > byId.get("alpha").order, "config 里的路径应最后注册（优先级最高）")
  assert.ok(byId.get("beta").form === "flat")
})

test("discovery: 项目根到 cwd 逐级扫描，且不会把子目录里的普通 md 当 skill", () => {
  const home = tmpdir()
  const root = tmpdir()
  fs.mkdirSync(path.join(root, ".git"))
  const sub = path.join(root, "packages", "app")
  fs.mkdirSync(sub, { recursive: true })

  skill(path.join(root, ".opencode", "skills"), "root-skill")
  skill(path.join(sub, ".opencode", "skills"), "sub-skill")
  write(path.join(root, ".opencode", "skills", "nested", "notes.md"), "---\ndescription: not a skill\n---\n")

  const found = scanAll(discoverSources({ cwd: sub, home }))
  const ids = found.skills.map((s) => s.id).sort()
  assert.deepEqual(ids, ["root-skill", "sub-skill"])
})

test("shadowed: 同 ID 多来源时项目定义生效", () => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))

  skill(path.join(home, ".config", "opencode", "skills"), "dup", "description: global dup")
  skill(path.join(project, ".opencode", "skills"), "dup", "description: project dup")

  const found = scanAll(discoverSources({ cwd: project, home }))
  const findings = lint(found.skills)
  const shadow = findings.find((f) => f.rule === "shadowed" && f.skills.includes("dup"))
  assert.ok(shadow, "应报告 shadowed")
  assert.equal(shadow.severity, "warn")

  const winners = resolveWinners(found.skills)
  assert.equal(winners.get("dup").description, "project dup")
})

test("lint: 预算、长描述、缺失描述、重复正文", () => {
  const dir = tmpdir()
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))

  const long = "x".repeat(300)
  for (let i = 0; i < 3; i++) {
    skill(path.join(project, ".opencode", "skills"), `budget-${i}`, `description: ${long}`)
  }
  write(path.join(project, ".opencode", "skills", "no-desc.md"), "---\nname: No Desc\n---\nbody")
  skill(path.join(project, ".opencode", "skills"), "dup-a", "description: same body", "identical body")
  skill(path.join(project, ".opencode", "skills"), "dup-b", "description: same body too", "identical body")

  const found = scanAll(discoverSources({ cwd: project, home }))
  const findings = lint(found.skills, { budget: 50 })
  const rules = findings.map((f) => f.rule)

  assert.ok(rules.includes("token-budget"), "应触发 token 预算")
  assert.ok(rules.includes("long-description"), "应触发长描述")
  assert.ok(rules.includes("missing-description"), "应触发缺失描述")
  assert.ok(rules.includes("duplicate-content"), "应触发重复正文")
})

test("lint: 相近描述与隐藏 skill", () => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))

  skill(path.join(project, ".opencode", "skills"), "deploy-a", "description: deploy the app to production")
  skill(path.join(project, ".opencode", "skills"), "deploy-b", "description: deploy the app to production safely")
  skill(path.join(project, ".opencode", "skills"), "hidden-one", "description: hidden skill\nmetadata:\n  opencode/autoinvoke: false")

  const found = scanAll(discoverSources({ cwd: project, home }))
  const findings = lint(found.skills)
  const rules = findings.map((f) => f.rule)
  assert.ok(rules.includes("near-duplicate-description"))
  assert.ok(rules.includes("hidden-skill"))

  const summary = summarize(found.skills)
  assert.equal(summary.advertised, 2)
})

test("catalog 校验：拒绝路径穿越", () => {
  const problems = validateCatalogEntry({ name: "x", version: "1", files: ["../evil.md"] })
  assert.ok(problems.length > 0)
  const ok = validateCatalogEntry({ name: "x", version: "1", files: ["SKILL.md"] })
  assert.deepEqual(ok, [])
})

test("更新器：下载、写 lock、增量跳过、版本检测", async () => {
  let version = "1"
  const server = http.createServer((req, res) => {
    if (req.url === "/skills/index.json") {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ skills: [{ name: "hello", version, files: ["SKILL.md", "references/note.md"] }] }))
      return
    }
    if (req.url === "/skills/hello/SKILL.md") {
      res.end("---\nname: Hello\ndescription: hello skill\n---\nbody")
      return
    }
    if (req.url === "/skills/hello/references/note.md") {
      res.end("# note")
      return
    }
    res.statusCode = 404
    res.end("not found")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/skills`
  const into = tmpdir()

  try {
    const first = await updateCatalogs([{ url }], { into })
    assert.equal(first.results[0].error, null)
    assert.equal(first.results[0].updated.length, 1)
    assert.ok(fs.existsSync(path.join(into, "hello", "SKILL.md")))
    assert.ok(fs.existsSync(path.join(into, "hello", "references", "note.md")))
    assert.ok(fs.existsSync(path.join(into, ".skills-doctor.lock.json")))

    const second = await updateCatalogs([{ url }], { into })
    assert.equal(second.results[0].updated.length, 0)
    assert.deepEqual(second.results[0].unchanged, ["hello"])

    version = "2"
    const check = await updateCatalogs([{ url }], { into, checkOnly: true })
    assert.equal(check.results[0].updated.length, 1)
    assert.equal(check.results[0].updated[0].previous, "1")
    assert.equal(check.results[0].updated[0].version, "2")

    const third = await updateCatalogs([{ url }], { into })
    assert.equal(third.results[0].updated[0].version, "2")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("CLI: --json 输出可解析，干净项目退出码 0", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "clean", "description: a clean skill")

  const result = await runCli(["check", "--root", project, "--no-global", "--json"])

  assert.equal(result.exitCode, 0)
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.tool, "skills-doctor")
  assert.equal(parsed.summary.total, 1)
  assert.equal(parsed.summary.unique, 1)
  assert.equal(parsed.counts.errors, 0)
  assert.ok(Array.isArray(parsed.skills))
})

test("CLI: 有 error 时退出码 1", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  const long = "y".repeat(400)
  for (let i = 0; i < 8; i++) skill(path.join(project, ".opencode", "skills"), `many-${i}`, `description: ${long}`)

  const result = await runCli(["check", "--root", project, "--no-global", "--budget", "10"])
  assert.equal(result.exitCode, 1, result.output)
})

test("discovery: 跟随符号链接的 skill 目录（真实环境常见）", (t) => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  const outside = tmpdir()
  skill(outside, "linked")

  const link = path.join(project, ".opencode", "skills", "linked")
  fs.mkdirSync(path.dirname(link), { recursive: true })
  try {
    fs.symlinkSync(path.join(outside, "linked"), link, process.platform === "win32" ? "junction" : "dir")
  } catch (err) {
    t.skip(`无法创建符号链接: ${err.code}`)
    return
  }

  const found = scanAll(discoverSources({ cwd: project, home }))
  assert.ok(found.skills.some((s) => s.id === "linked"))
})

test("工具函数: findProjectRoot / pathChain", () => {
  const root = tmpdir()
  fs.mkdirSync(path.join(root, ".git"))
  const deep = path.join(root, "a", "b")
  fs.mkdirSync(deep, { recursive: true })
  assert.equal(findProjectRoot(deep), root)
  assert.deepEqual(pathChain(root, deep), [root, path.join(root, "a"), deep])
})

async function startCatalog(getVersion = () => "1") {
  const server = http.createServer((req, res) => {
    if (req.url === "/skills/index.json") {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ skills: [{ name: "hello", version: getVersion(), files: ["SKILL.md"] }] }))
      return
    }
    if (req.url === "/skills/hello/SKILL.md") {
      res.end("---\nname: Hello\ndescription: hello skill\n---\nbody")
      return
    }
    res.statusCode = 404
    res.end("not found")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/skills`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test("闭环：update 默认落 .opencode/skills，check 立刻检测到并标记版本", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  const catalog = await startCatalog()

  try {
    write(path.join(project, "opencode.jsonc"), `{ "skills": ["${catalog.url}"] }`)

    const update = await runCli(["update", "--root", project, "--no-global"])
    assert.equal(update.exitCode, 0, update.output)
    assert.ok(fs.existsSync(path.join(project, ".opencode", "skills", "hello", "SKILL.md")))
    assert.ok(fs.existsSync(path.join(project, ".opencode", "skills", ".skills-doctor.lock.json")))

    const check = await runCli(["check", "--root", project, "--no-global", "--json"])
    assert.equal(check.exitCode, 0, check.output)
    const parsed = JSON.parse(check.output)
    assert.equal(parsed.summary.total, 1)
    assert.equal(parsed.managed.count, 1)
    assert.equal(parsed.skills[0].managed.version, "1")
    assert.ok(!parsed.findings.some((f) => f.rule.startsWith("managed-")))
  } finally {
    await catalog.close()
  }
})

test("闭环：更新后改了文件，check 报 drift；重新 update 后恢复", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  const catalog = await startCatalog()
  const skillFile = path.join(project, ".opencode", "skills", "hello", "SKILL.md")

  try {
    write(path.join(project, "opencode.jsonc"), `{ "skills": ["${catalog.url}"] }`)
    await runCli(["update", "--root", project, "--no-global"])

    fs.writeFileSync(skillFile, "---\nname: Hello\ndescription: edited by hand\n---\nbody")
    const drifted = await runCli(["check", "--root", project, "--no-global", "--json"])
    const parsed = JSON.parse(drifted.output)
    assert.ok(parsed.findings.some((f) => f.rule === "managed-drift"), "应报告 drift")

    await runCli(["update", "--root", project, "--no-global"])
    const healed = await runCli(["check", "--root", project, "--no-global", "--json"])
    assert.ok(!JSON.parse(healed.output).findings.some((f) => f.rule === "managed-drift"))
  } finally {
    await catalog.close()
  }
})

test("向上兼容：lock 版本高于工具支持时仍能解析并提示", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "hello", "description: hello skill")
  write(
    path.join(project, ".opencode", "skills", ".skills-doctor.lock.json"),
    JSON.stringify({
      version: 99,
      futureField: { anything: true },
      catalogs: { "https://example.com/skills": { skills: { hello: { version: "3", files: {} } } } },
    }),
  )

  const result = await runCli(["check", "--root", project, "--no-global", "--json"])
  assert.equal(result.exitCode, 0)
  const parsed = JSON.parse(result.output)
  assert.ok(parsed.findings.some((f) => f.rule === "lock-version-unsupported"))
  assert.equal(parsed.skills[0].managed.version, "3")
})

test("向上兼容：旧版 lock（字符串版本、无哈希）不报 drift", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "hello", "description: hello skill")
  write(
    path.join(project, ".opencode", "skills", ".skills-doctor.lock.json"),
    JSON.stringify({ version: 1, catalogs: { "https://example.com/skills": { skills: { hello: "2" } } } }),
  )

  const result = await runCli(["check", "--root", project, "--no-global", "--json"])
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.skills[0].managed.version, "2")
  assert.ok(!parsed.findings.some((f) => f.rule === "managed-drift"))
})

test("fix: 归档被遮蔽的定义，保留生效版本", () => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(home, ".config", "opencode", "skills"), "dup", "description: global dup")
  skill(path.join(project, ".opencode", "skills"), "dup", "description: project dup")

  const found = scanAll(discoverSources({ cwd: project, home }))
  const { plan, skipped } = planFixes(found.skills)
  assert.equal(plan.length, 1)
  assert.equal(skipped.length, 0)

  const { moved, errors } = applyFixes(plan)
  assert.equal(errors.length, 0)
  assert.equal(moved.length, 1)
  assert.ok(fs.existsSync(moved[0].target))

  const after = scanAll(discoverSources({ cwd: project, home }))
  assert.equal(after.skills.length, 1)
  assert.equal(after.skills[0].description, "project dup")
  assert.ok(!lint(after.skills).some((f) => f.rule === "shadowed"))
})

test("fix: dry-run 不移动文件；由更新器管理的定义会跳过", () => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(home, ".config", "opencode", "skills"), "dup", "description: global dup")
  skill(path.join(project, ".opencode", "skills"), "dup", "description: project dup")

  const found = scanAll(discoverSources({ cwd: project, home }))
  const loser = found.skills.find((s) => s.description === "global dup")

  const dry = applyFixes(planFixes(found.skills).plan, { dryRun: true })
  assert.equal(dry.moved.length, 1)
  assert.ok(!fs.existsSync(dry.moved[0].target))
  assert.ok(fs.existsSync(loser.file))

  const managed = new Map([[loser.file, { version: "1", url: "https://example.com", root: loser.source.dir }]])
  const managedPlan = planFixes(found.skills, managed)
  assert.equal(managedPlan.plan.length, 0)
  assert.equal(managedPlan.skipped.length, 1)
})

test("fix CLI: --dry-run --json 列出将归档的文件", async () => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "dup", "description: project dup")
  skill(path.join(project, "extra"), "dup", "description: extra dup")
  write(path.join(project, "opencode.jsonc"), `{ "skills": ["./extra"] }`)

  const result = await runCli(["fix", "--root", project, "--json", "--dry-run"])
  assert.equal(result.exitCode, 0)
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.archived.length, 1)
  assert.ok(parsed.archived[0].to.includes(".skills-doctor-archive"))
  assert.ok(fs.existsSync(parsed.archived[0].from), "dry-run 不应移动文件")
})

test("i18n: 语言识别与中英文案", () => {
  assert.equal(normalizeLang("zh"), "zh")
  assert.equal(normalizeLang("zh-CN"), "zh")
  assert.equal(normalizeLang("en-US"), "en")
  assert.equal(normalizeLang("fr"), null)

  const en = translator("en")
  const zh = translator("zh")
  assert.match(en("check.none"), /No problems/)
  assert.match(zh("check.none"), /没有发现问题/)
  assert.equal(zh("help", { version: "9.9.9" }).includes("9.9.9"), true)
  // 缺失 key 回退英文
  assert.equal(zh("no.such.key"), "no.such.key")
})

test("i18n CLI: --lang zh 输出中文 finding 文案", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "dup", "description: project dup")
  skill(path.join(project, "extra"), "dup", "description: extra dup")
  write(path.join(project, "opencode.jsonc"), `{ "skills": ["./extra"] }`)

  const zhRun = await runCli(["check", "--root", project, "--json", "--lang", "zh"])
  const zhParsed = JSON.parse(zhRun.output)
  assert.equal(zhParsed.lang, "zh")
  const shadowed = zhParsed.findings.find((f) => f.rule === "shadowed")
  assert.match(shadowed.message, /被遮蔽/)

  const enRun = await runCli(["check", "--root", project, "--json", "--lang", "en"])
  const enParsed = JSON.parse(enRun.output)
  const enShadowed = enParsed.findings.find((f) => f.rule === "shadowed")
  assert.match(enShadowed.message, /shadowed/)
})

test("config: budget 与规则覆盖生效", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "cfg", `description: ${"z".repeat(300)}`)
  write(
    path.join(project, ".skills-doctor.json"),
    JSON.stringify({ budget: 1, rules: { "long-description": "off" } }),
  )

  const result = await runCli(["check", "--root", project, "--no-global", "--json"])
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.config.budget, 1)
  assert.ok(parsed.findings.some((f) => f.rule === "token-budget"))
  assert.ok(!parsed.findings.some((f) => f.rule === "long-description"))
})

test("config: ignore 列表过滤对应 finding", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "chatty", `description: ${"q".repeat(300)}`)
  write(path.join(project, ".skills-doctor.json"), JSON.stringify({ ignore: ["chatty"] }))

  const result = await runCli(["check", "--root", project, "--no-global", "--json"])
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.findings.length, 0)
})

test("fix --hide: 写入 autoinvoke:false，dry-run 不改文件", () => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "visible", "description: visible skill")
  const file = path.join(project, ".opencode", "skills", "visible", "SKILL.md")

  const found = scanAll(discoverSources({ cwd: project, home }))
  const dry = hideSkills(found.skills, ["visible"], { dryRun: true })
  assert.equal(dry.changed.length, 1)
  assert.ok(!parseFrontmatter(fs.readFileSync(file, "utf8")).data.metadata)

  hideSkills(found.skills, ["visible"])
  const fm = parseFrontmatter(fs.readFileSync(file, "utf8"))
  assert.equal(fm.data.metadata["opencode/autoinvoke"], false)
  assert.match(fm.body, /body/)

  const after = scanAll(discoverSources({ cwd: project, home }))
  assert.equal(after.skills[0].hidden, true)
})

test("fix --hide: 没有 frontmatter 的文件也能加", () => {
  const home = tmpdir()
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  const file = path.join(project, ".opencode", "skills", "plain.md")
  write(file, "just body text")

  const found = scanAll(discoverSources({ cwd: project, home }))
  hideSkills(found.skills, ["plain"])
  const fm = parseFrontmatter(fs.readFileSync(file, "utf8"))
  assert.equal(fm.data.metadata["opencode/autoinvoke"], false)
  assert.match(fm.body, /just body text/)
})

test("fix CLI: --hide --dry-run --json", async () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "a", "description: a skill")
  skill(path.join(project, ".opencode", "skills"), "b", "description: b skill")

  const result = await runCli(["fix", "--root", project, "--no-global", "--json", "--dry-run", "--hide", "a,b,missing"])
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.hidden.length, 2)
  assert.deepEqual(parsed.missing, ["missing"])
  assert.ok(parsed.dryRun)
})

test("audit: 结构化结果与 markdown 渲染", () => {
  const project = tmpdir()
  fs.mkdirSync(path.join(project, ".git"))
  skill(path.join(project, ".opencode", "skills"), "alpha", "description: alpha skill")
  skill(path.join(project, ".opencode", "skills"), "alpha2", "description: alpha skill duplicate-ish")

  const audit = auditSkills({ cwd: project, includeGlobal: false, lang: "en" })
  assert.equal(audit.lang, "en")
  assert.equal(audit.summary.unique, 2)
  assert.ok(audit.findings.length >= 1)

  const md = formatMarkdown(audit)
  assert.match(md, /^# skills-doctor/)
  assert.match(md, /Findings:/)
  assert.match(md, /alpha/)
})
