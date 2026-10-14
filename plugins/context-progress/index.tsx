/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import type { SessionMessageInfo } from "@opencode/client"

const BAR_WIDTH = 24

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)))
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function messageTokenCount(message: Extract<SessionMessageInfo, { type: "assistant" }>): number {
  const input = safeNumber(message.tokens?.input)
  const output = safeNumber(message.tokens?.output)
  const reasoning = safeNumber(message.tokens?.reasoning)
  const cacheRead = safeNumber(message.tokens?.cache?.read)
  const cacheWrite = safeNumber(message.tokens?.cache?.write)
  return input + output + reasoning + cacheRead + cacheWrite
}

function buildBar(percent: number): { bar: string; clamped: number } {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((clamped / 100) * BAR_WIDTH)))
  return {
    bar: `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`,
    clamped,
  }
}

function isAssistantWithOutput(
  message: SessionMessageInfo,
): message is Extract<SessionMessageInfo, { type: "assistant" }> {
  return message.type === "assistant" && safeNumber(message.tokens?.output) > 0
}

function View(props: { sessionID: string }) {
  const ctx = usePlugin()

  const messages = createMemo(() => ctx.data.session.message.list(props.sessionID) ?? [])

  const sessionCost = createMemo(() => {
    const reactive = ctx.data.session.cost(props.sessionID)
    if (reactive > 0) return reactive

    return messages().reduce((sum, message) => {
      if (message.type !== "assistant") return sum
      return sum + safeNumber(message.cost)
    }, 0)
  })

  const location = () => ctx.location ?? ctx.data.location.default()
  const models = createMemo(() => ctx.data.location.model.list(location()) ?? [])

  const usage = createMemo(() => {
    const lastAssistant = messages().findLast(isAssistantWithOutput)
    if (!lastAssistant) {
      return {
        tokens: 0,
        contextWindow: 0,
        percent: 0,
      }
    }

    const tokens = messageTokenCount(lastAssistant)
    const model = models().find(
      (m) => m.providerID === lastAssistant.model.providerID && m.modelID === lastAssistant.model.id,
    )
    const contextWindow = safeNumber(model?.limit?.context)
    const percent = contextWindow > 0 ? Math.round((tokens / contextWindow) * 100) : 0

    return {
      tokens,
      contextWindow,
      percent,
    }
  })

  const detailLine = createMemo(() => {
    const state = usage()
    const limitText = state.contextWindow > 0 ? formatInt(state.contextWindow) : "--"
    return `${formatInt(state.tokens)} / ${limitText} / ${formatMoney(sessionCost())}`
  })

  const theme = () => ctx.theme

  const progress = createMemo(() => {
    const percent = usage().percent
    const bar = buildBar(percent)
    const color =
      percent >= 90
        ? theme().text.feedback.error.base
        : percent >= 70
          ? theme().text.feedback.warning.base
          : theme().hue.accent[200]
    return {
      bar: bar.bar,
      color,
      percent: bar.clamped,
    }
  })

  return (
    <box>
      <text fg={theme().text.base} attributes={TextAttributes.BOLD}>
        Context
      </text>
      <box flexDirection="row" gap={1}>
        <text fg={progress().color}>{progress().bar}</text>
        <text fg={progress().color}> {progress().percent}%</text>
      </box>
      <text fg={theme().text.muted}>{detailLine()}</text>
    </box>
  )
}

export default Plugin.define({
  id: "mwdavisii.context-progress",
  async setup(ctx) {
    // V1 used `order: 100` here; V2 has no ordering field, so the sidebar
    // position is now determined by plugin enable order.
    ctx.ui.slot({
      append: "sidebar.content",
      render: (input) => <View sessionID={input.sessionID} />,
    })
  },
})
