import { Plugin } from "@opencode/plugin"
import { auditSkills, formatMarkdown } from "./audit.mjs"
import { budgetWarning } from "./warning.mjs"

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
          },
          additionalProperties: false,
        },
        options: { namespace: "skills", codemode: true },
        execute: async (input) => {
          const directory = (input && typeof input.directory === "string" && input.directory) || ctx.location.directory
          const budget = input && typeof input.budget === "number" ? input.budget : null
          const audit = auditSkills({ cwd: directory, budget, lang: "en" })
          return { content: formatMarkdown(audit) }
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
    })

    // 每个会话最多注入一次预算预警，避免刷屏
    await ctx.session.hook("context", (event) => {
      const warning = budgetWarning({ cwd: ctx.location.directory, sessionID: event.sessionID })
      if (warning) event.system.push({ type: "text", text: warning })
    })
  },
})
