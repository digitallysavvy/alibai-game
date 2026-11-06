# Agora + Anam setup

The selected Agora project is **testing**. `scripts/agora-setup.mjs` checks the CLI, writes the project's credentials into `.env.local` using the CLI's Next.js mapping, and checks ConvoAI readiness. It does not create a cloud project. The example files contain placeholders only; keep `.env.local` private.

```sh
node scripts/agora-setup.mjs
```

When `.env.local` already contains blank placeholder Agora keys, use the CLI's interactive update flow instead of `--append` if it reports existing keys. Do not use `--overwrite` on a populated environment file: that replaces unrelated settings. The exact underlying binding command is:

```sh
agora project env write .env.local --project testing --template nextjs --json
```

The CLI was available at version 0.2.10 during implementation. The command above was attempted but failed because the execution environment could not resolve `sso2.agora.io`. `agora doctor --json` also reported the CLI config directory was not writable. No credential export or remote project readiness has been confirmed. Running the script from a normal authenticated terminal with network access is still required.

## Environment

Fill [`env.example`](../env.example) with your Supabase publishable/secret keys, Agora App ID/certificate, and the Anam API key. `NEXT_PUBLIC_AGORA_APP_ID` and the Supabase publishable key are public; the certificate, Supabase secret key, and Anam key are server-only. Legacy Supabase key names remain optional fallbacks.

The voice pipeline now uses the user's selected **Agora-managed ARES ASR → gpt-4o-mini → MiniMax `speech_2_6_turbo`**, with Anam video. No external ASR, LLM, or TTS API key is required for that pipeline. Each session stores a MiniMax voice ID alongside its avatar ID; no global voice override is used. Gradium/custom endpoint placeholders are commented as future options and are not read by the adapter. The offline scenario-generation model remains a separate optional service.

ARES language is set by `turnDetection.language: 'en-US'`. The stable SDK exposes MiniMax's managed preset but not its audio setting constructor field, so a small subclass preserves that preset and adds the documented `audio_setting.sample_rate: 24000`; Anam is configured with the same rate. Both rate fields come from the official provider schemas. Verify audio/video compatibility in the first real call.

## Source map

The application remains the existing Next.js UI. The server adapter was mapped from these inspected official quickstart sources:

