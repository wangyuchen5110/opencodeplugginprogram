# 安全策略

## 支持的版本

| 版本 | 支持 |
|---|---|
| 0.3.x | ✅ |
| < 0.3 | ❌ |

1.0 之前，只维护最新的次版本。

## 报告漏洞

**请不要开公开 issue**，使用 GitHub 的私密漏洞报告：

<https://github.com/wangyuchen5110/opencodeplugginprogram/security/advisories/new>

请附上版本、复现步骤、影响，以及你建议的修复。我们会尽力在 7 天内响应。

## 这个工具会对你的系统做什么

- 以调用者的权限**在本机**运行，无遥测。
- 只有 `update`（HTTP catalog）和通过 `npx` 安装/运行时才会联网。
- 读取 skill 文件与 frontmatter、`opencode.json(c)` / `opencode.jsonc`、`.skills-doctor.lock.json`；**不读取**模型凭据、API key 或对话内容。
- 只在明确命令下写入：
  - `fix` —— 把被遮蔽的定义移入 `.skills-doctor-archive/`，`--hide` 会改 `metadata.opencode/autoinvoke`；
  - `update` —— 下载文件写入 skill 目录并更新 lock；
  - 其余（`check`、`scan`、`mcp`）都是只读。

## 风险点与缓解措施

### `update` 会下载不受信内容

- **没有签名校验**，catalog 的 `version` 字段被直接信任。
- 下载限制为与 `index.json` 同源；拒绝路径穿越（`..`、绝对路径、协议前缀）；文件只会写在目标 skill 目录内。
- 下载的 skill 本质是**给 agent 的指令**。把 catalog 当代码对待：只用你控制的 catalog、固定版本、审查 diff、先跑 `update --check-only`。
- 更新器不会执行 catalog 里的任何代码，只做抓取和写文件。

### `fix` 与 `--prune` 会改文件

- `fix` 只归档**被遮蔽**（永远不会加载）的定义，不会移动生效版本。归档到 `.skills-doctor-archive/<时间戳>/`，移回去即可恢复。
- `fix` 默认**只处理项目内**；`--all` 才会扩展到全局来源（`~/.config/opencode/skills`、`~/.claude/skills` 等）。
- `update --prune` 会**删除**已从 catalog 下架的 skill 目录；不加 `--prune` 只提示不删。
- 一律先用 `--dry-run` 确认会改哪些路径。

### MCP server 与插件

- `skills-doctor mcp` 只执行本地审计，不代理、不执行、不存储 MCP 内容。
- OpenCode 插件运行在 OpenCode 进程内，使用你的权限；只注册一个工具和一个命令，不会拦截无关的工具调用。
- MCP 客户端/插件可能通过 `npx` 启动，会从 npm 下载已发布的包。需要可复现时固定版本（`opencode-skills-doctor@0.3.9`）。

### 它不是沙箱

这个工具只审计配置和文件，**不限制 agent 能做什么**。隔离请使用 agent 运行时的权限/沙箱能力（OpenCode permissions、操作系统沙箱、容器等）。

## 加固清单

- 让 `fix` / `--prune` 改任何东西之前，先跑 `check` 和 `fix --dry-run`。
- CI 里用 `--no-global`，除非你确实想审计整机 skill。
- 自动化里固定版本：`npx -y opencode-skills-doctor@0.3.9 check --strict`。
- 定期审查并清理 `.skills-doctor-archive/`。
- 把每个 catalog 和每个下载的 `SKILL.md` 都当成你要安装的代码。

## 不在范围内

- OpenCode、Claude Code、Codex、Kimi Code、DeepSeek Harness 等宿主运行时自身的漏洞。
- 第三方 skill / catalog 里的恶意内容（这是使用方的信任决策，见上）。
- 读取这些 skill 的模型本身的行为。
