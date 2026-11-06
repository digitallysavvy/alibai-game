import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { AVATAR_CATALOG } from '../lib/game/avatar-catalog';
import { AVATAR_VOICES } from '../lib/game/avatar-voices';
import assert from 'node:assert/strict';
import { fixtures } from '../lib/scenarios/fixtures';
import { fingerprint, similarity } from '../lib/scenarios/fingerprint';
import { validateScenario, validateCaseSet } from '../lib/scenarios/validate';
import { briefing, leads, notebook, score, suggestions } from '../lib/scenarios/engine';
import { generateScenario, HumanReviewRequired, StructuredJsonProvider, type JsonProvider } from '../lib/scenarios/generator';
import type { Scenario } from '../lib/scenarios/schema';
import { stepTimer } from '../lib/server/timing';
import { formatClock, secondsLeft, startCountdown } from '../lib/game/clock';
const clone = (index = 0) => structuredClone(fixtures[index]);
const validateChanged = (s: Scenario) => { s.fingerprint = fingerprint(s); return validateScenario(s); };
test('eight diverse handcrafted mysteries satisfy the same production validator', () => {
 assert.equal(fixtures.length, 16); assert.equal(new Set(fixtures.map(s => s.fingerprint)).size, 16);
 assert.equal(new Set(fixtures.map(s => s.setting)).size, 16);
 for (const s of fixtures) assert.deepEqual(validateScenario(s).errors, [], s.title);
 assert.equal(fixtures.filter(s => s.truth.guilty).length, 8);
 for (const s of fixtures) assert.equal(s.answerKey.pivotal.filter(p => s.publicEvidence.some(e => e.id === p.evidenceId)).length, 1, s.title);
 assert.deepEqual(validateCaseSet(fixtures), []);
});
test('an innocent suspect with an explicitly permitted unrelated lie remains innocent', () => {
 const s = clone(1); assert.ok(s.knowledge.misleading.length); assert.equal(s.truth.guilty, false);
 assert.equal(s.answerKey.verdict, 'innocent'); assert.ok(validateScenario(s).valid);
});
test('inconsistent timeline, impossible access and simultaneous locations fail', () => {
 const s = clone(); s.truth.timeline[2].at = '2026-01-10T18:00:00Z';
 assert.ok(validateChanged(s).errors.some(e => e.includes('non-monotonic')));
 const access = clone(); access.truth.access = []; assert.equal(validateChanged(access).valid, false);
 const overlap = clone(); overlap.truth.timeline[2].location = 'other room';
 assert.ok(validateChanged(overlap).errors.some(e => e.includes('location overlap')));
});
test('private answer and explicit verdict leaks into briefing fail', () => {
 const s = clone(); s.publicBriefing = `${s.truth.actualEvent} ${s.publicBriefing}`;
 assert.ok(validateChanged(s).errors.some(e => e.includes('private answer leaked')));
 const explicit = clone(); explicit.publicBriefing = explicit.publicBriefing.replace('Nobody was hurt.', 'The suspect is guilty.');
 assert.ok(validateChanged(explicit).errors.some(e => e.includes('verdict leaked')));
});
test('answer-key references and resolution agree with truth', () => {
 const s = clone(); s.answerKey.pivotal[0].evidenceId = 'missing-evidence';
 assert.ok(validateChanged(s).errors.some(e => e.includes('missing reference')));
 const wrong = clone(); wrong.answerKey.verdict = 'innocent'; assert.ok(validateChanged(wrong).errors.includes('contradictory verdict'));
});
test('circular fact and question/evidence unlocks fail', () => {
 const s = clone(); s.knowledge.facts[0].prerequisiteFactIds = ['fact-2']; s.knowledge.facts[1].prerequisiteFactIds = ['fact-1'];
 assert.ok(validateChanged(s).errors.some(e => e.includes('circular')));
 const q = clone(); for (const question of q.suggestedQuestions) if (question.revealsFactIds.includes('fact-3')) question.prerequisiteIds = ['clue-3'];
 assert.ok(validateChanged(q).errors.some(e => e.includes('unsatisfiable')));
});
test('fingerprint ignores cosmetic titles, IDs and names; duplicate fingerprint rejected', () => {
 const s = clone(); s.title = 'A cosmetic new title'; s.suspect.name = 'Different fictional name';
 assert.equal(fingerprint(s), fixtures[0].fingerprint);
 assert.ok(validateScenario(s, fixtures).errors.includes('duplicate fingerprint')); assert.equal(similarity(s, fixtures[0]), 1);
});
test('public DTOs contain no truth, answer keys, unlock conditions or undiscovered evidence', () => {
 const s = clone(), dto = briefing(s, 'session-test');
 assert.deepEqual(Object.keys(dto).sort(), ['sessionId','caseId','title','publicBriefing','publicSuspect','publicEvidence','initialSuggestedQuestions'].sort());
 const serialized = JSON.stringify(dto);
 for (const forbidden of ['answerKey','interpretation','trigger','truth','knowledge','revealsFactIds','prerequisiteIds',s.truth.actualEvent,s.discoverableEvidence[0].description]) assert.equal(serialized.includes(forbidden), false, forbidden);
 assert.equal(dto.initialSuggestedQuestions.length, 3);
 assert.equal('category' in dto.initialSuggestedQuestions[0], false);
 assert.equal(dto.publicEvidence.some(e => (e.category as string) === 'red_herring'), false);
 assert.equal(dto.publicEvidence.find(e => e.id === clone().redHerrings[0].id)?.category, 'testimony');
});
test('every briefing lists only the public suspect fields and leaves out private actor direction', () => {
 const casting = { avatarId: 'avatar-test', voiceId: 'voice-test' };
 for (const s of fixtures) {
  const { publicSuspect } = briefing(s, 'session-test', casting);
  assert.deepEqual(Object.keys(publicSuspect).sort(), ['id','name','role','relationship','avatarDescription','avatarId','voiceId'].sort(), s.title);
  assert.equal(publicSuspect.avatarId, casting.avatarId, s.title);
  for (const dto of [briefing(s, 'session-test'), briefing(s, 'session-test', casting)]) {
   const serialized = JSON.stringify(dto);
   for (const forbidden of ['speechStyle','attitude',s.suspect.speechStyle,s.suspect.attitude]) assert.equal(serialized.includes(forbidden), false, `${s.title}: ${forbidden}`);
  }
 }
});
test('evidence IDs cannot reveal private classifications', () => {
 const s = clone(); s.redHerrings[0].id = 'red-herring-1'; s.answerKey.misleading[0].evidenceId = 'red-herring-1';
 assert.ok(validateChanged(s).errors.includes('evidence ID leaks private classification'));
});
test('question selection is pure and cannot unlock a clue; fact discovery unlocks followups', () => {
 const s = clone(), facts: string[] = [];
 suggestions(s, facts); suggestions(s, facts, 3);
 assert.deepEqual(facts, []); assert.equal(notebook(s, facts).length, 4);
 assert.equal(notebook(s, ['fact-1']).length, 5);
 const hiddenRed = clone(); hiddenRed.redHerrings[0].availability = 'discoverable'; hiddenRed.redHerrings[0].trigger.allFactIds = ['fact-1'];
 assert.equal(notebook(hiddenRed, ['fact-1']).find(e => e.id === hiddenRed.redHerrings[0].id)?.category, 'testimony');
 assert.ok(suggestions(s, ['fact-1']).questions.some(q => q.id === 'question-5'));
 assert.equal(suggestions(s, [], 3).more, null);
 assert.throws(() => suggestions(s, [], -1));
});
test('leads carry only allowlisted fields, and an open lead never names the fact it would reveal', () => {
 const s = clone();
 const before = leads(s, []);
 assert.ok(before.leads.length >= 3); assert.deepEqual(before.admissions, []);
 for (const lead of before.leads) { assert.deepEqual(Object.keys(lead).sort(), ['facts','id','status','text']); assert.equal(lead.status, 'open'); assert.deepEqual(lead.facts, []); }
 const serialized = JSON.stringify(before);
 for (const forbidden of ['revealsFactIds','prerequisiteIds','category','priority','spoilerSafety','statement','disclosurePhrases', ...s.knowledge.facts.map(f => f.statement), ...s.knowledge.facts.map(f => f.id)]) assert.equal(serialized.includes(forbidden), false, forbidden);
 const after = leads(s, ['fact-1']);
 const answered = after.leads.filter(l => l.status === 'answered');
 assert.deepEqual(answered.map(l => l.id), s.suggestedQuestions.filter(q => q.revealsFactIds.includes('fact-1')).map(q => q.id));
 for (const lead of answered) { assert.deepEqual(lead.facts, [{ id: 'fact-1', statement: s.knowledge.facts[0].statement }]); assert.deepEqual(Object.keys(lead.facts[0]).sort(), ['id','statement']); }
 // Facts that are still undiscovered stay out, whatever their lead says.
 const afterText = JSON.stringify(after);
 for (const fact of s.knowledge.facts.slice(1)) { assert.equal(afterText.includes(fact.statement), false, fact.id); assert.equal(afterText.includes(`"${fact.id}"`), false, fact.id); }
 // An unknown fact ID is ignored rather than trusted.
 assert.deepEqual(leads(s, ['not-a-fact']), before);
});
test('a recorded fact that no lead on the page lists still shows, as an admission', () => {
 const s = clone();
 // question-6 reveals fact-3 behind fact-2, and question-7 reveals it with no prerequisite; hide both routes.
 s.suggestedQuestions = s.suggestedQuestions.filter(q => !q.revealsFactIds.includes('fact-3'));
 const page = leads(s, ['fact-3']);
 assert.deepEqual(page.admissions, [{ id: 'fact-3', statement: s.knowledge.facts[2].statement }]);
 assert.equal(page.leads.some(l => l.status === 'answered'), false);
 // Once a lead that lists the fact is eligible, it owns the fact and the admission goes away.
 const listed = leads(clone(), ['fact-3']);
 assert.deepEqual(listed.admissions, []);
 assert.ok(listed.leads.some(l => l.status === 'answered' && l.facts[0]?.id === 'fact-3'));
});
test('follow-ups surface as facts unlock them, in priority order, and a player with facts left always has an open lead', () => {
 const s = clone();
 const start = leads(s, []).leads.map(l => l.id);
 assert.equal(start.includes('question-5'), false, 'needs record-1'); assert.equal(start.includes('question-6'), false, 'needs fact-2');
 const withOne = leads(s, ['fact-1']).leads;
 assert.deepEqual(withOne.slice(0, 2).map(l => [l.id, l.status]), [['question-1', 'answered'], ['question-5', 'open']], 'record-1, unlocked by fact-1, brings its priority-1 follow-up up beside the answered lead');
 assert.ok(leads(s, ['fact-1','fact-2']).leads.some(l => l.id === 'question-6' && l.status === 'open'));
 // Every reachable state of every case: facts remaining implies an open lead on the page.
 for (const scenario of fixtures) {
  const ids = scenario.knowledge.facts.map(f => f.id);
  for (let mask = 0; mask < 1 << ids.length; mask++) {
   const found = ids.filter((_, i) => mask & (1 << i));
   if (!scenario.knowledge.facts.every(f => !found.includes(f.id) || f.prerequisiteFactIds.every(id => found.includes(id)))) continue;
   const page = leads(scenario, found);
   assert.ok(page.leads.length <= 10, scenario.title);
   if (found.length < ids.length) assert.ok(page.leads.some(l => l.status === 'open'), `${scenario.title} with ${found.join(',')}`);
   else assert.equal(page.leads.some(l => l.status === 'open'), false, scenario.title);
   assert.equal(page.leads.filter(l => l.status === 'answered').flatMap(l => l.facts).concat(page.admissions).every(f => found.includes(f.id)), true, scenario.title);
   for (const id of found) assert.ok(page.leads.some(l => l.facts.some(f => f.id === id)) || page.admissions.some(f => f.id === id), `${scenario.title}: ${id} must show`);
  }
 }
});
test('deterministic score caps, rounding, unknown facts, duplicate citations and misleading evidence', () => {
 const s = clone(), allFacts = s.knowledge.facts.map(f => f.id), pivotal = s.answerKey.pivotal.map(p => p.evidenceId);
 assert.equal(score(s, 'guilty', pivotal, allFacts, 0).total, 1000);
 assert.equal(score(s, 'innocent', pivotal, allFacts, 180).total, 150);
 assert.equal(score(s, 'innocent', pivotal, allFacts, 180).evidencePoints, 0);
 assert.equal(score(s, 'guilty', [s.redHerrings[0].id], [], 180).evidencePoints, 0);
 // One pivotal item in each case is public, so a sharp reader scores without any facts.
 assert.equal(score(s, 'guilty', pivotal.filter(id => s.publicEvidence.some(e => e.id === id)), [], 180).evidencePoints, Math.floor(300 / pivotal.length));
 const everything = notebook(s, allFacts).map(e => e.id);
 assert.ok(everything.length >= pivotal.length * 2);
 assert.equal(score(s, 'guilty', everything, allFacts, 180).evidencePoints, 0);
 assert.equal(score(s, 'guilty', [...pivotal, s.redHerrings[0].id], allFacts, 180).evidencePoints, Math.floor(300 * (pivotal.length - 1) / pivotal.length));
 assert.deepEqual(score(s, 'guilty', [...pivotal,...pivotal], [...allFacts,...allFacts,'unknown'], 90), score(s, 'guilty', pivotal, allFacts, 90));
 assert.equal(score(s, 'guilty', [], ['fact-1'], 90).factPoints, 37);
 assert.equal(score(s, 'guilty', [], ['fact-1'], 999).timePoints, 0);
 assert.equal(score(s, 'guilty', [], [], 0).timePoints, 0);
 assert.equal(score(s, 'guilty', [], ['fact-1'], 0).timePoints, 50);
 assert.throws(() => score(s, 'guilty', [], [], NaN));
});
test('generation retries are bounded and feed deterministic failures back to author', async () => {
 let calls = 0; const inputs: string[] = []; const failures: unknown[] = [];
 const provider: JsonProvider = { async generate(r) { calls++; inputs.push(r.input); if (calls === 1) return { broken: true }; return clone(); } };
 const reviewer: JsonProvider = { async generate() { return { decision: 'approve', flags: [], summary: 'Independent review approves this coherent fictional case.' }; } };
 const result = await generateScenario({ seed: 42, difficulty: 'easy', guilty: true }, { provider, reviewer, onFailure: f => { failures.push(f); } });
 assert.equal(result.status, 'validated'); assert.equal(calls, 2); assert.equal(failures.length, 1); assert.ok(inputs[1].includes('validationFeedback'));
 await assert.rejects(generateScenario({ seed: 1, difficulty: 'easy' }, { provider: { async generate() { throw new Error('provider unavailable'); } }, maxAttempts: 2 }), /after 2 attempts/);
});
test('semantic approval cannot override deterministic failure; uncertainty is withheld', async () => {
 let reviewCalls = 0;
 const reviewer: JsonProvider = { async generate() { reviewCalls++; return { decision: 'approve', flags: [], summary: 'approved' }; } };
 const invalid = clone(); invalid.answerKey.pivotal[0].evidenceId = 'unknown-clue';
 await assert.rejects(generateScenario({ seed: 1, difficulty: 'easy' }, { provider: { async generate() { return invalid; } }, reviewer, maxAttempts: 1 })); assert.equal(reviewCalls, 0);
 await assert.rejects(generateScenario({ seed: 1, difficulty: 'easy' }, { provider: { async generate() { return clone(); } }, reviewer: { async generate() { return { decision: 'uncertain', flags: [], summary: 'Needs human assessment.' }; } } }), HumanReviewRequired);
});
test('strict provider never accepts Markdown-fenced JSON', async () => {
 const old = globalThis.fetch;
 globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{}\n```' } }] }));
 try { await assert.rejects(new StructuredJsonProvider('http://localhost/model', 'test', 'test').generate({ instruction: 'test', input: 'test', schema: {} }), SyntaxError); }
 finally { globalThis.fetch = old; }
});

test('all 14 cast IDs have voice mappings and match the immutable SQL roster seed', async () => {
 assert.equal(AVATAR_CATALOG.length, 14); assert.equal(new Set(AVATAR_CATALOG.map(a => a.avatarId)).size, 14);
 assert.deepEqual(new Set(AVATAR_CATALOG.map(a => a.avatarId)), new Set(AVATAR_VOICES.map(a => a.avatarId)));
 const migration = await readFile('supabase/migrations/20261104230603_avatar_catalog_assignment.sql', 'utf8');
 const rows = [...migration.matchAll(/\('([a-f0-9-]{36})','[^']*','([^']+)'\)/g)];
 assert.equal(rows.length, 14);
 for (const [_, avatarId, voiceId] of rows) assert.equal(AVATAR_VOICES.find(a => a.avatarId === avatarId)?.voiceId, voiceId);
 const roster = JSON.stringify(AVATAR_CATALOG);
 assert.equal(/guilty|innocent|culprit|answerKey/.test(roster), false);
});

test('embedded Anam catalog has fourteen unique avatar IDs and a voice for every actor', async () => {
 const { AVATAR_CATALOG,getAvatar }=await import('../lib/game/avatar-catalog');
 const { AVATAR_VOICES,getAvatarVoice,validateSessionVoice }=await import('../lib/game/avatar-voices');
 assert.equal(AVATAR_CATALOG.length,14);
 assert.equal(new Set(AVATAR_CATALOG.map(a=>a.avatarId)).size,14);
 assert.equal(AVATAR_VOICES.length,14);
 for(const avatar of AVATAR_CATALOG){
  assert.equal(getAvatar(avatar.avatarId),avatar);
  const voice=getAvatarVoice(avatar.avatarId);
  assert.equal(validateSessionVoice(voice.voiceId),voice.voiceId);
  assert.equal('guilty' in avatar,false);
  assert.equal('verdict' in voice,false);
 }
 assert.throws(()=>getAvatar('unapproved-id'));
 assert.throws(()=>getAvatarVoice('unapproved-id'));
 assert.throws(()=>validateSessionVoice('unapproved-voice'));
});

test('each actor can portray either verdict without mutating the immutable case', async () => {
 const { AVATAR_CATALOG }=await import('../lib/game/avatar-catalog');
 const { getAvatarVoice }=await import('../lib/game/avatar-voices');
 for(const avatar of AVATAR_CATALOG){
  const verdicts=new Set<string>();
  for(const fixture of fixtures){
   const before=JSON.stringify(fixture);
   const voiceId=getAvatarVoice(avatar.avatarId).voiceId;
   const dto=briefing(fixture,'session-cast',{avatarId:avatar.avatarId,voiceId});
   assert.equal(dto.publicSuspect.avatarId,avatar.avatarId);
   assert.equal(dto.publicSuspect.voiceId,voiceId);
   assert.equal(dto.publicSuspect.name,fixture.suspect.name);
   assert.equal('truth' in dto,false);
   assert.equal('answerKey' in dto,false);
   assert.equal(JSON.stringify(fixture),before);
   verdicts.add(fixture.answerKey.verdict);
  }
  assert.deepEqual([...verdicts].sort(),['guilty','innocent']);
 }
});

test('SQL roster and application actor/voice catalog agree', async () => {
 const { readFile }=await import('node:fs/promises');
 const { AVATAR_VOICES }=await import('../lib/game/avatar-voices');
 const sql=await readFile('supabase/migrations/20261104230603_avatar_catalog_assignment.sql','utf8');
 const rows=[...sql.matchAll(/\('([a-f0-9-]{36})','[^']+','([^']+)'\)/g)].map(match=>[match[1],match[2]]);
 assert.equal(rows.length,14);
 assert.deepEqual(rows.sort(),AVATAR_VOICES.map(v=>[v.avatarId,v.voiceId]).sort());
});

test('scripts/data matches the migrations and cases: run pnpm data:build if this fails', async () => {
 const { readFile, readdir } = await import('node:fs/promises');
 const cases = await readFile('scripts/data/cases.sql', 'utf8'), install = await readFile('scripts/data/install.sql', 'utf8');
 for (const s of fixtures) { assert.ok(cases.includes(s.fingerprint), s.title); assert.ok(install.includes(s.fingerprint), s.title); }
 for (const file of await readdir('supabase/migrations')) assert.ok(install.includes(file), file);
});
test('startup timing logs step durations only, including when a step fails', async () => {
 const lines: string[] = [], timer = stepTimer('agent', line => lines.push(line));
 assert.equal(await timer.step('load', async () => 'secret-value'), 'secret-value');
 await assert.rejects(timer.step('claim', async () => { throw new Error('secret-error'); }));
 timer.done();
 assert.equal(lines.length, 1); assert.doesNotMatch(lines[0], /secret/);
 const logged = JSON.parse(lines[0].replace('[timing] agent ', ''));
 assert.deepEqual(Object.keys(logged), ['load', 'claim', 'total', 'ok']); assert.equal(logged.ok, false);
 for (const key of ['load', 'claim', 'total']) assert.equal(typeof logged[key], 'number');
});
const startedAt = Date.UTC(2026, 10, 5, 12);
// A single large mock tick runs only one link of a timer chain, so advance as real time would.
const advance = (timers: { tick(ms: number): void }, ms: number) => { for (let i = 0; i < ms; i += 100) timers.tick(Math.min(100, ms - i)); };
test('the display clock applies the server correction and stops at the end time', () => {
 const timing = { startedAt, endedAt: null, clockOffset: 0 };
 assert.equal(secondsLeft({ ...timing, startedAt: null }, startedAt), 180);
 assert.equal(secondsLeft(timing, startedAt), 180); assert.equal(secondsLeft(timing, startedAt - 500), 180);
 assert.equal(secondsLeft(timing, startedAt + 179_001), 1); assert.equal(secondsLeft(timing, startedAt + 180_000), 0);
 assert.equal(secondsLeft({ ...timing, clockOffset: 5000 }, startedAt), 175);
 assert.equal(secondsLeft({ ...timing, endedAt: startedAt + 60_000 }, startedAt + 170_000), 120);
 assert.equal(formatClock(125), '02:05');
});
test('the countdown ticks once a second and expiry fires once, on time', t => {
 t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: startedAt });
 let ticks = 0, expired = 0;
 startCountdown({ startedAt, clockOffset: 0, onTick: () => ticks++, onExpire: () => expired++ });
 advance(t.mock.timers, 10_000); assert.equal(ticks, 11); assert.equal(expired, 0);
 advance(t.mock.timers, 169_999); assert.equal(expired, 0);
 t.mock.timers.tick(1); assert.equal(expired, 1);
 advance(t.mock.timers, 60_000); assert.equal(expired, 1);
});
test('the countdown expires by server time, at once if already over, and not after cancelling', t => {
 t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: startedAt });
 let expired = 0;
 startCountdown({ startedAt, clockOffset: 175_000, onExpire: () => expired++ });
 advance(t.mock.timers, 4999); assert.equal(expired, 0); t.mock.timers.tick(1); assert.equal(expired, 1);
 startCountdown({ startedAt: startedAt - 200_000, clockOffset: 0, onExpire: () => expired++ }); assert.equal(expired, 2);
 const cancel = startCountdown({ startedAt: Date.now(), clockOffset: 0, onExpire: () => expired++ });
 cancel(); advance(t.mock.timers, 200_000); assert.equal(expired, 2);
});
test('a device that sleeps past the deadline expires at its next step', t => {
 t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: startedAt });
 let expired = 0;
 startCountdown({ startedAt, clockOffset: 0, onExpire: () => expired++ });
 t.mock.timers.setTime(startedAt + 500_000); t.mock.timers.tick(1000); assert.equal(expired, 1);
});
test('the session wires expiry to ending the interview, and only the clock ticks', async () => {
 const session = await readFile('components/game/production-session.tsx', 'utf8');
 assert.match(await readFile('components/game/tape-recorder.tsx', 'utf8'), /const left = useSecondsLeft\(timing\)/);
 assert.doesNotMatch(session, /setInterval\(\(\) => setNow|setNow/);
 const expiry = session.slice(session.indexOf('onExpire:'), session.indexOf('voice.endSession])', session.indexOf('onExpire:')));
 assert.match(expiry, /voice\.disconnect\(\)/); assert.match(expiry, /voice\.endSession\(\)\.then\(data => \{ applyView\(data\)/);
 assert.match(session, /view\?\.session\.state !== 'active' \|\| started === null\) return\n\s+return startCountdown/);
});
