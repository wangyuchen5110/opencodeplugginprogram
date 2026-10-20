import { tool } from "@opencode-ai/plugin"
import { auditSkills, formatMarkdown } from "./audit.mjs"
import { budgetWarning } from "./warning.mjs"

const z = tool.schema

/**
 * OpenCode 1.x 插件入口（V1 API：`server` 函数 + tool()）。
 * 在 1.x 里通过 opencode.json 配置：
 *   { "plugin": ["opencode-skills-doctor/v1"] }
 * 2.x 请使用包根导出（V2 的 Plugin.define）。
 */
export const SkillsDoctorPlugin = async ({ directory }) => ({
  tool: {
    skills_doctor: tool({
      description:
        "Audit local OpenCode skills: duplicates, shadowing, context budget and fix hints. Returns a markdown report.",
      args: z.object({
        directory: z.string().optional().describe("Directory to audit (defaults to the current project)"),
        budget: z.number().optional().describe("Description token budget (default 1200)"),
      }),
      execute: async (args) => {
        const cwd = args.directory || directory || process.cwd()
        const audit = auditSkills({ cwd, budget: typeof args.budget === "number" ? args.budget : null, lang: "en" })
        return formatMarkdown(audit)
      },
    }),
  },
  "experimental.chat.system.transform": async (input, output) => {
    const warning = budgetWarning({ cwd: directory, sessionID: input?.sessionID })
    if (warning) output.system.push(warning)
  },
})

export const server = SkillsDoctorPlugin
export default { id: "skills-doctor", server: SkillsDoctorPlugin }