| Official source | Local adaptation |
| --- | --- |
| [invite-agent/route.ts](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs/blob/main/app/api/invite-agent/route.ts) | `lib/agora/server-agent.ts`: `AgoraClient`, `Agent`, VAD, restricted remote UID, and start lifecycle; immutable case context replaces the sample persona. |
| [stop-conversation/route.ts](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs/blob/main/app/api/stop-conversation/route.ts) | `stopSuspectAgent`: stateless stop using the persisted agent ID. |
| [generate-agora-token/route.ts](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs/blob/main/app/api/generate-agora-token/route.ts) | `createPlayerRtcCredentials`: fixed per-session channel and identities, short-lived tokens. Separate RTC/RTM tokens avoid a browser ConvoAI control token. |
| [Anam provider guide](https://docs.agora.io/en/ai/models/avatar/anam) and [SDK avatar guide](https://github.com/AgoraIO/agora-agents-ts/blob/main/docs/guides/avatars.md) | `AnamAvatar` with `avatarId`; the SDK option is `avatarId`, although the provider page's SDK snippet uses `personaId`. The inspected SDK implementation serializes `avatar_id`. |
| [ARES guide](https://docs.agora.io/en/ai/models/asr/ares) and [MiniMax guide](https://docs.agora.io/en/ai/models/tts/minimax) | Managed `AresSTT` and `MiniMaxTTS`; language and matching 24 kHz TTS/avatar configuration. |

An existing official checkout was also inspected at `/Users/hermes/Agora/Github/quickstarts-workspace/agent-quickstart-nextjs` (commit `c4b5db4997175e3c867f3b89744776c64b9c7c6b`). That checkout uses a v3 preview SDK; this integration intentionally follows the inspected stable v2 `createSession`/`stopAgent` source and does not mix preview lifecycle calls into it. Provider constructor and token contracts were cross-checked against the local official SDK source under `SDK_workspace/agora-agents-ts`.

## Per-session Anam actors

The approved stock actor roster is defined in `lib/game/avatar-catalog.ts`. Assignment persists an actor ID on the session, and every agent start/retry uses that same ID. `startSuspectAgent` validates it as a UUID and checks catalog membership before contacting Agora. The adapter no longer reads `ANAM_AVATAR_ID` from the environment.

Actor appearance is independent of the immutable scenario's guilty/innocent answer. The avatar supplies a face; the assigned scenario supplies the suspect's name, role, speech instructions, and case facts. A catalog actor does not encode guilt. The adapter returns connection identifiers only, without private persona instructions or truth fields.

The separately authored stock persona prompts are not sent to Anam or used to generate actors in this flow. The existing stock actor IDs are passed to Anam through Agora. Catalog membership is an application allowlist, not proof that the configured Anam API key can access each actor; actual provider access and rendering remain untested until a real session succeeds.

## MiniMax voice casting

The complete mapping and review status live in `lib/game/avatar-voices.ts`. Exact voice IDs were checked against the [MiniMax system voice catalog](https://platform.minimax.io/docs/faq/system-voice-id) on November 4, 2026. [Agora's MiniMax integration](https://docs.agora.io/en/ai/models/tts/minimax) supports supplying `voice_setting.voice_id` in managed mode; no MiniMax provider key is added. Catalog existence does not prove a particular voice is enabled on the `testing` project's managed account.

| Actor | MiniMax voice ID | Casting basis |
| --- | --- | --- |
| David | `English_Steadymentor` | Coaching role, provisional |
| Mei | `English_Graceful_Lady` | Conversational role, provisional |
| Kevin | `English_PatientMan` | Tutor role, provisional |
| Arthur | `English_WiseScholar` | Professor role, provisional |
| Eleanor | `English_Wiselady` | Patient role, provisional |
| Mateo | `English_FriendlyPerson` | Barista role, provisional |
| Gavin | `English_Diligent_Man` | Foreman role, provisional |
| Hunter | `English_Debator` | Consultative role, provisional |
| Harold | `English_Deep-VoicedGentleman` | Coach role, provisional |
| Lio | `English_DecentYoungMan` | Authored adult male prompt |
| Nessa | `English_ConfidentWoman` | Authored adult female prompt |
| Mara | `English_CalmWoman` | Authored adult female prompt |
| Vesper | `English_SereneWoman` | Guide role, provisional |
| Bren | `English_MaturePartner` | Authored adult male prompt |

These are casting choices, not verified perceptual matches. No voice samples were listened to, and the actual rendered portraits were not available for inspection. The four authored prompts provide intended character presentation, not proof of the generated result. Every entry remains `auditionStatus: pending` and `managedAvailability: unverified`. Stock actor labels alone do not establish age, appearance, or gender; confirm those pairings visually and aurally. Voices remain English to match the game language, regardless of stock persona labels.

Use one neutral line for every audition, such as “I was working that evening. What would you like to know?” Check the actual face and voice together, understandable pacing, lip-sync, and managed-service acceptance. Update casting only after that review. Assignment snapshots the selected voice and avatar together; changing the catalog affects future sessions, not a running session. Neither actor nor voice changes scenario truth.

## Server integration boundary

`startSuspectAgent({ sessionId, instructions, avatarId, voiceId })` is a server-only adapter. Its caller must:

1. Authenticate the player and verify session ownership and briefing state.
2. Reserve agent startup transactionally so retries cannot spawn extra agents.
3. Build `instructions` with `buildSuspectAgentContext()` from the immutable assigned scenario; read `avatarId` and `minimax_voice_id` from the persisted session row and validate them against the approved catalogs. Never accept a prompt, avatar ID, voice ID, channel, agent ID, or UID from browser input.
4. Start the adapter and persist its returned `agentId`. Clean up or reconcile a start whose persistence fails.
5. Return only `createPlayerRtcCredentials(sessionId)` and safe session metadata, after the agent ID is committed.
6. Wait for verified media readiness before starting the three-minute game clock. An accepted start call is not proof the player has heard audio.
7. Call `stopSuspectAgent()` using the persisted agent ID at the deadline/end; retain retryable cleanup state if the provider fails.

The browser joins RTC with numeric `uid`, subscribes to the agent's audio and avatar's video, and logs into RTM using `rtmUid`, a per-session string derived from the session ID because RTM allows one login per user ID across the project (the agent needs only the RTC `uid` in `remote_rtc_uids`). RTC uses `rtcToken`; RTM uses `rtmToken`. The app certificate, avatar token, private case prompt, and provider keys never belong in the browser response.

The managed model receives only the immutable instructions for this session. A future trusted transcript ingestion adapter must authenticate provider events, match the stored agent ID/session, and pass only actually delivered suspect speech to `recordFactRevealed()`. Browser captions, question clicks, and user-supplied fact IDs are not evidence. The server validates disclosures against the contract; an agent's statement cannot award arbitrary points. That transcript ingestion bridge is a separate integration boundary, not an unauthenticated browser endpoint.

## Connect flow

`connect` follows the quickstart order: claim, await Agora's start, commit the agent ID, respond with credentials. Only then does the browser join and publish, so the agent always exists before the player joins.

- **One call for the database work:** `session_connect` checks the owner, reads the session and claims the run. `session_ready` starts the clock and returns the view.
- **Failure:** `connect` stops any agent, records `failed`, which abandons the session, and returns the error.
- **Repeat calls:** a running agent gets fresh tokens and any other run answers `AGENT_START_PENDING`. A session past connecting gets its view with `connection: null`.
- **Room view:** the room's first view comes from `read`, so the case shows without waiting on Agora. The room connects once that view shows a session that can connect, and `connect` then refreshes the view.

## Runtime status

Source inspection is complete. Credential binding, official sample startup, agent joining, RTC client connection, Anam video, MiniMax audio, and an end-to-end voice roundtrip are **not verified** in this environment. The adapter does not claim those checks passed. The official baseline startup commands remain `pnpm install` then `pnpm dev` in the official sample, once normal network/filesystem access is available.


## Browser media adapter

`lib/agora/use-suspect-voice.ts` adapts the inspected official quickstart `components/ConversationComponent.tsx` lifecycle and the bundled RTC Web reference into the existing game screen. It uses `agora-rtc-sdk-ng@4.24.3` directly, keeping the existing component tree. `production-session.tsx` hosts the remote avatar stage and controls.

The browser requests microphone access before creating a cloud agent, calls `/connect`, joins once it returns, registers media listeners before joining, publishes one microphone track, and subscribes only to the server-assigned agent/avatar UIDs. It waits for first decoded audio and avatar video frames before calling `/ready`; a server start response alone does not start the clock. The suspect shows as soon as both decode, while the clock still waits for the server's reply. If `/ready` fails, the browser releases its media and offers a retry. It plays at most one remote audio stream, supports mute and autoplay recovery, renews expiring RTC tokens, and leaves/closes tracks at the deadline or on navigation. The trusted cleanup worker remains necessary when browsers disappear.

Startup timings: the server logs one `[timing] connect` or `[timing] ready` line of step durations, where `agora-start` is Agora's start call. The browser logs one `[timing] startup` line and adds `alibai:*` performance marks. These separate the `/connect` response, the player's join and mic publish, per remote `user-joined`, `user-published` and first decoded frame, and the `/ready` request. They carry names and milliseconds only.

No browser RTC/RTM message can mark a fact discovered. `lib/agora/live-transcript.ts` shows live captions on the tape recorder above the Detective's Notebook (`components/game/tape-recorder.tsx`) using `agora-agent-client-toolkit` over RTM, following the official quickstart's RTM login and `AgoraVoiceAI` lifecycle. Captions are display only: they are never sent to the server and take no part in the readiness gate. The one thing the browser reads from them is a finished player turn, which `lib/game/lead-matching.ts` compares with the leads on the notebook page to mark one as asked; that mark stays in the browser and never touches facts or the score. They start beside the RTC join without being awaited, so an RTM or toolkit failure only shows an "unavailable" note. Caption delivery has not been verified in a live session. The authenticated `sync-facts` action now retrieves managed provider history on the server and verifies complete canonical assistant utterances; its history proves generated output rather than per-turn audio delivery. Browser media code has passed TypeScript checking; real microphone, audio and avatar playback have not yet been verified.
# Trusted history synchronization

`syncProviderFacts(playerId, sessionId)` in `lib/server/provider-facts.ts` checks session ownership and the persisted running agent, then fetches history directly from Agora with server credentials. Its browser trigger accepts no captions, transcript, fact IDs, agent IDs or scoring values. Invoke while the interrogation is active (approximately every 3–5 seconds and before ending); return only the safe session projection. Realtime database changes update the notebook after accepted disclosures.

The validator accepts an assistant reply that asserts a known fact's scripted line in its own sentence, ignoring case, punctuation, apostrophes and contractions, with prerequisites satisfied. A reply can reveal more than one fact. It rejects a line used in a denial, question, quote or hypothetical, or retracted in the next sentence, and ignores lines shared by two facts. A suspect who paraphrases instead of using a line still reveals nothing, so live play is the real test of how often that happens.

Every suspect reply is kept in `session_events` under its stable hash, so a missed fact can still be reviewed once the agent stops and Agora's history returns 404. A row with no `session_facts` entry pointing at its `turn_id` matched nothing. Rows earn nothing alone, `created_at` is when a sync first saw the reply rather than when it was spoken, and replies first seen after the 195-second turn window are lost. Keeping a reply is best effort and runs after the scoring writes. To stay free on an idle poll, the stored IDs arrive embedded in the existing `agent_runs` read.

Important limitation: Agora managed-LLM history is stored model memory, not proof that the player heard the audio. It provides no per-message timestamps or stable turn IDs; the separate turns endpoint does not provide matching text. This MVP records source `agora-provider-history` and server ingestion time, never claims verified playback, and cannot retroactively award disclosures after the 180-second window. Its history window is 30 messages. A production delivery-level audit needs trusted provider delivery events correlated to transcript turns; browser captions cannot supply that guarantee. See [Agora session history documentation](https://docs.agora.io/en/ai/build/handle-runtime-events/retrieve-session-history).
