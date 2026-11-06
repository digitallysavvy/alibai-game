import 'server-only';
import { z } from 'zod';
import { getAvatar } from '../game/avatar-catalog';
import { validateSessionVoice } from '../game/avatar-voices';
import { AgoraClient, Agent, Area, OpenAI, AresSTT, ExpiresIn, MiniMaxTTS, AnamAvatar, generateConvoAIToken } from 'agora-agents';
import { RtcTokenBuilder, RtcRole, RtmTokenBuilder } from 'agora-token';

// Adapted from the official Next.js quickstart invite-agent, stop-conversation,
// and generate-agora-token routes. Source map and runtime limits: docs/agora.md.
const sessionIdSchema = z.uuid();
const AGENT_UID = '123456';
const CLIENT_UID = 1001;
const AVATAR_UID = 1002;
const TOKEN_SECONDS = 300;
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function config() {
  return {
    appId: z.string().regex(/^[a-f\d]{32}$/i).parse(requireEnv('NEXT_PUBLIC_AGORA_APP_ID')),
    appCertificate: z.string().regex(/^[a-f\d]{32}$/i).parse(requireEnv('NEXT_AGORA_APP_CERTIFICATE')),
  };
}
// The stable SDK does not expose MiniMax audio_setting as a constructor option.
// Preserve its managed preset selection and add the documented wire sample rate.
class AvatarMiniMaxTTS extends MiniMaxTTS {
  override toConfig() {
    const value = super.toConfig();
    if (value.vendor !== 'minimax') throw new Error('Unexpected managed TTS vendor');
    return { ...value, params: { ...value.params, audio_setting: { sample_rate: 24000 } } };
  }
}
function client() { return new AgoraClient({ ...config(), area: Area.US }); }
export function channelForSession(sessionId: string): string {
  return `case-${sessionIdSchema.parse(sessionId)}`;
}

// RTM allows one login per user ID across the whole Agora project, unlike RTC UIDs, which
// are scoped to a channel. Deriving it from the session keeps concurrent players from
// kicking each other, and keeps it stable so a renewed token matches the live client.
function rtmUidForSession(sessionId: string): string {
  return `player-${sessionIdSchema.parse(sessionId)}`;
}

/** Server-only. The caller must authenticate session ownership before returning this DTO. */
export function createPlayerRtcCredentials(sessionId: string) {
  const { appId, appCertificate } = config();
  const channel = channelForSession(sessionId);
  const rtmUid = rtmUidForSession(sessionId);
  // Separate RTC and RTM tokens avoid giving the browser a ConvoAI REST auth token.
  const rtcToken = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channel, CLIENT_UID,
    RtcRole.PUBLISHER, TOKEN_SECONDS, TOKEN_SECONDS);
  const rtmToken = RtmTokenBuilder.buildToken(appId, appCertificate, rtmUid, TOKEN_SECONDS);
  return { appId, channel, uid: CLIENT_UID, rtmUid, rtcToken, rtmToken,
    agentUid: Number(AGENT_UID), avatarUid: AVATAR_UID, expiresAt: Date.now() + TOKEN_SECONDS * 1000 };
}

/**
 * Call only after an owner-checked, database-serialized start reservation. Never
 * accept instructions, avatar ID, channel or UID from the browser. Persist the returned
 * agentId before returning connection credentials. A start acknowledgment does
 * not prove media readiness and must not start the three-minute game clock.
 */
export async function startSuspectAgent(input: { sessionId: string; instructions: string; avatarId: string; voiceId: string }) {
  const sessionId = sessionIdSchema.parse(input.sessionId);
  const instructions = z.string().min(100).max(80000).parse(input.instructions);
  // The assignment transaction fixes this approved actor for the whole session.
  const avatarId = z.uuid().parse(input.avatarId);
  getAvatar(avatarId);
  const voiceId = validateSessionVoice(input.voiceId);
  const channel = channelForSession(sessionId);
  const sampleRate = 24000;
  const { appId, appCertificate } = config();
  const avatarToken = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channel, AVATAR_UID,
    RtcRole.PUBLISHER, TOKEN_SECONDS, TOKEN_SECONDS);
  const agent = new Agent({
    client: client(), instructions, greeting: "I'm ready when you are.",
    failureMessage: "Sorry, what was that?", maxHistory: 30,
    turnDetection: { language: 'en-US', config: { speech_threshold: 0.5,
      start_of_speech: { mode: 'vad', vad_config: { interrupt_duration_ms: 160, prefix_padding_ms: 300 } },
      end_of_speech: { mode: 'vad', vad_config: { silence_duration_ms: 480 } } } },
    advancedFeatures: { enable_rtm: true },
    parameters: { data_channel: 'rtm', enable_error_message: true, enable_metrics: true },
  })
    .withStt(new AresSTT())
    .withLlm(new OpenAI({ model: 'gpt-4o-mini',
      systemMessages: [{ role: 'system', content: instructions }], maxHistory: 30,
      params: { max_tokens: 250, temperature: 0.2 }, greetingMessage: "I'm ready when you are." }))
    .withTts(new AvatarMiniMaxTTS({ model: 'speech_2_6_turbo',
      voiceId }))
    .withAvatar(new AnamAvatar({ apiKey: requireEnv('ANAM_API_KEY'), avatarId,
      additionalParams: { agora_uid: String(AVATAR_UID), agora_token: avatarToken,
        sample_rate: sampleRate, quality: 'high', video_encoding: 'H264' } }));
  const session = agent.createSession({ name: `case-${sessionId}`, channel, agentUid: AGENT_UID,
    remoteUids: [String(CLIENT_UID)], idleTimeout: 30, expiresIn: ExpiresIn.minutes(5), debug: false });
  const agentId = await session.start();
  return { agentId, channel, clientUid: CLIENT_UID, agentUid: Number(AGENT_UID), avatarUid: AVATAR_UID };
}

/** Pass only an agent ID stored against the authenticated session, never browser input. */
export async function stopSuspectAgent(agentId: string): Promise<void> {
  z.string().min(1).max(200).parse(agentId);
  try { await client().stopAgent(agentId); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404) return;
    throw error;
  }
}

/** Authoritative service state; RUNNING alone does not prove the browser received media. */
export async function querySuspectAgent(agentId: string) {
  z.string().min(1).max(200).parse(agentId);
  const { appId, appCertificate } = config();
  const token = generateConvoAIToken({ appId, appCertificate, channelName: 'query', uid: 0, tokenExpire: 60 });
  const result = await client().agents.get({ appid: appId, agentId }, {
    headers: { Authorization: `agora token=${token}` }, timeoutInSeconds: 10, maxRetries: 1,
  });
  return { agentId: result.agent_id ?? agentId, status: result.status ?? 'UNKNOWN', running: result.status === 'RUNNING' };
}

/** Stored provider memory, NOT proof of audible playback. Never return this to a browser. */
export async function getSuspectProviderHistory(agentId: string) {
  z.string().min(1).max(200).parse(agentId);
  const { appId, appCertificate } = config();
  const token = generateConvoAIToken({ appId, appCertificate, channelName: 'history', uid: 0, tokenExpire: 60 });
  const history = await client().agents.getHistory({ appid: appId, agentId }, {
    headers: { Authorization: `agora token=${token}` }, timeoutInSeconds: 10, maxRetries: 1,
  });
  const parsed = z.object({
    agent_id: z.string(), status: z.literal('RUNNING'),
    contents: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(12000) })).max(100),
  }).parse(history);
  if (parsed.agent_id !== agentId) throw new Error('Provider history agent mismatch');
  return parsed.contents;
}
