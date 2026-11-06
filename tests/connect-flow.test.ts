import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AVATAR_CATALOG } from '../lib/game/avatar-catalog';
import { getAvatarVoice } from '../lib/game/avatar-voices';
import { fixtures } from '../lib/scenarios/fixtures';
import { GameError } from '../lib/server/db';
import { projectSnapshot, type SessionRow, type Snapshot } from '../lib/server/game';
import { stepTimer } from '../lib/server/timing';
import { connectVoice, readyVoice } from '../lib/server/voice';

// No network: Supabase and Agora land in this stub, using made-up configuration.
const fake = { NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.invalid', SUPABASE_SECRET_KEY: 'sb_secret_test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test',
  NEXT_PUBLIC_AGORA_APP_ID: 'a'.repeat(32), NEXT_AGORA_APP_CERTIFICATE: 'b'.repeat(32), ANAM_API_KEY: 'anam-key-fixture' };
const realFetch = globalThis.fetch, playerId = randomUUID(), sessionId = randomUUID(), scenario = fixtures[0];
const avatarId = AVATAR_CATALOG[0].avatarId;
let calls: string[], agoraBodies: unknown[], rpcBodies: Record<string, Record<string, unknown>[]>, snapshot: Snapshot;
let claim: Record<string, unknown> | null, runs: { agent_id: string | null; state: string }[], agoraStatus: string;
let agoraDelay: number, failStart: number | null, commitError: string | null, readyError: string | null;
const postgrestError = (message: string) => Response.json({ message }, { status: 400 });

beforeEach(() => {
  Object.assign(process.env, fake);
  calls = []; agoraBodies = []; rpcBodies = {}; claim = { claimed: true }; runs = []; agoraStatus = 'RUNNING'; agoraDelay = 0; failStart = null; commitError = null; readyError = null;
  const session: SessionRow = { id: sessionId, player_id: playerId, scenario_id: scenario.scenarioId, avatar_id: avatarId, minimax_voice_id: getAvatarVoice(avatarId).voiceId, state: 'preparing', started_at: null, ended_at: null };
  snapshot = { session, scenario, factIds: [], score: null, verdict: null };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input)), method = request?.method ?? init?.method ?? 'GET';
    if (url.hostname !== 'supabase.invalid') {
      if (!url.pathname.includes('/projects/')) return new Response('{}');
      const text = request ? await request.clone().text() : String(init?.body ?? '');
      if (method === 'POST' && url.pathname.endsWith('/join')) {
        calls.push('agora-start'); agoraBodies.push(JSON.parse(text));
        await new Promise(resolve => setTimeout(resolve, agoraDelay));
        return failStart ? new Response('{}', { status: failStart }) : Response.json({ agent_id: 'agent-1', status: 'STARTING', create_ts: 1 });
      }
      if (method === 'POST') { calls.push('agora-stop'); return Response.json({}); }
      calls.push('agora-status');
      return Response.json({ agent_id: 'agent-1', status: agoraStatus });
    }
    const name = url.pathname.replace('/rest/v1/', '').replace('rpc/', '');
    calls.push(name);
    if (name === 'agent_runs') { assert.ok(url.search.includes(`game_sessions.player_id=eq.${playerId}`), 'run read is owner-scoped'); return Response.json(runs); }
    const body = JSON.parse(String(init?.body));
    (rpcBodies[name] ??= []).push(body);
    if (name === 'session_connect') return Response.json({ claim, snapshot });
    if (name === 'session_ready') return readyError ? postgrestError(readyError) : Response.json(snapshot);
    if (name === 'agent_lifecycle') return body.p_action === 'commit' && commitError ? postgrestError(commitError) : Response.json({});
    throw new Error(`Unexpected request: ${name}`);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const lifecycleActions = () => (rpcBodies.agent_lifecycle ?? []).map(body => body.p_action);
const coded = (code: string) => (error: unknown) => error instanceof GameError && error.code === code;

