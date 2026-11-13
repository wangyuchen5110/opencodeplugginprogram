import { tool } from "@opencode-ai/plugin"
import { auditSkills, formatChat } from "./audit.mjs"
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
        "Audit installed agent skills and return a short briefing to say to the user in the chat. Does not write a file.",
      args: z.object({
        directory: z.string().optional().describe("Directory to audit (defaults to the current project)"),
        budget: z.number().optional().describe("Description token budget (default 1200)"),
      }),
      execute: async (args) => {
        const cwd = args.directory || directory || process.cwd()
        const audit = auditSkills({ cwd, budget: typeof args.budget === "number" ? args.budget : null })
        return formatChat(audit)
      },
    }),
  },
  "experimental.chat.system.transform": async (input, output) => {
    const warning = budgetWarning({ cwd: directory, sessionID: input?.sessionID })
    if (warning) output.system.push(`Say this to the user in the chat. Do not write a file.\n\n${warning}`)
    const note = await updateNote({ directory, sessionID: input?.sessionID })
    if (note) output.system.push(note)
  },
})

export const server = SkillsDoctorPlugin
export default { id: "skills-doctor", server: SkillsDoctorPlugin }
