import { Plugin } from "@opencode/plugin"
import { auditSkills, formatChat } from "./audit.mjs"
import { postChatNotice, chatNoticeVisible } from "./notify.mjs"
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
        description: "Audit installed agent skills and return a short briefing to say to the user in the chat. Does not write a file.",
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
          const audit = auditSkills({ cwd: directory, budget })
          return { content: formatChat(audit) }
        },
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "skills-doctor",
        description: "Tell the user about skill problems in this chat",
        execute: async ({ sessionID }) => {
          await postChatNotice({
            sessionID,
            cwd: ctx.location.directory,
            synthetic: (input) => ctx.session.synthetic(input),
            resume: true,
            force: true,
            when: "always",
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

    // 用户发消息时，把问题直接写进对话。resume 为 false，不额外叫醒模型。
    // 没有 prompt hook 的旧宿主仍靠下面的 context 退路。
    try {
      await ctx.session.hook("prompt", async (event) => {
        await postChatNotice({
          sessionID: event.sessionID,
          cwd: ctx.location.directory,
          synthetic: (input) => ctx.session.synthetic(input),
        })
      })
    } catch {
      // 旧版本不认识这个 hook
    }

    // 通知已经出现在对话里时，不再把同一段话塞进系统提示。
    // 老版本没有 synthetic 时，退回系统提示，让模型在回复里说出来。
    await ctx.session.hook("context", async (event) => {
      if (!chatNoticeVisible(ctx.location.directory, event.sessionID)) {
        const warning = budgetWarning({ cwd: ctx.location.directory, sessionID: event.sessionID })
        if (warning) {
          event.system.push({
            type: "text",
            text: `Say this to the user in the chat. Do not write a file.\n\n${warning}`,
          })
        }
      }
      const note = await updateNote({ directory: ctx.location.directory, sessionID: event.sessionID })
      if (note) event.system.push({ type: "text", text: note })
    })
  },
})
