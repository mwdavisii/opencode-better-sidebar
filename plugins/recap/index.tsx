/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from "solid-js"
import type { SessionMessageAssistant, SessionMessageAssistantText, SessionMessageInfo } from "@opencode/client"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { SyntaxStyle, TextAttributes } from "@opentui/core"

const PROMPTS_UNTIL_STALE = 3
const RECENT_MESSAGES = 10

// Module-level signals so the View component reacts to changes
const recapSignals = new Map<string, ReturnType<typeof createSignal<string | null>>>()
const loadingSignals = new Map<string, ReturnType<typeof createSignal<boolean>>>()
// Counts user prompts sent after the last recap was generated
const promptCounters = new Map<string, number>()

type RecapOptions = {
  providerID?: string
  modelID?: string
}

type ModelChoice = {
  providerID: string
  modelID: string
}

function readConfiguredModel(options: RecapOptions | undefined): ModelChoice | undefined {
  const providerID = options?.providerID?.trim()
  const modelID = options?.modelID?.trim()

  const hasProvider = Boolean(providerID)
  const hasModel = Boolean(modelID)

  if (hasProvider !== hasModel) {
    throw new Error("Invalid recap plugin config: set both providerID and modelID, or neither")
  }

  if (!hasProvider || !hasModel) return

  return {
    providerID: providerID!,
    modelID: modelID!,
  }
}

function isAssistantMessage(m: SessionMessageInfo): m is SessionMessageAssistant {
  return m.type === "assistant"
}

function inferSessionModel(messages: SessionMessageInfo[]): ModelChoice | undefined {
  const lastAssistant = [...messages].reverse().find(isAssistantMessage)
  if (!lastAssistant) return

  const providerID = lastAssistant.model.providerID.trim()
  const modelID = lastAssistant.model.id.trim()
  if (!providerID || !modelID) return

  return { providerID, modelID }
}

function getRecapSignal(sessionID: string) {
  if (!recapSignals.has(sessionID)) recapSignals.set(sessionID, createSignal<string | null>(null))
  return recapSignals.get(sessionID)!
}

function getLoadingSignal(sessionID: string) {
  if (!loadingSignals.has(sessionID)) loadingSignals.set(sessionID, createSignal<boolean>(false))
  return loadingSignals.get(sessionID)!
}

