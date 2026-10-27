import { Plugin } from "@opencode/plugin"
import { auditSkills, formatMarkdown } from "./audit.mjs"
import { writeHtmlReport } from "./html.mjs"
import { budgetWarning } from "./warning.mjs"
import { loadConfig } from "./config.mjs"
import { checkForUpdate, resolveMode, toolVersion } from "./self-update.mjs"

const VERSION = toolVersion()
const notifiedSessions = new Set()

async function updateNote({ directory, sessionID }) {
  if (!sessionID || notifiedSessions.has(sessionID)) return null
  notifiedSessions.add(sessionID)
  try {
    const { config } = loadConfig(directory)
    const update = await checkForUpdate({ current: VERSION, mode: resolveMode(config) })
    if (!update) return null
    return `skills-doctor ${update.latest} is available (current ${VERSION}). Update: npx -y opencode-skills-doctor@latest upgrade --apply`
  } catch {
    return null
  }
}

/**
 * OpenCode 插件入口：把 skills-doctor 暴露成 skills_doctor 工具和 /skills-doctor 命令。
 * 通过 opencode.json(c) 加载：
 *   { "plugins": ["opencode-skills-doctor"] }
 * 或本地路径。
 */
export default Plugin.define({
  id: "skills-doctor",

  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "skills", description: "OpenCode skill diagnostics" })
      editor.add({
        name: "doctor",
        description: "Audit local OpenCode skills: duplicates, shadowing, context budget and fix hints",
        input: {
          type: "object",
          properties: {
            directory: { type: "string", description: "Directory to audit (defaults to the current project)" },
            budget: { type: "number", description: "Description token budget (default 1200)" },
            html: {
              type: "string",
              description: "Optional path; when set, a self-contained HTML report is written there",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "skills", codemode: true },
        execute: async (input) => {
          const directory = (input && typeof input.directory === "string" && input.directory) || ctx.location.directory
          const budget = input && typeof input.budget === "number" ? input.budget : null
          const audit = auditSkills({ cwd: directory, budget, lang: "en" })
          let markdown = formatMarkdown(audit)
          if (input && typeof input.html === "string" && input.html.trim()) {
            const file = writeHtmlReport(audit, input.html.trim(), { title: "skills-doctor report" })
            markdown += `\n\nHTML report written to \`${file}\``
          }
          return { content: markdown }
        },
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "skills-doctor",
        description: "Audit local OpenCode skills",
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: "Run a skills audit with the skills_doctor tool, then summarize the top issues and propose concrete fixes.",
            delivery,
          })
        },
      })
      editor.add({
        name: "skills-report",
        description: "Write a self-contained HTML skills report to a path you choose",
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: "Ask me where to save the HTML report (a file path, default ./skills-report.html), then call the skills_doctor tool with the html argument set to that path and tell me where it was written.",
            delivery,
          })
        },
      })
      editor.add({
        name: "skills-upgrade",
        description: "Check whether skills-doctor itself has a newer version",
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: "Run `npx -y opencode-skills-doctor upgrade` in the terminal (add --apply only after I confirm), then report whether a newer version exists.",
            delivery,
          })
        },
      })
    })

    // 每个会话最多注入一次预算预警，避免刷屏
    await ctx.session.hook("context", async (event) => {
      const warning = budgetWarning({ cwd: ctx.location.directory, sessionID: event.sessionID })
      if (warning) event.system.push({ type: "text", text: warning })
      const note = await updateNote({ directory: ctx.location.directory, sessionID: event.sessionID })
      if (note) event.system.push({ type: "text", text: note })
    })
  },
})
