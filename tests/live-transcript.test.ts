import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { connectLiveTranscript, normalizeTranscriptSpacing, toTranscriptLines, type TranscriptLine, type TranscriptSdks, type TranscriptStatus } from '../lib/agora/live-transcript';

type Item = Parameters<typeof toTranscriptLines>[0][number];
const item = (uid: string, turn_id: number, text: string, metadata: Item['metadata'] = null): Item => ({ uid, turn_id, stream_id: 1, _time: 1, text, status: 1, metadata });
const TRANSCRIPT_EVENT = 'transcript-updated';

function fakeSdks(overrides: { login?: () => Promise<unknown>; subscribe?: () => Promise<unknown>; logout?: () => Promise<unknown>; renew?: () => Promise<unknown>; init?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const rtmListeners = new Map<string, (event: unknown) => void>();
  const rtm = {
    addEventListener: (name: string, fn: (event: unknown) => void) => { rtmListeners.set(name, fn); },
    removeEventListener: (name: string) => { rtmListeners.delete(name); },
    login: async () => { calls.push('login'); await overrides.login?.(); },
    subscribe: async (channel: string) => { calls.push(`subscribe:${channel}`); await overrides.subscribe?.(); },
    logout: async () => { calls.push('logout'); await overrides.logout?.(); },
    renewToken: async (token: string) => { calls.push(`renew:${token}`); await overrides.renew?.(); },
  };
  const ai = {
    on: (name: string, fn: (...args: unknown[]) => void) => { handlers.set(name, fn); },
    subscribeMessage: (channel: string) => { calls.push(`bind:${channel}`); },
    unsubscribe: () => { calls.push('unsubscribe'); },
    destroy: () => { calls.push('destroy'); },
  };
  const sdks = {
    RTM: class { constructor() { return rtm; } },
    AgoraVoiceAI: { init: async () => { calls.push('init'); await overrides.init?.(); return ai; } },
    AgoraVoiceAIEvents: { TRANSCRIPT_UPDATED: TRANSCRIPT_EVENT },
    TranscriptHelperMode: { TEXT: 'text' },
  } as unknown as TranscriptSdks;
  return { sdks, calls, handlers, rtmListeners };
}
function connect(sdks: TranscriptSdks | (() => Promise<TranscriptSdks>)) {
  const statuses: TranscriptStatus[] = [], lines: TranscriptLine[][] = [];
  const transcript = connectLiveTranscript({
    rtcClient: {} as never, appId: 'app', channel: 'case-1', rtmUid: '1001', rtmToken: 'token',
    onStatus: status => statuses.push(status), onLines: next => lines.push(next),
  }, typeof sdks === 'function' ? sdks : async () => sdks);
  return { transcript, statuses, lines };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('transcript lines separate the detective from the suspect and drop empty turns', () => {
  assert.deepEqual(toTranscriptLines([item('0', 1, 'Where were you?'), item('123456-case-1', 1, 'At home.Alone.'), item('123456-case-1', 2, '   ')]), [
    { id: '0-1-1', speaker: 'detective', text: 'Where were you?', final: true },
    { id: '123456-case-1-1-1', speaker: 'suspect', text: 'At home. Alone.', final: true },
  ]);
  assert.equal(normalizeTranscriptSpacing('Yes,sir.  It cost 3.50 dollars'), 'Yes, sir. It cost 3.50 dollars');
});
test('a player turn is final only when the transcription says so, since text mode stamps every item as ended', () => {
  const user = (final: boolean) => ({ object: 'user.transcription', final } as unknown as Item['metadata']);
  const agent = (turn_status: number) => ({ object: 'assistant.transcription', turn_status } as unknown as Item['metadata']);
  assert.deepEqual(toTranscriptLines([item('0', 1, 'Where were', user(false)), item('0', 2, 'Where were you?', user(true)), item('9', 1, 'At', agent(0)), item('9', 2, 'At home.', agent(1)), item('9', 3, 'At the', agent(2))]).map(line => [line.speaker, line.final]),
    [['detective', false], ['detective', true], ['suspect', false], ['suspect', true], ['suspect', true]]);
  assert.equal(toTranscriptLines([{ ...item('0', 1, 'Hello'), status: 0 }])[0].final, false);
});
test('captions bind the toolkit before the RTM subscribe, then replace the full history', async () => {
  const { sdks, calls, handlers } = fakeSdks();
  const { statuses, lines } = connect(sdks);
  await settle();
  assert.deepEqual(calls, ['login', 'init', 'bind:case-1', 'subscribe:case-1']);
  assert.deepEqual(statuses, ['connecting', 'live']);
  handlers.get(TRANSCRIPT_EVENT)?.([item('0', 1, 'Hello')]);
  handlers.get(TRANSCRIPT_EVENT)?.([item('0', 1, 'Hello there')]);
  assert.deepEqual(lines.at(-1)?.map(line => line.text), ['Hello there']);
});
test('an RTM, toolkit or SDK load failure reports unavailable and never rejects', async () => {
  const failLogin = fakeSdks({ login: async () => { throw new Error('token rejected'); } });
  const login = connect(failLogin.sdks); await settle();
  assert.equal(login.statuses.at(-1), 'unavailable');
  assert.equal(failLogin.calls.includes('logout'), false);

  const failInit = fakeSdks({ init: async () => { throw new Error('toolkit failed'); } });
  const init = connect(failInit.sdks); await settle();
  assert.equal(init.statuses.at(-1), 'unavailable');
  assert.equal(failInit.calls.at(-1), 'logout');

  const failSubscribe = fakeSdks({ subscribe: async () => { throw new Error('RTM not enabled'); } });
  const subscribe = connect(failSubscribe.sdks); await settle();
  assert.equal(subscribe.statuses.at(-1), 'unavailable');
  assert.deepEqual(failSubscribe.calls.slice(-3), ['unsubscribe', 'destroy', 'logout']);

  const failLoad = connect(async () => { throw new Error('chunk failed'); }); await settle();
  assert.equal(failLoad.statuses.at(-1), 'unavailable');
  await failLoad.transcript.release();
});
test('release detaches the toolkit, logs out once, and silences later events', async () => {
  const { sdks, calls, handlers } = fakeSdks();
  const { transcript, lines, statuses } = connect(sdks);
  await settle();
  await transcript.release(); await transcript.release();
  assert.deepEqual(calls.slice(-3), ['unsubscribe', 'destroy', 'logout']);
  assert.equal(calls.filter(call => call === 'destroy').length, 1);
  handlers.get(TRANSCRIPT_EVENT)?.([item('0', 1, 'Too late')]);
  assert.equal(lines.length, 0);
  assert.equal(statuses.at(-1), 'live');
});
test('release during an in-flight login still logs that client out', async () => {
  let finishLogin = () => {};
  const { sdks, calls } = fakeSdks({ login: () => new Promise<void>(resolve => { finishLogin = resolve; }) });
  const { transcript, statuses } = connect(sdks);
  await settle();
  await transcript.release();
  assert.equal(calls.includes('logout'), false);
  finishLogin(); await settle();
  assert.deepEqual(calls, ['login', 'logout']);
  assert.equal(statuses.includes('live'), false);
});
test('a hung RTM logout cannot hold up the release path', async () => {
  const { sdks } = fakeSdks({ logout: () => new Promise(() => {}) });
  const { transcript } = connect(sdks);
  await settle();
  const startedAt = Date.now();
  await transcript.release();
  assert.ok(Date.now() - startedAt < 3000);
});
test('a lost RTM link reports unavailable and recovers without touching media', async () => {
  const { sdks, rtmListeners } = fakeSdks();
  const { statuses } = connect(sdks);
  await settle();
  rtmListeners.get('linkState')?.({ currentState: 'FAILED' });
  assert.equal(statuses.at(-1), 'unavailable');
  rtmListeners.get('linkState')?.({ currentState: 'CONNECTED' });
  assert.equal(statuses.at(-1), 'live');
});
test('token renewal failures stay inside the caption client', async () => {
  const { sdks, calls } = fakeSdks({ renew: async () => { throw new Error('expired'); } });
  const { transcript, statuses } = connect(sdks);
  await transcript.renewToken('early');
  await settle();
  await transcript.renewToken('fresh');
  assert.equal(calls.includes('renew:early'), false);
  assert.equal(calls.includes('renew:fresh'), true);
  assert.equal(statuses.at(-1), 'live');
});
test('the real toolkit turns RTM transcription messages into lines, then lets go of both clients', async () => {
  const toolkit = await import('agora-agent-client-toolkit');
  const rtmListeners = new Map<string, Set<(event: unknown) => void>>();
  const rtcListeners = new Set<string>();
  const rtm = {
    addEventListener: (name: string, fn: (event: unknown) => void) => { rtmListeners.set(name, (rtmListeners.get(name) ?? new Set()).add(fn)); },
    removeEventListener: (name: string, fn: (event: unknown) => void) => { rtmListeners.get(name)?.delete(fn); },
    login: async () => {}, subscribe: async () => {}, logout: async () => {}, publish: async () => {}, renewToken: async () => {},
  };
  const rtcClient = { on: (name: string) => { rtcListeners.add(name); }, off: (name: string) => { rtcListeners.delete(name); } };
  const sdks = { RTM: class { constructor() { return rtm; } }, AgoraVoiceAI: toolkit.AgoraVoiceAI, AgoraVoiceAIEvents: toolkit.AgoraVoiceAIEvents, TranscriptHelperMode: toolkit.TranscriptHelperMode } as unknown as TranscriptSdks;
  const lines: TranscriptLine[][] = [];
  const transcript = connectLiveTranscript({ rtcClient: rtcClient as never, appId: 'app', channel: 'case-1', rtmUid: '1001', rtmToken: 'token', onStatus: () => {}, onLines: next => lines.push(next) }, async () => sdks);
  await settle();
  const deliver = (publisher: string, body: object) => { for (const fn of rtmListeners.get('message') ?? []) fn({ publisher, message: JSON.stringify(body) }); };
  const base = { start_ms: 0, duration_ms: 0, language: 'en-US', stream_id: 0, user_id: '1001', words: null };
  deliver('123456', { ...base, object: 'user.transcription', text: 'Where were', turn_id: 1, final: false });
  deliver('123456', { ...base, object: 'user.transcription', text: 'Where were you?', turn_id: 1, final: true });
  deliver('123456', { ...base, object: 'assistant.transcription', text: 'At home.Alone.', turn_id: 1, quiet: false, turn_seq_id: 1, turn_status: 1 });
  assert.deepEqual(lines.at(-1)?.map(line => [line.speaker, line.text, line.final]), [['detective', 'Where were you?', true], ['suspect', 'At home. Alone.', true]]);
  // The interim user transcription arrived first, so the detective line was once not final.
  assert.equal(lines.some(batch => batch.some(line => line.speaker === 'detective' && !line.final)), true);
  assert.equal(new Set(lines.at(-1)?.map(line => line.id)).size, 2);
  await transcript.release();
  assert.equal(rtmListeners.get('message')?.size, 0);
  assert.equal(rtcListeners.size, 0);
  assert.equal(toolkit.AgoraVoiceAI.getState(), null);
});
test('each session gets its own RTM identity, and renewal keeps it', async () => {
  // Fixed-format dummies for token signing only; these are not credentials.
  process.env.NEXT_PUBLIC_AGORA_APP_ID = 'a'.repeat(32);
  process.env.NEXT_AGORA_APP_CERTIFICATE = 'b'.repeat(32);
  const { createPlayerRtcCredentials } = await import('../lib/agora/server-agent');
  const rtmSubject = (token: string) => inflateSync(Buffer.from(token.slice(3), 'base64')).toString('latin1');
  const sessionA = '11111111-1111-4111-8111-111111111111', sessionB = '22222222-2222-4222-8222-222222222222';
  const first = createPlayerRtcCredentials(sessionA), other = createPlayerRtcCredentials(sessionB);
  assert.notEqual(first.rtmUid, other.rtmUid);
  assert.ok(Buffer.byteLength(first.rtmUid) <= 64, 'RTM user IDs are limited to 64 bytes');
  assert.match(first.rtmUid, /^[A-Za-z0-9-]+$/);
  // The token subject must equal the login ID, or RTM login fails.
  assert.ok(rtmSubject(first.rtmToken).includes(first.rtmUid));
  assert.equal(rtmSubject(first.rtmToken).includes(other.rtmUid), false);
  // Token renewal re-requests credentials and applies them to the live RTM client.
  const renewed = createPlayerRtcCredentials(sessionA);
  assert.equal(renewed.rtmUid, first.rtmUid);
  assert.ok(rtmSubject(renewed.rtmToken).includes(first.rtmUid));
  // The RTC identities the agent subscribes to stay fixed.
  assert.deepEqual([first.uid, other.uid, first.agentUid, first.avatarUid], [1001, 1001, 123456, 1002]);
  assert.throws(() => createPlayerRtcCredentials('not-a-session'));
});
test('captions stay display only and outside the media readiness gate', async () => {
  const [helper, hook, session, route] = await Promise.all(['lib/agora/live-transcript.ts', 'lib/agora/use-suspect-voice.ts', 'components/game/production-session.tsx', 'app/api/sessions/[id]/[action]/route.ts'].map(path => readFile(path, 'utf8')));
  assert.doesNotMatch(helper, /sessionRequest|gameRequest|\bfetch\(|lib\/game\/api/);
  // The hook's only server actions remain the media lifecycle, none carrying a transcript.
  assert.deepEqual([...new Set([...hook.matchAll(/sessionRequest(?:<\w+>)?\(sessionId,\s*'([^']+)'/g)].map(match => match[1]))].sort(), ['connect', 'end', 'ready']);
  assert.doesNotMatch(hook, /sessionRequest(?:<\w+>)?\(sessionId,\s*'[^']+',\s*(?:[^\s{]|\{[^}])/);
  assert.match(hook, /!published \|\| !audioDecoded \|\| !videoDecoded \|\| failedAutoplay/);
  assert.doesNotMatch(hook, /await connectLiveTranscript/);
  assert.match(session, /sessionRequest<SessionView>\(sessionId,'sync-facts',\{\}\)/);
  assert.match(route, /if\(action==='sync-facts'\)return syncProviderFacts\(user\.id,id\)/);
});
test('the suspect shows at decode, the server starts the clock, and a failed start leaves nothing playing', async () => {
  const [hook, screen] = await Promise.all(['lib/agora/use-suspect-voice.ts', 'components/game/interview-screen.tsx'].map(path => readFile(path, 'utf8')));
  assert.match(screen, /const live = \['live','starting_clock','reconnecting'\]/);
  // The overlay lifts only past the decode gate, and 'live' follows only a server reply.
  const gate = hook.indexOf('!published || !audioDecoded'), overlay = hook.indexOf("setPhase('starting_clock')"), request = hook.indexOf("'ready', {}"), live = hook.indexOf("setPhase('live'); viewCallback");
  assert.ok(gate > 0 && gate < overlay && overlay < request && request < live);
  const failure = hook.slice(live, hook.indexOf('finally { readyInFlight'));
  assert.match(failure, /setPhase\('error'\)/);
  assert.match(failure, /await releaseMedia\(\)/);
  assert.match(failure, /\+\+attempt\.current/);
});
test('only a confirmed end stops the unmount cleanup from sending another', async () => {
  const [hook, session] = await Promise.all(['lib/agora/use-suspect-voice.ts', 'components/game/production-session.tsx'].map(path => readFile(path, 'utf8')));
  assert.equal(hook.match(/hasAgent\.current = false/g)?.length, 1);
  assert.match(hook, /const view = await sessionRequest<SessionView>\(sessionId, 'end', \{\}\)\n\s+hasAgent\.current = false/);
  assert.match(hook, /if\(hasAgent\.current\) void fetch\(/);
  assert.equal(hook.match(/sessionRequest(?:<\w+>)?\(sessionId,\s*'end'/g)?.length, 1);
  const disconnect = hook.slice(hook.indexOf('const disconnect ='), hook.indexOf('}, [releaseMedia])'));
  assert.doesNotMatch(disconnect, /hasAgent/);
  assert.match(session, /if\(actionName === 'end'\) applyView\(await voice\.endSession\(\)\)/);
  assert.doesNotMatch(session, /sessionRequest(?:<\w+>)?\(sessionId,\s*'end'/);
});
test('startup marks keep the agent start, remote join, publish and decode apart', async () => {
  const [hook, voice] = await Promise.all(['lib/agora/use-suspect-voice.ts', 'lib/server/voice.ts'].map(path => readFile(path, 'utf8')));
  assert.match(voice, /timer\.step\('agora-start',\(\)=>startSuspectAgent/);
  assert.match(hook, /client\.on\('user-joined'[\s\S]{0,160}-joined`\)/);
  for (const mark of ['connect-response', 'player-joined', 'mic-published', 'ready-request', 'ready']) assert.ok(hook.includes(`marks.mark('${mark}')`), mark);
  for (const mark of ['-published-${mediaType}', '-decoded-audio', '-decoded-video']) assert.ok(hook.includes(mark), mark);
  assert.ok(hook.indexOf("marks.mark('mic')") < hook.indexOf("marks.mark('connect-response')"));
});
