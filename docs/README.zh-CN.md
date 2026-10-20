# skills-doctor

[![test](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml/badge.svg)](https://github.com/wangyuchen5110/opencodeplugginprogram/actions/workflows/test.yml)

OpenCode skill 的**本地检测器 + 更新器 + 修复器**，并附带 **OpenCode 插件入口** —— 零依赖，Node ≥ 20。

[English](../README.md) | **简体中文**

## 为什么需要它

opencode 每个模型步骤都会把所有「有 description 的 skill」展示给模型（`ID + name + description`）。skill 不是免费的——它是**每一次请求都要交的上下文税**。

**成本有多大**：29 个 skill、描述偏长，就是**每步 3000+ tokens**。一次 100 步的会话，光 skill 目录就烧掉约 30 万 tokens，模型还没开始读你一行代码。而这只是 29 个——很多人还有更多没注意就装上的 skill，有些已经过时。这个工具能帮你真正看清自己的 skill 仓库。

**会出什么问题**：skill 越攒越多，就会出现
- 同 ID 互相遮蔽——你改的可能是一份永远不会加载的文件；
- 描述越来越像，模型选错 skill；
- 一堆没人注意的死重。

**`skills-doctor` 做什么**：把成本量出来、把「谁真正生效」指出来，并直接修：

- `check` —— 报告重复/遮蔽、超长描述、超大正文、每步 token 预算，并给修复建议；
- `scan` —— 列出每个 skill 的来源、优先级和成本；
- `fix` —— 归档被遮蔽的重复定义（可逆），或隐藏低频 skill（`autoinvoke: false`，仍可 `@id` 加载）；
- `update` —— 按版本从 HTTP catalog 同步 skill，带 lockfile 和 drift 检测；
- 插件 —— 在 OpenCode 会话里暴露 `skills_doctor` 工具 / `/skills-doctor` 命令。

CLI 和插件都同时支持 **OpenCode 1.x 和 2.x**。

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
- **默认只处理项目内的 skill**，要动全局来源（`~/.config/opencode/skills` 等）加 `--all`；
- 修完再跑 `check`，`shadowed` 应该消失。

### `update`（更新器）

从 `opencode.json(c)` 的 `skills` 数组里读取 HTTP catalog，对比 `version`，把有变化的 skill 下载到本地。

```powershell
skills-doctor update                 # 默认装进 .opencode/skills（opencode 会直接读取）
skills-doctor update --check-only    # 只看有没有更新
skills-doctor update --into .\team-skills
```

- 落盘位置就是 opencode 的 skill 目录 → **更新完 `check` 立刻能检测到**；
- 原地覆盖文件，并**删除新版本里已不存在的文件**（不会残留旧版本文件）；
- 写 `.skills-doctor.lock.json`（v2：记录每个文件的 sha1）；
- `check` 会读这个 lock：显示托管版本、发现文件被手改（`managed-drift`）、文件被删（`managed-missing`）；
- 再跑一次 `update` 会自动重下被改坏的文件（drift 自愈）；
- 用 `--prune` 删除 catalog 中已下架的 skill（默认只提示、不删）。

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

### OpenCode 1.x

1.x 用的是另一套插件 API：npm 插件会解析 `./server` 导出，运行时需要 `@opencode-ai/plugin`。最稳的接法是加一个一行的本地插件文件。

1. 先把包装到 OpenCode 解析插件的位置：

```powershell
npm i --prefix ~/.config/opencode opencode-skills-doctor
```

2. 新建 `~/.config/opencode/plugins/skills-doctor.js`：

```js
export { SkillsDoctorPlugin } from "opencode-skills-doctor/v1"
```

3. 在 `opencode.json` 里引用（1.x 用 `plugin`，不是 `plugins`）：

```jsonc
{
  "plugin": ["C:\\Users\\<you>\\.config\\opencode\\plugins\\skills-doctor.js"]
}
```

它会注册同样的 `skills_doctor` 工具（1.x 没有 `/skills-doctor` 命令钩子）。

> 包根入口是 V2 插件，需要 OpenCode 2.x；CLI 两条线都能用。

### 一键深度集成

```powershell
npx opencode-skills-doctor install
```

安装器会自动识别 OpenCode 版本并接好：

- **2.x** —— 在 `opencode.json(c)` 里加 `"plugins": ["opencode-skills-doctor"]`；
- **1.x** —— 把包装进 `~/.config/opencode`、写本地插件入口、生成 `/skills-doctor` 命令、补 `"type": "module"`；
- 改配置前会备份为 `<config>.bak-<timestamp>`。

支持 `--dry-run` 预览、`--config-dir <dir>` 指定配置目录、`--no-npm` 跳过装包。

装好后你会得到：

- `skills_doctor` 工具；
- `/skills-doctor` 命令（1.x 是生成的 markdown 命令，2.x 是插件命令）；
- 当 skill 描述预算超标时，系统提示里会注入一次提醒（每个会话最多一次）。

## MCP server（Claude Code、Codex、Kimi Code、任何 MCP 客户端）

`skills-doctor mcp` 用 stdio 讲 Model Context Protocol，只暴露一个工具：`skills_doctor`，参数 `directory?`、`budget?`、`lang?`、`global?`。不需要装 OpenCode。

Claude Code（项目里的 `.mcp.json`，或你的 MCP 配置）：

```json
{
  "mcpServers": {
    "skills-doctor": { "command": "npx", "args": ["-y", "opencode-skills-doctor", "mcp"] }
  }
}
```

Codex（`~/.codex/config.toml`）：

```toml
[mcp_servers.skills-doctor]
command = "npx"
args = ["-y", "opencode-skills-doctor", "mcp"]
```

其他 MCP 客户端：启动 `npx -y opencode-skills-doctor mcp` 并允许 `skills_doctor` 工具即可。

它扫描 `.opencode/skills`、`.claude/skills`、`.agents/skills`（项目和全局），所以其他 agent 用的 skill 也能一起体检。

### DeepSeek Harness（DSH）

DSH 自带 MCP 客户端 bundle（`@deepseek-ai/dsh-mcp-client`）。在 profile 的 patch 里加一条，例如 `~/.dsh/profiles/<profile>/cordis.patch.yml`：

```yaml
- id: mcp-skills-doctor
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: skills_doctor
    transport: stdio
    command: npx
    args: ["-y", "opencode-skills-doctor", "mcp"]
```

重启 DSH。工具会以 `mcp__skills_doctor__skills_doctor` 出现。

Windows 上如果 stdio 起不来 `npx`，改成 `command: cmd`、`args: ["/c", "npx", "-y", "opencode-skills-doctor", "mcp"]`。

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
7. `opencode.json(c)` 的 `skills` 数组（2.x）或 `skills.paths`（1.x）；相对路径按当前工作目录解析，支持 `~/`、绝对路径、HTTP catalog

## JSON 输出

`check --json` / `scan --json` / `update --json` 都会输出结构化 JSON，方便接 CI 或做网页报告。字段包括 `summary`、`findings[]`、`skills[]`（含 `managed: { version, url, root }`）。

## 安全

这个工具会读写 skill 文件。对真实环境使用前：

- `update` 下载的 catalog 内容**没有签名校验**——把 catalog 当代码对待；
- `fix` / `--prune` 会移动或删除文件——先 `--dry-run` 预览；
- 它**不是沙箱**，不限制 agent 能做什么。

完整威胁模型、加固清单和私密漏洞报告方式见 [SECURITY.zh-CN.md](../SECURITY.zh-CN.md)。

## 注意事项与已知限制

**安装 / 插件**

- OpenCode **2.x**：在 `opencode.jsonc` 加 `"plugins": ["opencode-skills-doctor"]` 即可。
- OpenCode **1.x**：需要 `npm i --prefix ~/.config/opencode opencode-skills-doctor`，再加一个一行本地插件文件（`export { SkillsDoctorPlugin } from "opencode-skills-doctor/v1"`）——因为 1.x 解析插件的机制不同，且 `@opencode-ai/plugin` 是可选 peer 依赖。
- 1.x **没有 `/skills-doctor` 命令**，只有 `skills_doctor` 工具。

**安全性 / 行为**

- `fix` 默认**只处理项目内**；要动全局来源加 `--all`。归档文件进入 `.skills-doctor-archive/<时间戳>/`（可逆，是移动不是删除）。
- `fix` 只处理**被遮蔽**的定义，永远不改生效版本，也不会重写描述或正文。
- `fix --hide` 只加 `metadata.opencode/autoinvoke: false`，skill 仍可用 `@id` 加载。
- 遮蔽判定遵循 OpenCode 优先级：注册越后越优先；同序时 `SKILL.md` 目录形式优先。如与实际运行不一致，以实际运行为准。
- 它**不是安全沙箱**：只审计配置和文件，不限制 agent 能做什么。

**度量**

- 默认 `budget`（1200 tokens）是建议值，不是硬限制；用 `.skills-doctor.json` 或 `--budget` 调整。
- token 是启发式估算（CJK 约 1.7 字/token，其余约 4 字符/token），用于横向比较，不是精确计费。
- `check` 不联网；要看 catalog 新版本用 `update --check-only`。
- 配置优先级假设：全局配置 < 项目配置 < `skills` 数组顺序。

## Roadmap

- v0.4：内容层面的建议（哪些 skill 从未被使用）、catalog 签名校验
- 后续：V1/Claude skill 兼容迁移报告

## 开发

```powershell
npm test
```

测试覆盖：frontmatter 解析、来源发现与优先级、遮蔽/重复/预算规则、catalog 下载与 lock、drift 检测与自愈、旧/新 lock 的向上兼容、CLI JSON 与退出码。

MIT
