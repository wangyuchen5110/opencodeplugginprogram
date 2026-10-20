# skills-doctor

[![test](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml/badge.svg)](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml)

OpenCode skill 的**本地检测器 + 更新器 + 修复器**，并附带 **OpenCode 插件入口** —— 零依赖，Node ≥ 20。

[English](README.md) | **简体中文**

## 为什么需要它

opencode 每个模型步骤都会把所有「有 description 的 skill」展示给模型（`ID + name + description`）。skill 一多、一杂，就会出现**上下文膨胀、描述撞车、同 ID 互相遮蔽、改错文件、静默失效**。

`skills-doctor` 在本地把这些都查出来，并且能从 HTTP catalog 更新 skill、校验更新结果。

## 快速开始

```powershell
# 直接在仓库里跑（免安装）
node bin/skills-doctor.mjs check

# 或本地安装
npm link
skills-doctor check
```

## 命令

所有命令都支持 `--lang en|zh`（默认按系统 locale 自动选择）和 `--json`。

### `check`（默认）

扫描所有 skill 来源，输出问题清单、上下文预算和修复建议。

```powershell
skills-doctor check
skills-doctor check --json
skills-doctor check --budget 800 --strict    # CI 用
skills-doctor check --root .\some-project --no-global
```

### `scan`

列出所有 skill 及其来源、优先级、是否会被模型看到、token 占用。

```powershell
skills-doctor scan
```

`*` 表示该 ID 的实际生效定义（注册顺序越后优先级越高）。

### `fix`

归档被遮蔽的定义——那些因为同 ID 已被更高优先级来源覆盖、永远不会加载的文件。操作可逆：文件会被移动到同一来源下的 `.skills-doctor-archive/<时间戳>/`，opencode 不会读取点目录。

```powershell
skills-doctor fix --dry-run   # 预览会归档哪些
skills-doctor fix
skills-doctor fix --hide academic-paper,deep-research --dry-run   # 隐藏低频 skill，给预算减压
```

- 只动被遮蔽的重复定义，生效版本永远不会被移动；
- 由 `update` 安装的文件会跳过——用 `update` 恢复；
- 修完再跑 `check`，`shadowed` 应该消失。

### `update`（更新器）

从 `opencode.json(c)` 的 `skills` 数组里读取 HTTP catalog，对比 `version`，把有变化的 skill 下载到本地。

```powershell
skills-doctor update                 # 默认装进 .opencode/skills（opencode 会直接读取）
skills-doctor update --check-only    # 只看有没有更新
skills-doctor update --into .\team-skills
```

- 落盘位置就是 opencode 的 skill 目录 → **更新完 `check` 立刻能检测到**；
- 写 `.skills-doctor.lock.json`（v2：记录每个文件的 sha1）；
- `check` 会读这个 lock：显示托管版本、发现文件被手改（`managed-drift`）、文件被删（`managed-missing`）；
- 再跑一次 `update` 会自动重下被改坏的文件（drift 自愈）。

## 配置

在工作目录放一个可选的 `.skills-doctor.json`（或用 `--config <file>` 指定）：

```json
{
  "budget": 1200,
  "staleDays": 180,
  "lang": "en",
  "rules": { "long-description": "off", "hidden-skill": "info" },
  "ignore": ["legacy-skill"]
}
```

`rules` 接受 `off` / `info` / `warn` / `error`；`ignore` 会丢掉只涉及这些 ID 的 finding。命令行参数优先级高于配置文件。

## OpenCode 插件

这个包同时导出 OpenCode 2.x 插件：

```jsonc
// opencode.jsonc
{
  "plugins": ["opencode-skills-doctor"]
}
```

它会注册：

- `skills_doctor` 工具（命名空间 `skills`）—— agent 传 `{ directory?, budget? }` 就能拿到 markdown 审计报告；
- `/skills-doctor` 命令 —— 让 agent 跑一次审计并总结修复建议。

`@opencode/plugin` 是可选 peer 依赖，运行时由 OpenCode 提供。

