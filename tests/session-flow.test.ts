import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixtures } from '../lib/scenarios/fixtures';
import { syncProviderFacts } from '../lib/server/provider-facts';
import { handle } from '../lib/server/http';
import { GameError } from '../lib/server/db';
import { GET as leaderboard } from '../app/api/leaderboard/route';
import { leaderboardPath } from '../lib/game/api';

// No network: every request lands in this stub, using made-up configuration.
const fake = { NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.invalid', SUPABASE_SECRET_KEY: 'sb_secret_test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test', NEXT_PUBLIC_AGORA_APP_ID: 'a'.repeat(32), NEXT_AGORA_APP_CERTIFICATE: 'b'.repeat(32), ANAM_API_KEY: 'test' };
const realFetch = globalThis.fetch, playerId = randomUUID(), sessionId = randomUUID();
let scenario = fixtures[0];
let calls: string[], sessionRow: Record<string, unknown>, history: { role: string; content: string }[], historyAt: number;
let actions: { action: string; payload: Record<string, string> }[], stored: string[], factIds: string[], runsQuery: string, turnError: string | null;
beforeEach(() => {
  Object.assign(process.env, fake);
  scenario = fixtures[0]; calls = []; history = []; historyAt = 0; actions = []; stored = []; factIds = []; runsQuery = ''; turnError = null;
  sessionRow = { id: sessionId, player_id: playerId, scenario_id: scenario.scenarioId, avatar_id: 'x', minimax_voice_id: 'x', state: 'active', started_at: '2026-11-05T12:00:00.000Z', ended_at: null };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'supabase.invalid') {
      calls.push('agora'); await new Promise(done => setTimeout(done, 5)); historyAt = Date.now();
      return Response.json({ agent_id: 'agent-1', status: 'RUNNING', contents: history });
    }
    const name = url.pathname.replace('/rest/v1/', '').replace('/rpc/', '');
    calls.push(name);
    if (name === 'rpc/session_action') {
      const { p_action: action, p_payload: payload } = JSON.parse(String(init?.body));
      if (action === 'read') return Response.json({ session: sessionRow, scenario, factIds, score: null, verdict: null });
      actions.push({ action, payload });
      if (action === 'turn' && turnError) return Response.json({ message: turnError }, { status: 400 });
      if (action === 'turn' && !stored.includes(payload.turnId)) stored.push(payload.turnId);
      if (action === 'fact') factIds.push(payload.factId);
      return Response.json({});
    }
    if (name === 'rpc/read_leaderboard') return Response.json([{ playerId, detectiveName: 'Test', total: 900, bestScore: 900, gamesPlayed: 1 }]);
    if (name === 'agent_runs') {
      runsQuery = url.search;
      return Response.json([{ agent_id: 'agent-1', state: 'running', game_sessions: { session_events: stored.map(turn_id => ({ turn_id })) } }]);
    }
    if (name === 'game_sessions') return Response.json([{ player_id: playerId }]);
    throw new Error(`Unexpected request: ${name}`);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

test('a sync with no new fact answers from its snapshot, with a fresh serverTime', async () => {
  const view = await syncProviderFacts(playerId, sessionId);
  assert.deepEqual(calls, ['rpc/session_action', 'agent_runs', 'agora']);
  assert.ok(Date.parse(view.serverTime) >= historyAt);
  assert.equal(view.session.state, 'active');
  assert.equal(JSON.stringify(view).includes(scenario.truth.actualEvent), false);
});
test('a sync that records a fact re-reads so the view includes it', async () => {
  const fact = scenario.knowledge.facts.find(item => !item.prerequisiteFactIds.length)!;
  history = [{ role: 'assistant', content: fact.disclosurePhrases[0] }];
  await syncProviderFacts(playerId, sessionId);
  assert.equal(calls.at(-1), 'rpc/session_action');
  assert.equal(calls.filter(name => name === 'rpc/session_action').length, 4);
});
test('an unmatched reply is kept once, under the same ID, with no extra call on later polls', async () => {
  sessionRow = { ...sessionRow, started_at: new Date().toISOString() };
  history = [{ role: 'user', content: 'Where were you?' }, { role: 'assistant', content: ' Out. ' }, { role: 'assistant', content: 'Out.' }, { role: 'assistant', content: '  ' }];
  const first = await syncProviderFacts(playerId, sessionId);
  assert.match(decodeURIComponent(runsQuery), /select=agent_id,state,game_sessions\(session_events\(turn_id\)\)/);
  assert.equal(actions.length, 1);
  assert.deepEqual({ ...actions[0].payload, turnId: '' }, { turnId: '', actor: 'suspect', transcript: 'Out.', source: 'agora-provider-history' });
  assert.match(actions[0].payload.turnId, /^agora-history-[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(first).includes('agora-history-'), false);
  calls = []; actions = [];
  history = [{ role: 'assistant', content: 'Out.' }, { role: 'user', content: 'Where were you?' }];
  await syncProviderFacts(playerId, sessionId);
  assert.deepEqual(calls, ['rpc/session_action', 'agent_runs', 'agora']);
  history.push({ role: 'assistant', content: 'Still out.' });
  await syncProviderFacts(playerId, sessionId);
  assert.deepEqual(actions.map(item => item.payload.transcript), ['Still out.']);
});
test('a locked reply kept earlier proves its fact later, under the same ID and source', async () => {
  sessionRow = { ...sessionRow, started_at: new Date().toISOString() };
  scenario = structuredClone(fixtures[0]);
  const [needed, locked] = scenario.knowledge.facts;
  needed.prerequisiteFactIds = []; locked.prerequisiteFactIds = [needed.id];
  history = [{ role: 'assistant', content: locked.disclosurePhrases[0] }];
  await syncProviderFacts(playerId, sessionId);
  assert.deepEqual(actions.map(item => item.action), ['turn']);
  const kept = actions[0].payload;
  history.push({ role: 'assistant', content: needed.disclosurePhrases[0] });
  await syncProviderFacts(playerId, sessionId);
  await syncProviderFacts(playerId, sessionId);
  assert.deepEqual(factIds, [needed.id, locked.id]);
  assert.deepEqual(actions.at(-2)?.payload, kept);
  assert.equal(actions.at(-1)?.payload.turnId, kept.turnId);
  assert.equal(actions.at(-1)?.payload.source, kept.source);
});
test('scoring writes run first, and keeping a reply can never fail or reshape a sync', async () => {
  sessionRow = { ...sessionRow, started_at: new Date().toISOString() };
  const fact = scenario.knowledge.facts.find(item => !item.prerequisiteFactIds.length)!;
  history = [{ role: 'assistant', content: 'Out.' }, { role: 'assistant', content: fact.disclosurePhrases[0] }];
  await syncProviderFacts(playerId, sessionId);
  assert.deepEqual(actions.map(item => item.action), ['turn', 'fact', 'turn']);
  assert.equal(actions[2].payload.transcript, 'Out.');
  for (const message of ['NOT_ACTIVE', 'something else']) {
    calls = []; actions = []; stored = []; turnError = message;
    history = [{ role: 'assistant', content: 'One.' }, { role: 'assistant', content: 'Two.' }];
    const view = await syncProviderFacts(playerId, sessionId);
    assert.equal(view.session.state, 'active');
    assert.equal(actions.length, 1, 'the first failure stops the pass');
  }
});
test('no reply is written once the database would refuse it', async () => {
  sessionRow = { ...sessionRow, started_at: new Date(Date.now() - 196_000).toISOString() };
  history = [{ role: 'assistant', content: 'Out.' }];
  await syncProviderFacts(playerId, sessionId);
  assert.deepEqual(calls, ['rpc/session_action', 'agent_runs', 'agora']);
});
test('a sync still refuses a session that is not active', async () => {
  sessionRow = { ...sessionRow, state: 'ended' };
  await assert.rejects(syncProviderFacts(playerId, sessionId), { code: 'NOT_ACTIVE' });
});
test('only the leaderboard is CDN cached, and errors never are', async () => {
  const route = await readFile('app/api/leaderboard/route.ts', 'utf8');
  assert.match(route, /'s-maxage=5, stale-while-revalidate=5'/);
  assert.equal((await handle(async () => ({}))).headers.get('Cache-Control'), 'no-store');
  const cached = 's-maxage=10';
  assert.equal((await handle(async () => ({}), cached)).headers.get('Cache-Control'), cached);
  assert.equal((await handle(async () => { throw new GameError('POOL_BUSY', 409); }, cached)).headers.get('Cache-Control'), null);
  for (const path of ['app/api/sessions/route.ts', 'app/api/sessions/[id]/[action]/route.ts', 'app/api/auth/route.ts', 'app/api/realtime-auth/route.ts']) assert.doesNotMatch(await readFile(path, 'utf8'), /s-maxage/, path);
});
test("only a player's own fetches skip the CDN, and the route ignores how they do it", async () => {
  assert.equal(leaderboardPath(), '/api/leaderboard');
  const first = new URL(leaderboardPath(true), 'http://test'), second = leaderboardPath(true);
  assert.equal(first.pathname, '/api/leaderboard'); assert.ok(first.searchParams.get('fresh'));
  assert.notEqual(first.pathname + first.search, second);
  assert.equal(leaderboard.length, 0);
  const response = await leaderboard();
  assert.equal(response.headers.get('Cache-Control'), 's-maxage=5, stale-while-revalidate=5');
  assert.equal((await response.json())[0].total, 900);
  const [board, session] = await Promise.all(['components/game/live-leaderboard.tsx', 'components/game/production-session.tsx'].map(path => readFile(path, 'utf8')));
  assert.match(board, /onClick=\{\(\)=>void refresh\(true\)\}/);
  assert.match(board, /refresh\(new URLSearchParams\(window\.location\.search\)\.has\('fresh'\)\)/);
  assert.match(session, /href="\/leaderboard\?fresh=1"/);
});
