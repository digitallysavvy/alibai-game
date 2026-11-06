import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixtures } from '../lib/scenarios/fixtures';
import { assertValid } from '../lib/scenarios/validate';
import { score } from '../lib/scenarios/engine';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const enabled = process.env.RUN_DB_TESTS === '1' && !!url && !!service && !!anon;
// These tests reset short allocation leases. Never allow this suite against a remote database.
if (enabled && !['localhost', '127.0.0.1'].includes(new URL(url!).hostname)) throw new Error('DB tests require a disposable local Supabase');
async function request(path: string, body?: unknown, token = service!, method = 'POST') {
 const r = await fetch(`${url}${path}`, { method, headers: { apikey: token === service ? service! : anon!, ...(token.startsWith('eyJ') ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
 const content = await r.text(); const data = content ? JSON.parse(content) : null;
 return { ok: r.ok, status: r.status, data };
}
async function rpc(name: string, body: unknown) { const r = await request(`/rest/v1/rpc/${name}`, body); assert.ok(r.ok, JSON.stringify(r.data)); return r.data; }
async function player() {
 const email = `scenario-test-${randomUUID()}@example.invalid`, password = `${randomUUID()}Aa1!`;
 const created = await request('/auth/v1/admin/users', { email, password, email_confirm: true }); assert.ok(created.ok, JSON.stringify(created.data));
 const login = await request('/auth/v1/token?grant_type=password', { email, password }, anon!); assert.ok(login.ok, JSON.stringify(login.data));
 return { id: created.data.id as string, token: login.data.access_token as string };
}
const action = (playerId: string, sessionId: string, name: string, payload = {}) => rpc('session_action', { p_player: playerId, p_session: sessionId, p_action: name, p_payload: payload });
async function releaseLeases() { const r = await request('/rest/v1/scenario_allocations?scenario_id=not.is.null', { lease_until: '2000-01-01T00:00:00Z' }, service!, 'PATCH'); assert.ok(r.ok); }

test('local Supabase: atomic joins, idempotency, private RLS, discovery, scoring and exhaustion', { skip: !enabled, timeout: 120_000 }, async t => {
 for (const s of fixtures) {
  const existing = await request(`/rest/v1/scenarios?id=eq.${s.scenarioId}&select=id`, undefined, service!, 'GET'); assert.ok(existing.ok);
  if (!existing.data.length) await rpc('publish_scenario', { doc: assertValid(s) });
 }
 await releaseLeases();
 const a = await player(), b = await player(), keyA = randomUUID(), keyB = randomUUID(), secondKeyA = randomUUID();
 const [sidA, sidB] = await Promise.all([
  rpc('assign_scenario', { p_player: a.id, p_key: keyA }), rpc('assign_scenario', { p_player: b.id, p_key: keyB }),
 ]);
 const [stateA, stateB] = await Promise.all([action(a.id, sidA, 'read'), action(b.id, sidB, 'read')]);
 await t.test('two simultaneous joins reserve different scenarios', () => assert.notEqual(stateA.session.scenario_id, stateB.session.scenario_id));
 await t.test('all 14 cast performers are private, and retries preserve the assigned avatar and voice', async () => {
  const catalog = await request('/rest/v1/avatar_catalog?select=id,enabled,voice_id', undefined, service!, 'GET');
  assert.ok(catalog.ok); assert.equal(catalog.data.filter((entry: { enabled: boolean }) => entry.enabled).length, 14);
  assert.ok(catalog.data.some((entry: { id: string; voice_id: string }) => entry.id === stateA.session.avatar_id && entry.voice_id === stateA.session.minimax_voice_id));
  const visible = await request('/rest/v1/avatar_catalog?select=*', undefined, a.token, 'GET'); assert.equal(visible.ok, false);
  const retry = await rpc('assign_scenario', { p_player: a.id, p_key: keyA });
  const after = await action(a.id, retry, 'read');
  assert.equal(after.session.avatar_id, stateA.session.avatar_id); assert.equal(after.session.minimax_voice_id, stateA.session.minimax_voice_id);
  const otherAvatar = catalog.data.find((entry: { id: string }) => entry.id !== stateA.session.avatar_id).id;
  for (const patch of [{ avatar_id: otherAvatar }, { minimax_voice_id: 'tampered' }, { scenario_id: stateB.session.scenario_id }, { player_id: b.id }, { idempotency_key: randomUUID() }]) {
   const changed = await request(`/rest/v1/game_sessions?id=eq.${sidA}`, patch, service!, 'PATCH');
   assert.equal(changed.ok, false); assert.match(changed.data.message, /IMMUTABLE_SESSION_ASSIGNMENT/);
  }
 });
 await t.test('same key and double-click retries create no duplicate session', async () => {
  const retries = await Promise.all(Array.from({ length: 6 }, () => rpc('assign_scenario', { p_player: a.id, p_key: keyA })));
  assert.ok(retries.every(id => id === sidA));
  assert.equal(await rpc('assign_scenario', { p_player: a.id, p_key: secondKeyA }), sidA);
  const history = await request(`/rest/v1/player_scenario_history?player_id=eq.${a.id}`, undefined, service!, 'GET'); assert.equal(history.data.length, 1);
 });
 await t.test('stored public evidence does not expose red-herring classification', async () => {
  const visible = await request(`/rest/v1/evidence?scenario_id=eq.${stateA.session.scenario_id}&select=public_data`, undefined, service!, 'GET');
  assert.ok(visible.ok); assert.equal(JSON.stringify(visible.data).includes('red_herring'), false);
 });
 await t.test('browser cannot select secrets or invoke privileged RPCs', async () => {
  for (const table of ['scenario_secrets','secret_evidence','scenario_facts','suggested_questions','session_events','scores','scenario_generation_jobs']) {
   const read = await request(`/rest/v1/${table}?select=*`, undefined, a.token, 'GET'); assert.ok(!read.ok || read.data.length === 0, table);
  }
  const rpcRead = await request('/rest/v1/rpc/session_action', { p_player: a.id, p_session: sidA, p_action: 'read' }, a.token); assert.equal(rpcRead.ok, false);
  const other = await request(`/rest/v1/game_sessions?id=eq.${sidB}`, undefined, a.token, 'GET'); assert.ok(other.ok); assert.equal(other.data.length, 0);
  const write = await request('/rest/v1/scores', { session_id: sidA, verdict_points: 500 }, a.token); assert.equal(write.ok, false);
 });
 await t.test('database unique fingerprint rejects duplicate publication', async () => {
  const duplicate = structuredClone(fixtures[0]); duplicate.scenarioId = randomUUID();
  const result = await request('/rest/v1/rpc/publish_scenario', { doc: duplicate }); assert.equal(result.ok, false); assert.equal(result.data.code, '23505');
 });
 await t.test('undiscovered pivotal evidence cannot be cited even with a guessed ID', async () => {
  await action(b.id, sidB, 'start'); await action(b.id, sidB, 'end');
  const hidden = stateB.scenario.answerKey.pivotal.map((p: { evidenceId: string }) => p.evidenceId).find((id: string) => stateB.scenario.discoverableEvidence.some((e: { id: string }) => e.id === id));
  const result = await request('/rest/v1/rpc/session_action', { p_player: b.id, p_session: sidB, p_action: 'verdict', p_payload: { verdict: stateB.scenario.answerKey.verdict, evidenceIds: [hidden] } });
  assert.equal(result.ok, false); assert.match(result.data.message, /EVIDENCE_NOT_VISIBLE/);
 });
 await t.test('briefing verdict is rejected; only verified suspect turns discover facts', async () => {
  const early = await request('/rest/v1/rpc/session_action', { p_player: a.id, p_session: sidA, p_action: 'verdict', p_payload: { verdict: 'guilty', evidenceIds: [] } }); assert.equal(early.ok, false);
  await action(a.id, sidA, 'start');
  const f = stateA.scenario.knowledge.facts[0];
  const forged = await request('/rest/v1/rpc/session_action', { p_player: a.id, p_session: sidA, p_action: 'fact', p_payload: { factId: f.id, turnId: 'nonexistent', source: 'test-provider' } }); assert.equal(forged.ok, false);
  await action(a.id, sidA, 'turn', { turnId: 'detective-1', actor: 'detective', transcript: f.disclosurePhrases[0], source: 'test-provider' });
  const echoed = await request('/rest/v1/rpc/session_action', { p_player: a.id, p_session: sidA, p_action: 'fact', p_payload: { factId: f.id, turnId: 'detective-1', source: 'test-provider' } }); assert.equal(echoed.ok, false);
  for (const fact of stateA.scenario.knowledge.facts) {
   await action(a.id, sidA, 'turn', { turnId: fact.id, actor: 'suspect', transcript: fact.disclosurePhrases[0], source: 'test-provider' });
   await action(a.id, sidA, 'fact', { factId: fact.id, turnId: fact.id, source: 'test-provider' });
   await action(a.id, sidA, 'fact', { factId: fact.id, turnId: fact.id, source: 'test-provider' });
  }
  const after = await action(a.id, sidA, 'read'); assert.equal(after.factIds.length, stateA.scenario.knowledge.facts.length);
  const notebook = await request(`/rest/v1/session_clues?session_id=eq.${sidA}`, undefined, a.token, 'GET'); assert.equal(notebook.data.length, stateA.scenario.discoverableEvidence.length); assert.equal(JSON.stringify(notebook.data).includes('interpretation'), false);
 });
 await t.test('verdict is one-time and SQL scoring matches the deterministic TypeScript rubric', async () => {
  await action(a.id, sidA, 'end');
  const before = await action(a.id, sidA, 'read'); const scenario = before.scenario;
  const payload = { verdict: scenario.answerKey.verdict, evidenceIds: scenario.answerKey.pivotal.map((p: { evidenceId: string }) => p.evidenceId), reasoning: 'Verified the corroborating records.' };
  await action(a.id, sidA, 'verdict', payload); await action(a.id, sidA, 'verdict', payload);
  const after = await action(a.id, sidA, 'read');
  const calculated = score(scenario, payload.verdict, payload.evidenceIds, after.factIds, (Date.parse(after.session.ended_at)-Date.parse(after.session.started_at))/1000);
  assert.equal(after.score.total, calculated.total); assert.equal(after.score.evidence_points, calculated.evidencePoints); assert.equal(after.score.fact_points, calculated.factPoints);
  assert.equal(await rpc('assign_scenario', { p_player: a.id, p_key: secondKeyA }), sidA, 'A reused key stays bound even after scoring');
  const change = await request('/rest/v1/rpc/session_action', { p_player: a.id, p_session: sidA, p_action: 'verdict', p_payload: { ...payload, verdict: payload.verdict === 'guilty' ? 'innocent' : 'guilty' } }); assert.equal(change.ok, false);
 });
 await t.test('disabling a performer or changing its default voice never changes existing assignments', async () => {
  const avatarId = stateB.session.avatar_id, originalVoice = stateB.session.minimax_voice_id;
  try {
   const disable = await request(`/rest/v1/avatar_catalog?id=eq.${avatarId}`, { enabled: false, voice_id: 'test-only-future-voice' }, service!, 'PATCH'); assert.ok(disable.ok);
   const preserved = await action(b.id, sidB, 'read'); assert.equal(preserved.session.avatar_id, avatarId); assert.equal(preserved.session.minimax_voice_id, originalVoice);
   await releaseLeases(); const next = await rpc('assign_scenario', { p_player: b.id, p_key: randomUUID() });
   const subsequent = await action(b.id, next, 'read'); assert.notEqual(subsequent.session.avatar_id, avatarId);
  } finally {
   const restore = await request(`/rest/v1/avatar_catalog?id=eq.${avatarId}`, { enabled: true, voice_id: originalVoice }, service!, 'PATCH'); assert.ok(restore.ok);
  }
 });
 await t.test('returning player never repeats and gets explicit pool exhaustion', async () => {
  const published = await request('/rest/v1/scenarios?status=eq.published&select=id', undefined, service!, 'GET');
  const seen = new Set([stateA.session.scenario_id]);
  const seenAvatars = new Set([stateA.session.avatar_id]); let previousAvatar = stateA.session.avatar_id;
  for (let i = 1; i < published.data.length; i++) {
   await releaseLeases(); const sid = await rpc('assign_scenario', { p_player: a.id, p_key: randomUUID() });
   const state = await action(a.id, sid, 'read'); assert.equal(seen.has(state.session.scenario_id), false); seen.add(state.session.scenario_id);
   assert.notEqual(state.session.avatar_id, previousAvatar);
   if (seenAvatars.size < 14) assert.equal(seenAvatars.has(state.session.avatar_id), false, 'Least-used casting uses unseen avatars first');
   seenAvatars.add(state.session.avatar_id); previousAvatar = state.session.avatar_id;
   await action(a.id, sid, 'start'); await action(a.id, sid, 'end');
  }
  const exhausted = await request('/rest/v1/rpc/assign_scenario', { p_player: a.id, p_key: randomUUID() }); assert.equal(exhausted.ok, false); assert.match(exhausted.data.message, /POOL_EXHAUSTED/);
 });
});

test('local Supabase: spoken-line normalization matches the server', { skip: !enabled }, async () => {
 const { speechNormalize } = await import('../lib/scenarios/provider-disclosures');
 const lines = fixtures.flatMap(s => s.knowledge.facts.flatMap(f => f.disclosurePhrases));
 for (const line of [...lines, "I didn't, can't, won't, cannot; Sela’s key, it's 7:10 PM…"]) assert.equal(await rpc('speech_normalize', { p_text: line }), speechNormalize(line));
});

test('local Supabase: connect, ready and start races', { skip: !enabled, timeout: 120_000 }, async t => {
 for (const s of fixtures) {
  const existing = await request(`/rest/v1/scenarios?id=eq.${s.scenarioId}&select=id`, undefined, service!, 'GET'); assert.ok(existing.ok);
  if (!existing.data.length) await rpc('publish_scenario', { doc: assertValid(s) });
 }
 const open = async () => { await releaseLeases(); const p = await player(); return { id: p.id, token: p.token, sid: await rpc('assign_scenario', { p_player: p.id, p_key: randomUUID() }) as string }; };
 const args = (g: { id: string; sid: string }) => ({ p_player: g.id, p_session: g.sid });
 const connect = (g: { id: string; sid: string }) => rpc('session_connect', args(g));
 const ready = (g: { id: string; sid: string }, agent: string | null) => request('/rest/v1/rpc/session_ready', { ...args(g), p_agent: agent });
 const life = (g: { id: string; sid: string }, name: string, agent?: string) => request('/rest/v1/rpc/agent_lifecycle', { ...args(g), p_action: name, ...(agent ? { p_agent: agent } : {}) });
 const session = async (g: { id: string; sid: string }) => (await action(g.id, g.sid, 'read')).session;
 const run = async (g: { sid: string }) => (await request(`/rest/v1/agent_runs?session_id=eq.${g.sid}&select=agent_id,state`, undefined, service!, 'GET')).data[0];
 const refused = (result: { ok: boolean; data: { message?: string } }, code: string) => { assert.equal(result.ok, false, code); assert.match(String(result.data?.message), new RegExp(code)); };

 await t.test('connect returns the snapshot and the claim in one call, for the owner only', async () => {
  const g = await open(), other = await player();
  refused(await request('/rest/v1/rpc/session_connect', { p_player: other.id, p_session: g.sid }), 'SESSION_NOT_FOUND');
  assert.equal((await run(g)), undefined, 'a stranger claims nothing');
  const first = await connect(g);
  assert.deepEqual(first.claim, { claimed: true });
  assert.equal(first.snapshot.session.state, 'preparing');
  assert.ok(first.snapshot.scenario.answerKey, 'server-only snapshot, narrowed by projection()');
  assert.deepEqual(first.snapshot.factIds, []);
 });
 await t.test('browsers cannot call the new functions', async () => {
  const g = await open();
  refused(await request('/rest/v1/rpc/session_connect', args(g), g.token), 'permission denied');
  refused(await request('/rest/v1/rpc/session_ready', { ...args(g), p_agent: null }, g.token), 'permission denied');
  refused(await request('/rest/v1/rpc/session_connect', args(g), anon!), 'permission denied');
 });
 await t.test('double clicks and retries claim exactly once, and a renewal after commit sees the run', async () => {
  const g = await open();
  const results = await Promise.all(Array.from({ length: 8 }, () => connect(g)));
  assert.equal(results.filter(r => r.claim.claimed).length, 1);
  for (const r of results.filter(r => !r.claim.claimed)) { assert.equal(r.claim.state, 'starting'); assert.equal(r.claim.agentId, null); }
  assert.equal((await connect(g)).claim.state, 'starting');
  assert.ok((await life(g, 'commit', 'agent-renew')).ok);
  const renewed = await connect(g);
  assert.equal(renewed.claim.state, 'running'); assert.equal(renewed.claim.claimed, false);
 });
 await t.test('ready needs the committed agent, then starts the clock once', async () => {
  const g = await open(); await connect(g);
  refused(await ready(g, null), 'AGENT_NOT_READY');
  assert.equal((await session(g)).started_at, null); assert.equal((await session(g)).state, 'preparing');
  assert.ok((await life(g, 'commit', 'agent-ready-1')).ok);
  refused(await ready(g, 'agent-forged'), 'AGENT_NOT_READY');
  assert.equal((await session(g)).started_at, null);
  const started = await ready(g, 'agent-ready-1');
  assert.ok(started.ok); assert.equal(started.data.session.state, 'active'); assert.ok(started.data.session.started_at);
  const again = await ready(g, 'agent-ready-1');
  assert.equal(again.data.session.started_at, started.data.session.started_at, 'a reconnect never moves the clock');
 });
 await t.test('the run lookup in readyVoice only finds the owner\'s run', async () => {
  const g = await open(), stranger = await player(); await connect(g);
  const lookup = (playerId: string) => request(`/rest/v1/agent_runs?session_id=eq.${g.sid}&game_sessions.player_id=eq.${playerId}&select=agent_id,game_sessions!inner(player_id)`, undefined, service!, 'GET');
  const own = await lookup(g.id); assert.ok(own.ok, JSON.stringify(own.data));
  assert.equal(own.data.length, 1); assert.equal(own.data[0].agent_id, null);
  assert.deepEqual((await lookup(stranger.id)).data, []);
 });
 await t.test('no session and no run: ready refuses', async () => {
  const g = await open();
  refused(await ready(g, null), 'AGENT_NOT_READY');
  const other = await player();
  refused(await request('/rest/v1/rpc/session_ready', { p_player: other.id, p_session: g.sid, p_agent: null }), 'SESSION_NOT_FOUND');
 });
 await t.test('a failed start abandons the session, is visible and is never retried', async () => {
  const g = await open(); await connect(g);
  assert.ok((await life(g, 'failed')).ok);
  assert.equal((await session(g)).state, 'abandoned');
  refused(await ready(g, null), 'AGENT_NOT_READY');
  const after = await connect(g);
  assert.equal(after.claim, null); assert.equal(after.snapshot.session.state, 'abandoned');
  assert.equal((await run(g)).state, 'failed'); assert.equal((await session(g)).started_at, null);
 });
 await t.test('end before commit: commit conflicts, so the caller stops the agent, and no clock starts', async () => {
  const g = await open(); await connect(g);
  assert.ok((await request('/rest/v1/rpc/end_session', args(g))).ok);
  assert.equal((await life(g, 'stop')).ok, true, 'stop has no agent ID yet, so it is the start that must clean up');
  refused(await life(g, 'commit', 'agent-late'), 'AGENT_STATE_CONFLICT');
  assert.ok((await life(g, 'failed')).ok);
  assert.deepEqual(await run(g), { agent_id: null, state: 'failed' });
  refused(await ready(g, 'agent-late'), 'AGENT_NOT_READY');
  assert.equal((await session(g)).state, 'abandoned'); assert.equal((await session(g)).started_at, null);
 });
 await t.test('end racing commit always leaves one side able to stop the agent', async () => {
  for (let i = 0; i < 6; i++) {
   const g = await open(), agent = `agent-end-${randomUUID()}`; await connect(g);
   const [commit, end] = await Promise.all([life(g, 'commit', agent), request('/rest/v1/rpc/end_session', args(g))]);
   assert.ok(end.ok);
   const stop = await life(g, 'stop');
   if (commit.ok) assert.equal(stop.data.agentId, agent, 'committed first: stop gets the agent');
   else assert.match(commit.data.message, /AGENT_STATE_CONFLICT/);
   assert.equal((await session(g)).state, 'abandoned');
  }
 });
 await t.test('end before connect: leaving while the request is in flight claims nothing', async () => {
  const g = await open();
  assert.ok((await request('/rest/v1/rpc/end_session', args(g))).ok);
  assert.equal((await connect(g)).claim, null); assert.equal(await run(g), undefined);
 });
 await t.test('sessions past their clock or already closed are read without a claim', async () => {
  const g = await open(); await connect(g); assert.ok((await life(g, 'commit', `agent-${randomUUID()}`)).ok);
  const agent = (await run(g)).agent_id; assert.ok((await ready(g, agent)).ok);
  assert.equal((await connect(g)).claim.state, 'running', 'a reconnect during the interview');
  assert.ok((await request(`/rest/v1/game_sessions?id=eq.${g.sid}`, { started_at: new Date(Date.now() - 181_000).toISOString() }, service!, 'PATCH')).ok);
  assert.equal((await connect(g)).claim, null, 'past the clock');
  assert.ok((await request('/rest/v1/rpc/end_session', args(g))).ok);
  const ended = await connect(g);
  assert.equal(ended.claim, null); assert.equal(ended.snapshot.session.state, 'ended');
 });
 await t.test('code still using agent_lifecycle directly behaves as before', async () => {
  const g = await open(), agent = `agent-old-${randomUUID()}`;
  assert.deepEqual((await life(g, 'claim')).data, { claimed: true });
  assert.equal((await life(g, 'claim')).data.claimed, false);
  assert.ok((await life(g, 'commit', agent)).ok); assert.ok((await life(g, 'ready')).ok);
  assert.equal((await session(g)).state, 'active');
  assert.equal((await life(g, 'stop')).data.agentId, agent); assert.ok((await life(g, 'stopped')).ok);
 });
});