function View(props: { sessionID: string; onRecap: () => void }) {
  const ctx = usePlugin()
  const recap = () => getRecapSignal(props.sessionID)[0]()
  const loading = () => getLoadingSignal(props.sessionID)[0]()
  const syntaxStyle = () =>
    SyntaxStyle.fromStyles({
      comment: { fg: ctx.theme.syntax.comment },
      keyword: { fg: ctx.theme.syntax.keyword },
      function: { fg: ctx.theme.syntax.function },
      variable: { fg: ctx.theme.syntax.variable },
      string: { fg: ctx.theme.syntax.string },
      number: { fg: ctx.theme.syntax.number },
      type: { fg: ctx.theme.syntax.type },
      operator: { fg: ctx.theme.syntax.operator },
      punctuation: { fg: ctx.theme.syntax.punctuation },
    })

  return (
    <box>
      <text
        fg={ctx.theme.text.base}
        attributes={TextAttributes.BOLD}
        onMouseDown={() => { if (!loading()) props.onRecap() }}
      >
        {loading() ? "Generating..." : "Recap"}
      </text>
      <Show when={recap() !== null && !loading()}>
        <markdown
          content={recap()!}
          syntaxStyle={syntaxStyle()}
          fg={ctx.theme.text.muted}
        />
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "mwdavisii.recap",
  async setup(ctx) {
    const recapOptions = ctx.options as RecapOptions | undefined
    let configuredRecapModel: ModelChoice | undefined
    let optionsError: string | undefined

    try {
      configuredRecapModel = readConfiguredModel(recapOptions)
    } catch (err: any) {
      optionsError = err?.message ?? String(err)
    }

    // Track user prompts per session and clear stale recaps
    const statusUnsub = ctx.data.on("session.status", (event) => {
      const sessionID = event.data.sessionID
      if (!sessionID) return
      const [recap] = getRecapSignal(sessionID)
      if (recap() === null) return

      if (event.data.status.type === "busy") {
        const count = (promptCounters.get(sessionID) ?? 0) + 1
        promptCounters.set(sessionID, count)
        if (count >= PROMPTS_UNTIL_STALE) {
          const [, setRecap] = getRecapSignal(sessionID)
          setRecap(null)
          promptCounters.set(sessionID, 0)
        }
      }
    })

    async function generateRecap(sessionID: string) {
      const [, setRecap] = getRecapSignal(sessionID)
      const [, setLoading] = getLoadingSignal(sessionID)
      let recapSessionID: string | undefined
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      setLoading(true)

      const [currentRecap] = getRecapSignal(sessionID)
      const previousRecap = currentRecap()

      try {
        if (optionsError) {
          throw new Error(optionsError)
        }

        // Fetch only the most recent messages
        const messages = await ctx.client.session.context({ sessionID })
        const recentMessages = messages.slice(-RECENT_MESSAGES)

        const transcript = recentMessages
          .map((m) => {
            if (m.type === "user") {
              const text = m.text.trim()
              return text ? `${m.type}: ${text}` : null
            }
            if (m.type === "assistant") {
              const text = m.content
                .filter((c): c is SessionMessageAssistantText => c.type === "text")
                .map((c) => c.text)
                .join(" ")
                .trim()
              return text ? `${m.type}: ${text}` : null
            }
            return null
          })
          .filter((line): line is string => Boolean(line))
          .join("\n\n")

        if (!transcript) {
          setRecap("*Nothing to summarize yet.*")
          return
        }

        const modelToUse = configuredRecapModel ?? inferSessionModel(recentMessages)

        // Create a throwaway session for the LLM call.
        // V2 applies model selection on session.create, not on session.prompt.
        const createInput = modelToUse
          ? { model: { id: modelToUse.modelID, providerID: modelToUse.providerID } }
          : {}
        const newSession = await ctx.client.session.create(createInput)
        recapSessionID = newSession.id
        if (!recapSessionID) throw new Error("Failed to create recap session")

        const prompt = `You are a summarization assistant. Output only Markdown - no tools, no files, no questions.
Do not use Markdown tables.

Summarize this coding session in ~40 words across these sections:

**Working on:** one sentence - what is being built or explored
**Done:** max 2 bullets, <=6 words each (skip if nothing yet)
**Next:** max 1 bullet - the immediate next step (skip if none)

No intro, no outro, no extra sections. Output only the Markdown.
Never use table syntax (no pipes or table separators).
${previousRecap ? `\nPREVIOUS RECAP (context for earlier history):\n${previousRecap}\n` : ""}
RECENT TRANSCRIPT (last ${RECENT_MESSAGES} messages):
${transcript}`

        const timeoutPromise = new Promise<never>((_, reject) =>
          timeoutHandle = setTimeout(() => reject(new Error("Recap timed out")), 30_000)
        )

        await ctx.client.session.prompt({ sessionID: recapSessionID, text: prompt })

        // Wait for the throwaway session to go idle, but cap total wall time.
        await Promise.race([ctx.client.session.wait({ sessionID: recapSessionID }), timeoutPromise])

        // Fetch completed messages to get the assistant's reply
        const recapMessages = await ctx.client.session.context({ sessionID: recapSessionID })

        let lastAssistantMsg: SessionMessageAssistant | undefined
        for (const m of [...recapMessages].reverse()) {
          if (!isAssistantMessage(m)) continue
          // Exclude messages that contain the prompt we sent (echoed back as assistant)
          const text = m.content
            .filter((c): c is SessionMessageAssistantText => c.type === "text")
            .map((c) => c.text)
            .join("")
          if (!text.includes("You are a summarization assistant")) {
            lastAssistantMsg = m
            break
          }
        }

        const recapText = lastAssistantMsg?.content
          ? lastAssistantMsg.content
              .filter((c): c is SessionMessageAssistantText => c.type === "text")
              .map((c) => c.text)
              .join("")
              .trim()
          : ""

        setRecap(recapText || "*No summary generated.*")
        promptCounters.set(sessionID, 0)

      } catch (err: any) {
        setRecap(`*Error: ${err?.message ?? String(err)}*`)
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
        if (recapSessionID) {
          await ctx.client.session.remove({ sessionID: recapSessionID }).catch(() => {})
        }
        setLoading(false)
      }
    }

    // V1 used order: 300 here; V2 has no slot ordering, so sidebar position now follows plugin enable order.
    const slotUnsub = ctx.ui.slot({
      append: "sidebar.content",
      render: (input) => (
        <View
          sessionID={input.sessionID}
          onRecap={() => generateRecap(input.sessionID)}
        />
      ),
    })

    return () => {
      slotUnsub()
      statusUnsub()
    }
  },
})
