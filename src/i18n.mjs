// 中英双语文案。所有用户可见文本都在这里，代码只引用 key。
// 新增语言时复制一份字典即可；缺失的 key 回退到英文。

const dict = {
  en: {
    help: `skills-doctor {version} — local scanner, linter, fixer, updater and plugin for OpenCode skills

Usage:
  skills-doctor check  [options]   check sources, conflicts and context budget (default)
  skills-doctor scan   [options]   list every skill with its source and precedence
  skills-doctor fix    [options]   archive shadowed definitions (safe structural fixes)
  skills-doctor update [options]   compare and download skills from HTTP catalogs

Options:
  --root <dir>         working directory (default: current directory)
  --no-global          skip ~/.claude, ~/.agents and ~/.config/opencode
  --budget <n>         tokens allowed for advertised descriptions (default 1200)
  --stale-days <n>     report skills not updated in n days (default: off)
  --strict             exit non-zero on warnings too
  --json               print JSON
  --lang <en|zh>       output language (default: auto from system locale)
  --config <file>      config file (default: .skills-doctor.json)
  --dry-run            fix: only print what would change
  --all                fix: also touch global sources (default: project only)
  --hide <ids>         fix: hide skills with metadata.opencode/autoinvoke: false (comma separated)
  --into <dir>         update: output directory (default: .opencode/skills)
  --check-only         update: only report available updates
  -h, --help           show this help
  -v, --version        print version

Exit codes: 0 ok; 1 errors (and warnings with --strict); 2 bad arguments or runtime error`,

    "check.title": "skills-doctor {version}",
    "check.workdir": "  working dir: {dir}",
    "check.projectRoot": "  project root: {dir}",
    "check.config": "  config: {file}",
    "check.sources":
      "  sources: {total} ({existing} exist)  definitions: {definitions}  unique IDs: {unique}  advertised: {advertised}  description budget: ~{tokens} tokens",
    "check.catalogs": "  HTTP catalogs: {count} (use update --check-only for versions)",
    "check.managed": "  managed by updater: {count} (lock-verified; see managed-* notices)",
    "check.configError": "  ! cannot parse config: {path} ({error})",
    "check.missingPath": "  ! path in config does not exist: {path}",
    "check.none": "No problems found.",
    "check.summary": "{errors} error, {warnings} warn, {infos} info",
    "check.strict": " (--strict: warnings also fail)",
    "check.hints": "Hints:",

    "scan.title": "skills-doctor {version} — scan",
    "scan.workdir": "  working dir: {dir}",
    "scan.projectRoot": "  project root: {dir}",
    "scan.col.id": "ID",
    "scan.col.scope": "scope",
    "scan.col.adv": "adv",
    "scan.col.desc": "desc",
    "scan.col.body": "body",
    "scan.col.file": "file",
    "scan.winner": "  * = effective definition for this ID (later registration wins)",
    "scan.catalogs": "  HTTP catalogs: {urls}",

    "update.title": "Updater",
    "update.titleCheckOnly": "Updater (check only)",
    "update.into": "  output dir: {dir}",
    "update.failed": "  ✗ failed: {error}",
    "update.updated": "  ✓ {label} {count}: {items}",
    "update.labelUpdated": "updated",
    "update.labelAvailable": "available",
    "update.unchanged": "  · unchanged {count}",
    "update.files": "  · files written {count}",
    "update.skipped": "  ! skipped {name}: {problems}",
    "update.empty": "  · catalog is empty",
    "update.lock": "  lock: {path} ({name})",
    "update.lockTooNew": "  ! lock is newer than this tool; parsed in compatibility mode (unknown fields ignored)",
    "update.detector": "  check now sees these skills ({dir} is where opencode reads)",
    "update.noCatalogs": "No HTTP catalog configured. Add https://... to the skills array in opencode.json(c).",
    "update.driftRepair": "{name} {version} (drift repaired)",
    "update.versioned": "{name} {version}",
    "update.versionBump": "{name} {previous}→{version}",

    "fix.title": "Fixer",
    "fix.dryRun": "  (dry run: nothing is moved)",
    "fix.moved": "  ✓ archived {from} → {to}",
    "fix.skippedManaged": "  · skipped {path} (installed by the updater; run update instead)",
    "fix.skippedGlobal": "  · skipped {path} (global skill; pass --all to include)",
    "fix.none": "Nothing to fix.",
    "fix.summary": "{moved} archived, {hidden} hidden, {skipped} skipped",
    "fix.error": "  ✗ failed to archive {path}: {error}",
    "fix.rerun": "Run `skills-doctor check` again to confirm.",
    "fix.hidden": "  ✓ hid {id} ({file})",
    "fix.unknownHide": "  ! unknown skill id: {id}",
    "config.error": "  ! cannot read config: {file} ({error})",

    "hint.shadowed":
      "Delete the shadowed definitions or give them distinct IDs; otherwise you may be editing a file that never loads.",
    "hint.flat-dir-collision": "Keep only one of the two forms in the same source.",
    "hint.duplicate-content": "Merge into one skill and reference it from the other.",
    "hint.near-duplicate-description": "Make descriptions more specific, or merge the skills.",
    "hint.missing-description": "Add a description — the model only sees ID, name and description.",
    "hint.long-description": "Keep the description to one or two sentences; move details into the body or references/.",
    "hint.large-body": "Move details into references/ and keep SKILL.md to the workflow.",
    "hint.token-budget":
      "Trim descriptions, or hide low-frequency skills with metadata.opencode/autoinvoke: false.",
    "hint.too-many-skills": "Hide low-frequency skills with autoinvoke: false and load them explicitly with @id.",
    "hint.invalid-id": "Use lowercase kebab-case and keep it aligned with the directory name.",
    "hint.hidden-skill": "Confirm the skill is intentionally hidden; hidden skills are not advertised.",
    "hint.stale-skill": "Confirm the content is still current, or delete it.",

    "lint.shadowed":
      'ID "{id}" is defined {count} times; the effective definition is {winner}; the other {losers} are shadowed (dead weight, easy to edit the wrong file)',
    "lint.flatDirCollision":
      'Both {flat} and {dir} exist in the same source (ID "{id}"), semantics are ambiguous',
    "lint.duplicateContent": "These skills have identical bodies: {ids}",
    "lint.nearDuplicate":
      '"{a}" and "{b}" descriptions are {score}% similar; the model may pick the wrong one',
    "lint.missingDescription":
      '"{id}" has no description, so the model will not discover it (only explicit @{id})',
    "lint.longDescription": '"{id}" description is {chars} chars; it is paid on every model step',
    "lint.hiddenSkill": '"{id}" is hidden (autoinvoke/disable-model-invocation); it is not advertised',
    "lint.invalidId": '"{id}" does not follow the recommended kebab-case ID pattern (1-64 chars, lowercase)',
    "lint.largeBody": '"{id}" body is about {tokens} tokens; invoking it pastes the whole body into context',
    "lint.staleSkill": '"{id}" has not been updated for {days} days',
    "lint.tokenBudget": "Advertised skill descriptions cost about {tokens} tokens per model step, over the {budget} budget",
    "lint.tokenBudgetError":
      "Advertised skill descriptions cost about {tokens} tokens per model step, over 2x the {budget} budget",
    "lint.tooManySkills": "{count} skills are advertised to the model (recommended ≤ 60)",

    "managed.lockUnsupported":
      "Lock version {version} is newer than the supported {supported}; parsing in compatibility mode (unknown fields ignored)",
    "managed.missing": "Catalog records {name}@{version}, but the local file is gone (deleted or renamed)",
    "managed.unsafe": "Unsafe path in the lock for {name}: {rel}",
    "managed.driftMissing": '"{name}" is missing {rel} (deleted after update?)',
    "managed.driftModified": '"{name}" {rel} was modified after update (drift); the next update will overwrite it',

    "catalog.indexHttp": "index.json returned HTTP {status}",
    "catalog.indexShape": "index.json is missing the skills array",
    "catalog.crossOrigin": "cross-origin file reference: {file}",
    "catalog.fileHttp": "{name}/{file} returned HTTP {status}",
    "catalog.unsafePath": "unsafe path: {rel}",
    "catalog.entryNotObject": "entry is not an object",
    "catalog.missingName": "missing name",
    "catalog.missingVersion": "missing version",
    "catalog.missingFiles": "missing files",
    "catalog.safePath": "unsafe file path: {file}",
    "catalog.missingEntryFile": "files has no SKILL.md or <name>.md",
  },

  zh: {
    help: `skills-doctor {version} —— OpenCode skill 本地检测器 / 更新器 / 修复器 / 插件

用法:
  skills-doctor check  [选项]   检查来源、冲突与上下文预算（默认命令）
  skills-doctor scan   [选项]   列出所有 skill 及其来源/优先级
  skills-doctor fix    [选项]   归档被遮蔽的定义（安全的结构性修复）
  skills-doctor update [选项]   对比并拉取 HTTP catalog 里的 skill

选项:
  --root <dir>        以该目录为工作目录（默认当前目录）
  --no-global         不扫描 ~/.claude、~/.agents、~/.config/opencode
  --budget <n>        模型每步可看的 description token 预算（默认 1200）
  --stale-days <n>    超过 n 天未更新的 skill 给出提示（默认关闭）
  --strict            有 warning 也返回非 0
  --json              输出 JSON
  --lang <en|zh>      输出语言（默认按系统 locale 自动选择）
  --config <file>     配置文件（默认 .skills-doctor.json）
  --dry-run           fix: 只打印将要变更的内容，不实际修改
  --all               fix: 同时处理全局来源的 skill（默认只动项目内）
  --hide <ids>        fix: 给指定 skill 加 metadata.opencode/autoinvoke: false（逗号分隔）
  --into <dir>        update 的落盘目录（默认 .opencode/skills）
  --check-only        update 只报告可用更新，不下载
  -h, --help          帮助
  -v, --version       版本

退出码: 0 正常；1 有 error（--strict 时含 warning）；2 参数/运行错误`,

    "check.title": "skills-doctor {version}",
    "check.workdir": "  工作目录: {dir}",
    "check.projectRoot": "  项目根:   {dir}",
    "check.config": "  配置: {file}",
    "check.sources":
      "  来源: {total} 个（存在 {existing} 个）  定义: {definitions}  唯一 ID: {unique}  会展示: {advertised}  描述预算: ~{tokens} tokens",
    "check.catalogs": "  HTTP catalog: {count} 个（用 update --check-only 查版本）",
    "check.managed": "  由更新器管理: {count} 个（lock 版本校验，见 managed-* 提示）",
    "check.configError": "  ! 配置文件无法解析: {path}（{error}）",
    "check.missingPath": "  ! 配置里引用的路径不存在: {path}",
    "check.none": "没有发现问题。",
    "check.summary": "{errors} error, {warnings} warn, {infos} info",
    "check.strict": "（--strict：warning 也会非 0 退出）",
    "check.hints": "建议:",

    "scan.title": "skills-doctor {version} — scan",
    "scan.workdir": "  工作目录: {dir}",
    "scan.projectRoot": "  项目根:   {dir}",
    "scan.col.id": "ID",
    "scan.col.scope": "scope",
    "scan.col.adv": "adv",
    "scan.col.desc": "desc",
    "scan.col.body": "body",
    "scan.col.file": "file",
    "scan.winner": "  * = 该 ID 的实际生效定义（注册顺序越后优先级越高）",
    "scan.catalogs": "  HTTP catalog: {urls}",

    "update.title": "更新器",
    "update.titleCheckOnly": "更新器（仅检查）",
    "update.into": "  落盘目录: {dir}",
    "update.failed": "  ✗ 失败: {error}",
    "update.updated": "  ✓ {label} {count}: {items}",
    "update.labelUpdated": "已更新",
    "update.labelAvailable": "可更新",
    "update.unchanged": "  · 未变 {count}",
    "update.files": "  · 写入文件 {count}",
    "update.skipped": "  ! 跳过 {name}: {problems}",
    "update.empty": "  · catalog 为空",
    "update.lock": "  lock: {path}（{name}）",
    "update.lockTooNew": "  ! lock 版本比本工具新，已按兼容模式解析（未知字段忽略）",
    "update.detector": "  check 现在可以直接检测到这些 skill（{dir} 是 opencode 会读取的目录）",
    "update.noCatalogs": "没有配置 HTTP catalog。在 opencode.json(c) 的 skills 数组里写 https://... 即可。",
    "update.driftRepair": "{name} {version}（修复 drift）",
    "update.versioned": "{name} {version}",
    "update.versionBump": "{name} {previous}→{version}",

    "fix.title": "修复器",
    "fix.dryRun": "  （dry run：不会移动任何文件）",
    "fix.moved": "  ✓ 已归档 {from} → {to}",
    "fix.skippedManaged": "  · 跳过 {path}（由更新器管理，请用 update）",
    "fix.skippedGlobal": "  · 跳过 {path}（全局 skill，加 --all 才会处理）",
    "fix.none": "没有需要修复的内容。",
    "fix.summary": "归档 {moved} 个，隐藏 {hidden} 个，跳过 {skipped} 个",
    "fix.error": "  ✗ 归档 {path} 失败: {error}",
    "fix.rerun": "再跑一次 `skills-doctor check` 确认。",
    "fix.hidden": "  ✓ 已隐藏 {id}（{file}）",
    "fix.unknownHide": "  ! 找不到 skill ID: {id}",
    "config.error": "  ! 无法读取配置: {file}（{error}）",

    "hint.shadowed": "删掉被遮蔽的旧定义，或改用不同 ID；否则你改的和实际加载的可能不是同一份。",
    "hint.flat-dir-collision": "同一来源里两种形式二选一，避免 ID 语义不清。",
    "hint.duplicate-content": "合并成一份，另一处改为引用。",
    "hint.near-duplicate-description": "把 description 写得更具体，或直接合并成一个 skill。",
    "hint.missing-description": "补 description —— 模型只能看到 ID、name、description。",
    "hint.long-description": "description 压到一两句话，细节放正文或 references/。",
    "hint.large-body": "正文拆到 references/，SKILL.md 只保留流程。",
    "hint.token-budget": "精简 description，或把低频 skill 设为 metadata.opencode/autoinvoke: false 隐藏。",
    "hint.too-many-skills": "低频 skill 关掉 autoinvoke，用 @id 手动加载。",
    "hint.invalid-id": "改成小写 kebab-case，并与目录名对齐。",
    "hint.hidden-skill": "确认是刻意隐藏；隐藏的 skill 不会出现在模型列表里。",
    "hint.stale-skill": "确认内容没过期，或删掉。",

    "lint.shadowed":
      'ID "{id}" 有 {count} 处定义，实际生效的是 {winner}；其余 {losers} 处被遮蔽（白占体积、容易改错文件）',
    "lint.flatDirCollision": '同一来源同时存在 {flat} 与 {dir}（ID 都是 "{id}"），语义不明确',
    "lint.duplicateContent": "这些 skill 的正文完全相同：{ids}",
    "lint.nearDuplicate": '"{a}" 与 "{b}" 的描述相似度 {score}%，模型容易选错',
    "lint.missingDescription": '"{id}" 没有 description，模型不会发现它（只能 @{id} 手动加载）',
    "lint.longDescription": '"{id}" 的 description 有 {chars} 字符，每个模型步骤都会占上下文',
    "lint.hiddenSkill": '"{id}" 被隐藏（autoinvoke/disable-model-invocation），不会出现在模型列表里',
    "lint.invalidId": '"{id}" 不符合推荐的 kebab-case ID 规范（1-64 字符、小写）',
    "lint.largeBody": '"{id}" 正文约 {tokens} tokens，被调用时会整段塞进上下文',
    "lint.staleSkill": '"{id}" 已经 {days} 天没有更新',
    "lint.tokenBudget": "模型每步要看到的 skill 描述约 {tokens} tokens，超过预算 {budget}",
    "lint.tokenBudgetError": "模型每步要看到的 skill 描述约 {tokens} tokens，超过预算 {budget} 的 2 倍",
    "lint.tooManySkills": "有 {count} 个 skill 会展示给模型（建议 ≤ 60）",

    "managed.lockUnsupported":
      "lock 版本 {version} 高于本工具支持的 {supported}，已按兼容模式解析（未知字段忽略）",
    "managed.missing": "catalog 记录 {name}@{version}，但本地没有对应文件（可能被删除或改名）",
    "managed.unsafe": "lock 里 {name} 的文件路径不安全: {rel}",
    "managed.driftMissing": '"{name}" 的 {rel} 缺失（更新后被删除了？）',
    "managed.driftModified": '"{name}" 的 {rel} 在更新后被修改过（drift），下次 update 会覆盖',

    "catalog.indexHttp": "index.json 返回 HTTP {status}",
    "catalog.indexShape": "index.json 缺少 skills 数组",
    "catalog.crossOrigin": "跨域文件引用: {file}",
    "catalog.fileHttp": "{name}/{file} 返回 HTTP {status}",
    "catalog.unsafePath": "不安全路径: {rel}",
    "catalog.entryNotObject": "条目不是对象",
    "catalog.missingName": "缺少 name",
    "catalog.missingVersion": "缺少 version",
    "catalog.missingFiles": "缺少 files",
    "catalog.safePath": "不安全的文件路径: {file}",
    "catalog.missingEntryFile": "files 里没有 SKILL.md 或 <name>.md",
  },
}

export const SUPPORTED_LANGS = Object.keys(dict)

export function normalizeLang(value) {
  if (!value) return null
  const v = String(value).trim().toLowerCase()
  if (v.startsWith("zh")) return "zh"
  if (v.startsWith("en")) return "en"
  return null
}

export function detectLang() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || ""
    if (locale.toLowerCase().startsWith("zh")) return "zh"
  } catch {}
  return "en"
}

export function translator(lang) {
  const primary = dict[lang] ?? dict.en
  return (key, params = {}) => {
    const template = primary[key] ?? dict.en[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? "").toString())
  }
}