test('connect awaits the start and commit before it returns credentials', async () => {
  const result = await connectVoice(playerId, sessionId);
  assert.deepEqual(calls, ['session_connect', 'agora-start', 'agent_lifecycle']);
  assert.deepEqual(rpcBodies.session_connect, [{ p_player: playerId, p_session: sessionId }]);
  assert.deepEqual(rpcBodies.agent_lifecycle, [{ p_player: playerId, p_session: sessionId, p_action: 'commit', p_agent: 'agent-1' }]);
  assert.equal(result.view.session.state, 'preparing');
  assert.equal(result.connection?.channel, `case-${sessionId}`);
  assert.ok(result.connection?.rtcToken && result.connection.rtmToken);
});
test('the view reports server time from after the start, not before it', async () => {
  agoraDelay = 40;
  const before = Date.now(), { view } = await connectVoice(playerId, sessionId);
  assert.ok(Date.parse(view.serverTime) >= before + 35);
});
test('connection keeps the agent response shape, with no agent ID', async () => {
  const connection = (await connectVoice(playerId, sessionId)).connection;
  assert.deepEqual(Object.keys(connection ?? {}).sort(), ['agentUid', 'appId', 'avatarUid', 'channel', 'expiresAt', 'rtcToken', 'rtmToken', 'rtmUid', 'uid']);
});
test('connect exposes only allowlisted fields', async () => {
  claim = { claimed: false, state: 'running', agentId: 'agent-secret' };
  const result = await connectVoice(playerId, sessionId), text = JSON.stringify(result);
  assert.deepEqual(result.view, { ...projectSnapshot(snapshot, sessionId), serverTime: result.view.serverTime });
  assert.deepEqual(Object.keys(result).sort(), ['connection', 'view']);
  for (const secret of ['agent-secret', 'answerKey', 'actualEvent', scenario.truth.explanation, fake.NEXT_AGORA_APP_CERTIFICATE, fake.ANAM_API_KEY]) assert.ok(!text.includes(secret), secret);
});
test('the agent start keeps the staging greeting', async () => {
  await connectVoice(playerId, sessionId);
  const llm = (agoraBodies[0] as { properties: { llm: Record<string, unknown> } }).properties.llm;
  assert.equal(llm.greeting_message, "I'm ready when you are.");
  assert.equal(llm.greeting_configs, undefined);
});
test('renewals and reconnects get fresh tokens without a second start', async () => {
  claim = { claimed: false, state: 'running', agentId: 'agent-1' };
  const result = await connectVoice(playerId, sessionId);
  assert.ok(result.connection?.rtcToken);
  assert.deepEqual(calls, ['session_connect']);
});
test('any other run answers AGENT_START_PENDING, as the agent route did', async () => {
  for (const next of [{ claimed: false, state: 'starting', agentId: null }, { claimed: false, state: 'failed' }, { claimed: false, state: 'stopping', agentId: 'a' }, { claimed: false, state: 'stopped', agentId: 'a' }]) {
    claim = next; calls = [];
    await assert.rejects(connectVoice(playerId, sessionId), coded('AGENT_START_PENDING'), next.state);
    assert.deepEqual(calls, ['session_connect']);
  }
});
test('a session past connecting gets its view and no tokens', async () => {
  claim = null;
  const result = await connectVoice(playerId, sessionId);
  assert.equal(result.connection, null); assert.ok(result.view.briefing);
  assert.deepEqual(calls, ['session_connect']);
});
test('a failed Agora start records failed and throws to the caller', async () => {
  failStart = 400;
  await assert.rejects(connectVoice(playerId, sessionId));
  assert.deepEqual(lifecycleActions(), ['failed']);
  assert.ok(!calls.includes('agora-stop'), 'no agent ID means nothing to stop');
});
test('missing Agora configuration records failed instead of leaving a run starting', async () => {
  delete process.env.NEXT_AGORA_APP_CERTIFICATE;
  await assert.rejects(connectVoice(playerId, sessionId));
  assert.deepEqual(lifecycleActions(), ['failed']);
});
test('a commit conflict stops the agent, records failed and throws the code', async () => {
  commitError = 'AGENT_STATE_CONFLICT';
  await assert.rejects(connectVoice(playerId, sessionId), coded('AGENT_STATE_CONFLICT'));
  assert.deepEqual(calls, ['session_connect', 'agora-start', 'agent_lifecycle', 'agora-stop', 'agent_lifecycle']);
  assert.deepEqual(lifecycleActions(), ['commit', 'failed']);
});
test('any other commit failure also stops the agent and throws', async () => {
  commitError = 'connection reset';
  await assert.rejects(connectVoice(playerId, sessionId));
  assert.ok(calls.includes('agora-stop')); assert.deepEqual(lifecycleActions(), ['commit', 'failed']);
});
test('connect logs its steps on one line, including a failed start', async () => {
  const lines: string[] = [], timer = stepTimer('connect', line => lines.push(line));
  await connectVoice(playerId, sessionId, timer); timer.done();
  const logged = JSON.parse(lines[0].replace('[timing] connect ', ''));
  for (const key of ['connect', 'context', 'agora-start', 'commit', 'total']) assert.equal(typeof logged[key], 'number', key);
  assert.equal(logged.ok, true);
  for (const secret of [playerId, sessionId, 'agent-1']) assert.ok(!lines[0].includes(secret), secret);
  failStart = 400;
  const failedLines: string[] = [], failed = stepTimer('connect', line => failedLines.push(line));
  await assert.rejects(connectVoice(playerId, sessionId, failed)); failed.done();
  assert.equal(JSON.parse(failedLines[0].replace('[timing] connect ', '')).ok, false);
});
test('ready logs its steps on one line', async () => {
  const lines: string[] = [], timer = stepTimer('ready', line => lines.push(line));
  runs = [{ agent_id: 'agent-1', state: 'running' }];
  await readyVoice(playerId, sessionId, timer); timer.done();
  const logged = JSON.parse(lines[0].replace('[timing] ready ', ''));
  for (const key of ['agent-run', 'agent-query', 'session-ready']) assert.equal(typeof logged[key], 'number', key);
});
test('ready checks the agent, starts the clock in one call and returns the view', async () => {
  runs = [{ agent_id: 'agent-1', state: 'running' }];
  snapshot.session.state = 'active'; snapshot.session.started_at = '2026-11-05T12:00:00.000Z';
  const view = await readyVoice(playerId, sessionId);
  assert.deepEqual(calls, ['agent_runs', 'agora-status', 'session_ready']);
  assert.deepEqual(rpcBodies.session_ready, [{ p_player: playerId, p_session: sessionId, p_agent: 'agent-1' }]);
  assert.equal(view.session.started_at, '2026-11-05T12:00:00.000Z');
  assert.ok(!JSON.stringify(view).includes('answerKey'));
});
test('only a RUNNING agent reaches the clock', async () => {
  runs = [{ agent_id: 'agent-1', state: 'running' }];
  for (const status of ['IDLE', 'STARTING', 'RECOVERING', 'STOPPING', 'STOPPED', 'FAILED']) { agoraStatus = status; await assert.rejects(readyVoice(playerId, sessionId), coded('AGENT_NOT_READY'), status); }
  assert.ok(!calls.includes('session_ready'));
});
test('with no agent ID, SQL refuses and Agora is not called', async () => {
  runs = [{ agent_id: null, state: 'failed' }]; readyError = 'AGENT_NOT_READY';
  await assert.rejects(readyVoice(playerId, sessionId), coded('AGENT_NOT_READY'));
  runs = []; readyError = 'SESSION_NOT_FOUND';
  await assert.rejects(readyVoice(playerId, sessionId), coded('SESSION_NOT_FOUND'));
  assert.deepEqual(rpcBodies.session_ready.at(-1), { p_player: playerId, p_session: sessionId, p_agent: null });
  assert.ok(!calls.includes('agora-status'));
});
test('the route has no background work, and the old routes are gone', async () => {
  const [route, hook, voice] = await Promise.all(['app/api/sessions/[id]/[action]/route.ts', 'lib/agora/use-suspect-voice.ts', 'lib/server/voice.ts'].map(file => readFile(file, 'utf8')));
  assert.doesNotMatch(route, /maxDuration/); assert.doesNotMatch(voice, /\bafter\b/);
  assert.match(route, /action==='connect'/); assert.match(route, /action==='ready'/);
  assert.doesNotMatch(route, /'agent'|'agent-ready'/); assert.doesNotMatch(hook, /\(sessionId,\s*'agent(-ready)?'/);
  // Only a response with credentials means an agent exists, as staging's agent response did.
  assert.ok(hook.indexOf("<ConnectResponse>(sessionId, 'connect'") < hook.indexOf('hasAgent.current = true'));
  assert.ok(hook.indexOf("<ConnectResponse>(sessionId, 'connect'") < hook.indexOf('client.join('));
});
test('the room shows the case from read, and connects only once that view allows it', async () => {
  const session = await readFile('components/game/production-session.tsx', 'utf8');
  assert.match(session, /useEffect\(\(\) => \{ void refresh\(\) \}, \[refresh\]\)/);
  const gate = session.slice(session.indexOf('const state = view?.session.state'), session.indexOf('void voice.start()'));
  assert.match(gate, /secondsLeft\(\{ startedAt: started, endedAt: ended, clockOffset \}, Date\.now\(\)\) <= 0\) return/);
  assert.match(gate, /if\(!state \|\| !\['created','preparing','active'\]\.includes\(state\)\) return/);
  // Deferred after the gate, so React's development double mount can't cancel the only attempt.
  assert.match(gate, /window\.setTimeout\(\(\) => \{ autoConnected\.current = true; $/);
  assert.match(session, /void voice\.start\(\) \}, 0\)\n\s+return \(\) => window\.clearTimeout\(timer\)/);
  assert.match(session, /current\?\.session\.started_at && !data\.session\.started_at \? current : data/);
});
test('the migration is additive and service-role only', async () => {
  const sql = await readFile('supabase/migrations/20261105190000_connect_flow.sql', 'utf8');
  assert.doesNotMatch(sql, /\b(drop|alter|create or replace)\b/i);
  for (const fn of ['session_connect(uuid,uuid)', 'session_ready(uuid,uuid,text)']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public,anon,authenticated;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
  assert.equal(sql.match(/set search_path=''/g)?.length, 2);
});
