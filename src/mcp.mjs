import { auditSkills, formatMarkdown } from "./audit.mjs"
import { normalizeLang, detectLang } from "./i18n.mjs"

export const PROTOCOL_VERSION = "2025-06-18"
export const SERVER_NAME = "skills-doctor"
export const TOOL_NAME = "skills_doctor"

export function toolDefinition() {
  return {
    name: TOOL_NAME,
    description:
      "Audit local agent skills (OpenCode / Claude Code / .agents): duplicate and shadowed definitions, per-step description token budget, oversized bodies and fix hints. Returns a markdown report.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to audit (default: the server process working directory)",
        },
        budget: {
          type: "number",
          description: "Description token budget per model step (default 1200)",
        },
        lang: {
          type: "string",
          enum: ["en", "zh"],
          description: "Report language (default: auto from system locale)",
        },
        global: {
          type: "boolean",
          description: "Include global skill directories such as ~/.config/opencode and ~/.claude (default true)",
        },
      },
      additionalProperties: false,
    },
  }
}

function ok(id, result) {
  return { jsonrpc: "2.0", id, result }
}

function fail(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

/** 处理一条 JSON-RPC 消息；通知返回 null。 */
export async function handleMessage(message, { version = "0.0.0" } = {}) {
  if (!message || typeof message !== "object" || typeof message.method !== "string") return null
  const { id, method, params } = message
  const isNotification = id === undefined || id === null

  try {
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version },
        })

      case "notifications/initialized":
      case "notifications/cancelled":
        return null

      case "ping":
        return ok(id, {})

      case "tools/list":
        return ok(id, { tools: [toolDefinition()] })

      case "resources/list":
        return ok(id, { resources: [] })

      case "prompts/list":
        return ok(id, { prompts: [] })

      case "tools/call": {
        const name = params?.name
        if (name !== TOOL_NAME) return fail(id, -32602, `unknown tool: ${name}`)

        const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {}
        const directory =
          typeof args.directory === "string" && args.directory.trim() ? args.directory.trim() : process.cwd()
        const budget = typeof args.budget === "number" && args.budget > 0 ? args.budget : null
        const lang = normalizeLang(args.lang) ?? detectLang()

        const audit = auditSkills({ cwd: directory, budget, lang, includeGlobal: args.global !== false })
        return ok(id, { content: [{ type: "text", text: formatMarkdown(audit) }] })
      }

      default:
        if (isNotification) return null
        return fail(id, -32601, `method not found: ${method}`)
    }
  } catch (err) {
    if (isNotification) return null
    return fail(id, -32603, String(err?.message ?? err))
  }
}

/** stdio transport：newline-delimited JSON-RPC（MCP 标准）。 */
export function startMcpServer({ version, input = process.stdin, output = process.stdout, onExit = () => process.exit(0) } = {}) {
  let buffer = ""
  let queue = Promise.resolve()

  const write = (payload) => {
    output.write(JSON.stringify(payload) + "\n")
  }

  const handleLine = (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    queue = queue
      .then(() => handleMessage(message, { version }))
      .then((response) => {
        if (response) write(response)
      })
      .catch((err) => {
        write(fail(message?.id ?? null, -32603, String(err?.message ?? err)))
      })
  }

  input.setEncoding?.("utf8")
  input.on("data", (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) handleLine(line)
    }
  })

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    // 等队列里的异步响应写完再退出，避免管道结束时丢包
    queue.finally(onExit)
  }
  input.on("end", finish)
  input.on("close", finish)

  return { write, close: finish }
}