## 检测规则

| 规则 | 级别 | 含义 |
|---|---|---|
| `shadowed` | warn | 同一 ID 多处定义，只有一份生效，其余白占体积且容易改错 |
| `flat-dir-collision` | warn | 同一来源同时存在 `<id>.md` 和 `<id>/SKILL.md` |
| `duplicate-content` | warn | 不同 skill 正文完全相同 |
| `near-duplicate-description` | warn | 两个 skill 的 description 相似度 ≥ 75%，模型容易选错 |
| `missing-description` | info | 没有 description，模型看不到它 |
| `long-description` | warn | description > 240 字符（每个模型步骤都占上下文） |
| `large-body` | warn | 正文 > 4000 tokens（调用时整段进上下文） |
| `token-budget` | warn/error | 模型每步要看的描述总量超过预算（默认 1200） |
| `too-many-skills` | warn/error | 展示给模型的 skill 超过 60 / 100 个 |
| `invalid-id` | info | 不符合 kebab-case 规范 |
| `hidden-skill` | info | 被 `opencode/autoinvoke: false` 或 `disable-model-invocation: true` 隐藏 |
| `stale-skill` | info | `--stale-days` 指定的天数内没更新 |
| `managed-drift` | warn | 由 update 安装的文件在更新后被改过 |
| `managed-missing` | warn | lock 里记录了，但本地文件没了 |
| `managed-unsafe` | warn | lock 里有路径穿越等不安全路径 |
| `lock-version-unsupported` | info | lock 版本比工具新，已按兼容模式解析 |

## 向上兼容（forward compatibility）

- **lock**：支持版本 1（字符串版本、无哈希）和版本 2（带文件 sha1）；遇到更高版本时按兼容模式解析，未知字段忽略，只在报告里提示一条 `lock-version-unsupported`。
- **catalog index.json**：只读 `skills[].name/version/files`，其余字段（未来新增的）一律忽略。
- **skill frontmatter**：只读 `name/description/metadata.opencode/autoinvoke/disable-model-invocation`，其它字段原样忽略。
- **路径**：同时支持 2.0 的 `.opencode/skills`、`~/.config/opencode/skills`，以及兼容目录 `.claude/skills`、`.agents/skills`（含逐级向上搜索）。
- 更新器写出的 lock 固定为当前支持的最高版本，旧检测器不会因为新字段报错。

## 扫描来源（低 → 高优先级）

1. `~/.claude/skills`
2. 项目 `.claude/skills`（项目根 → 当前目录逐级）
3. `~/.agents/skills`
4. 项目 `.agents/skills`
5. `~/.config/opencode/skills`
6. 项目 `.opencode/skills`
7. `opencode.json(c)` 的 `skills` 数组（相对路径按当前工作目录解析，支持 `~/`、绝对路径、HTTP catalog）

## JSON 输出

`check --json` / `scan --json` / `update --json` 都会输出结构化 JSON，方便接 CI 或做网页报告。字段包括 `summary`、`findings[]`、`skills[]`（含 `managed: { version, url, root }`）。

## 已知限制

- 不联网时 `check` 只做本地检查；catalog 是否有新版本要用 `update --check-only`。
- token 估算是启发式（CJK 约 1.7 字/token，其余约 4 字符/token），用于横向比较，不是精确计费。
- 配置优先级假设：全局配置 < 项目配置 < `skills` 数组顺序；如与 opencode 实现有出入，以实际加载结果为准。
- 还不会自动改文件（v0.2 计划加 `--fix`：归档被遮蔽的定义、规范化 ID、裁剪描述）。

## Roadmap

- v0.4：内容层面的建议（哪些 skill 从未被使用）、catalog 签名校验
- 后续：V1/Claude skill 兼容迁移报告

## 开发

```powershell
npm test
```

测试覆盖：frontmatter 解析、来源发现与优先级、遮蔽/重复/预算规则、catalog 下载与 lock、drift 检测与自愈、旧/新 lock 的向上兼容、CLI JSON 与退出码。

MIT
