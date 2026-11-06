import type { AgentTranscription, AgoraVoiceAI, AgoraVoiceAIEvents, RTCEngine, TranscriptHelperItem, TranscriptHelperMode, UserTranscription } from 'agora-agent-client-toolkit'
import type { RTMClient, RTMConfig } from 'agora-rtm'

// Live captions for the tape recorder in the interrogation room, adapted from the official Next.js
// quickstart (LandingPage.tsx RTM setup, ConversationComponent.tsx toolkit lifecycle).
// Display only: nothing here may reach the server. Fact discovery stays with the
// trusted provider-history sync, so this module deliberately has no API client.

export type TranscriptStatus = 'idle' | 'connecting' | 'live' | 'unavailable'
/** `final` is true once the provider has closed the turn; a detective line is only read for the notebook then. */
export interface TranscriptLine { id: string; speaker: 'detective' | 'suspect'; text: string; final: boolean }
type ToolkitItem = TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>

export interface TranscriptSdks {
  RTM: new (appId: string, userId: string, config?: RTMConfig) => RTMClient
  AgoraVoiceAI: Pick<typeof AgoraVoiceAI, 'init'>
  AgoraVoiceAIEvents: typeof AgoraVoiceAIEvents
  TranscriptHelperMode: typeof TranscriptHelperMode
}
export interface LiveTranscriptOptions {
  rtcClient: RTCEngine; appId: string; channel: string; rtmUid: string; rtmToken: string
  onLines: (lines: TranscriptLine[]) => void
  onStatus: (status: TranscriptStatus) => void
}
export interface LiveTranscript { renewToken: (token: string) => Promise<void>; release: () => Promise<void> }

// A hung RTM logout must never hold up an RTC retry.
const LOGOUT_WAIT_MS = 1000
// The toolkit reports all local speech under this sentinel uid.
const LOCAL_SPEAKER_UID = '0'

// Both SDKs touch browser globals, so they load only inside the client effect path.
async function loadSdks(): Promise<TranscriptSdks> {
  const [{ default: AgoraRTM }, toolkit] = await Promise.all([import('agora-rtm'), import('agora-agent-client-toolkit')])
  return { RTM: AgoraRTM.RTM, AgoraVoiceAI: toolkit.AgoraVoiceAI, AgoraVoiceAIEvents: toolkit.AgoraVoiceAIEvents, TranscriptHelperMode: toolkit.TranscriptHelperMode }
}

/** Fixes compacted punctuation from some speech providers, as the quickstart does. */
export function normalizeTranscriptSpacing(text: string): string {
  return text.replace(/([.!?])([A-Za-z])/g, '$1 $2').replace(/,([A-Za-z])/g, ', $1').replace(/\s{2,}/g, ' ').trim()
}

// TurnStatus.IN_PROGRESS in the toolkit; the enum is not imported so this file stays free of SDK code.
const TURN_IN_PROGRESS = 0

/**
 * Whether the provider has closed this turn. In text mode the toolkit stamps every item as
 * ended, so a player's turn is read from the transcription's own `final` flag when present.
 */
function isFinal(item: ToolkitItem): boolean {
  const metadata = item.metadata
  if (metadata && 'final' in metadata && typeof metadata.final === 'boolean') return metadata.final
  if (metadata && 'turn_status' in metadata && typeof metadata.turn_status === 'number') return metadata.turn_status !== TURN_IN_PROGRESS
  return item.status !== TURN_IN_PROGRESS
}

/**
 * Maps the toolkit's full history to display lines. The agent's RTM publisher ID is
 * not guaranteed to equal its RTC uid, so only the local sentinel is matched.
 */
export function toTranscriptLines(items: readonly ToolkitItem[]): TranscriptLine[] {
  return items.flatMap(item => {
    const text = normalizeTranscriptSpacing(typeof item.text === 'string' ? item.text : '')
    if (!text) return []
    return [{ id: `${item.uid}-${item.turn_id}-${item.stream_id}`, speaker: item.uid === LOCAL_SPEAKER_UID ? 'detective' as const : 'suspect' as const, text, final: isFinal(item) }]
  })
}

/**
 * Starts captions in the background and returns immediately. Every failure ends in
 * `unavailable`; nothing here throws, rejects, or blocks the RTC join or media gate.
 * `release` must run before the RTC client's listeners are removed.
 */
export function connectLiveTranscript(options: LiveTranscriptOptions, load: () => Promise<TranscriptSdks> = loadSdks): LiveTranscript {
  const { rtcClient, appId, channel, rtmUid, rtmToken, onLines, onStatus } = options
  let closed = false, subscribed = false, loggedIn = false
  let rtm: RTMClient | null = null
  let ai: AgoraVoiceAI | null = null

  const onLinkState = ({ currentState }: { currentState: string }) => {
    if (closed || !subscribed) return
    if (currentState === 'CONNECTED') onStatus('live')
    // FAILED includes SAME_UID_LOGIN; re-logging in would only start a mutual kick.
    if (currentState === 'FAILED' || currentState === 'SUSPENDED') onStatus('unavailable')
  }
  const teardown = async () => {
    subscribed = false
    // destroy() always targets the toolkit singleton, so each instance is released once.
    const toolkit = ai; ai = null
    try { toolkit?.unsubscribe(); toolkit?.destroy() } catch { /* Captions are best effort. */ }
    // A login still in flight finishes in run(), which then calls this again to log out.
    const client = rtm
    if (!client || !loggedIn) return
    rtm = null; loggedIn = false
    try { client.removeEventListener('linkState', onLinkState); await client.logout() } catch { /* Same. */ }
  }
  const run = async () => {
    onStatus('connecting')
    try {
      const sdks = await load()
      if (closed) return
      rtm = new sdks.RTM(appId, rtmUid, { logLevel: 'warn' })
      rtm.addEventListener('linkState', onLinkState)
      await rtm.login({ token: rtmToken })
      loggedIn = true
      if (closed) return void await teardown()
      const instance = await sdks.AgoraVoiceAI.init({ rtcEngine: rtcClient, rtmEngine: rtm, renderMode: sdks.TranscriptHelperMode.TEXT, enableLog: false })
      ai = instance
      if (closed) return void await teardown()
      instance.on(sdks.AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, items => { if (!closed) onLines(toTranscriptLines(items)) })
      // subscribeMessage only binds listeners, so it can precede the RTC join. Binding
      // before the RTM subscribe means the agent's first message is not dropped.
      instance.subscribeMessage(channel)
      await rtm.subscribe(channel)
      if (closed) return void await teardown()
      subscribed = true
      onStatus('live')
    } catch {
      await teardown()
      if (!closed) onStatus('unavailable')
    }
  }
  void run()

  return {
    async renewToken(token) {
      if (!rtm || !loggedIn) return
      try { await rtm.renewToken(token) } catch { /* A lapsed caption token never affects voice. */ }
    },
    async release() {
      if (closed) return
      closed = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const waited = new Promise<void>(resolve => { timer = setTimeout(resolve, LOGOUT_WAIT_MS) })
      await Promise.race([teardown(), waited])
      clearTimeout(timer)
    },
  }
}
