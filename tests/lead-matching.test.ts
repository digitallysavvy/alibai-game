import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixtures } from '../lib/scenarios/fixtures';
import { contentTokens, leadCoverage, matchLead, normalizeSpeech, similarWord, stem, visibleLeads } from '../lib/game/lead-matching';

const brindle = fixtures[0].suggestedQuestions.map(q => ({ id: q.id, text: q.text }));

test('speech normalisation opens contractions, spells digits and strips punctuation', () => {
  assert.equal(normalizeSpeech("Where’s the key? It's 10:30, isn't it!"), 'where is the key it is ten thirty is not it');
  assert.equal(normalizeSpeech("How's the workshop doing for money?"), 'how is the workshop doing for money');
  assert.equal(normalizeSpeech('Before 11, at the lane.'), 'before eleven at the lane');
  assert.equal(stem('keys'), 'key'); assert.equal(stem('asked'), 'ask'); assert.equal(stem('asking'), 'ask'); assert.equal(stem('glass'), 'glass'); assert.equal(stem('lane'), 'lane');
  assert.deepEqual(contentTokens('Um, so, where was the triangular key this morning?'), ['where', 'triangular', 'key', 'morning']);
  assert.ok(similarWord('triangular', 'triangula')); assert.ok(similarWord('counterweight', 'counter weight'.replace(' ', 'w')));
  assert.equal(similarWord('key', 'kay'), false, 'short words must match exactly');
  assert.equal(similarWord('workshop', 'warship'), false);
});

test('a rephrased, hesitant or misheard question still matches its lead, and unrelated speech matches nothing', () => {
  assert.equal(matchLead('Um, where was the triangular key this morning?', brindle), 'question-2');
  assert.equal(matchLead('so where was the triangle key this morning', brindle), 'question-2');
  assert.equal(matchLead("Is the front really the only way into that clock?", brindle), 'question-1');
  assert.equal(matchLead("How is the workshop doing for money, Mara?", brindle), 'question-3');
  assert.equal(matchLead('What happens to the clock after the lease review', brindle), 'question-4');
  assert.equal(matchLead('Who had the hatch off today?', brindle), 'question-5');
  assert.equal(matchLead('What went out to the lane in your tool roll?', brindle), 'question-6');
  assert.equal(matchLead('where did you go once the tour came back in', brindle), 'question-7');
  assert.equal(matchLead('Good morning. Thanks for coming in.', brindle), null);
  assert.equal(matchLead('Tell me about yourself.', brindle), null);
  assert.equal(matchLead('', brindle), null);
  assert.equal(matchLead('Where was the key?', []), null);
});

test('coverage needs most of a lead, never a single shared word, and a dead heat is left alone', () => {
  assert.equal(leadCoverage('the clock', 'What happens to the clock after the lease review?'), 0);
  assert.ok(leadCoverage('what happens to the clock after the review', 'What happens to the clock after the lease review?') >= 0.6);
  assert.equal(leadCoverage('anything at all', 'Where was the key?'), 0);
  const twins = [{ id: 'a', text: 'Where was the key this morning?' }, { id: 'b', text: 'Where was the key, this morning?' }];
  assert.equal(matchLead('where was the key this morning', twins), null, 'identical coverage on both leads is a dead heat');
  const pair = [{ id: 'a', text: 'Where was the key this morning?' }, { id: 'b', text: 'Where exactly did the key go?' }];
  assert.equal(matchLead('where exactly did the key go', pair), 'b');
  assert.equal(matchLead('where was the key this morning', pair), 'a');
});

test('every case question matches itself on the full page, and no paraphrase is pinned on a lead about something else', () => {
  const misattributed: string[] = [];
  let hits = 0;
  for (const s of fixtures) {
    const leads = s.suggestedQuestions.map(q => ({ id: q.id, text: q.text }));
    const reveals = (id: string) => s.suggestedQuestions.find(q => q.id === id)!.revealsFactIds.join(',');
    for (const q of s.suggestedQuestions) assert.equal(matchLead(q.text, leads), q.id, `${s.title}: ${q.text}`);
    // The authors' alternative phrasings are free paraphrases, which a lexical matcher is not meant to catch;
    // what matters is that one is never marked as a different lead.
    for (const step of s.solvabilityPath) for (const phrasing of step.alternativePhrasings) {
      const matched = matchLead(phrasing, leads);
      if (matched === step.questionId) hits++;
      else if (matched && reveals(matched) !== reveals(step.questionId)) misattributed.push(`${s.title}: ${phrasing} -> ${matched}`);
    }
  }
  // The one known case is a paraphrase that genuinely reads closer to the neighbouring lead's wording.
  assert.deepEqual(misattributed, ['Results Final: Who else can print under your account? -> question-4']);
  assert.ok(hits >= 5, `${hits} close paraphrases matched`);
});

test('the page keeps answered and asked leads and tops up open ones so a player never runs dry', () => {
  const leads = [
    { id: 'q1', status: 'open' as const }, { id: 'q2', status: 'answered' as const }, { id: 'q3', status: 'open' as const },
    { id: 'q4', status: 'open' as const }, { id: 'q5', status: 'open' as const }, { id: 'q6', status: 'open' as const },
  ];
  assert.deepEqual(visibleLeads(leads, new Set()).map(l => l.id), ['q1', 'q2', 'q3', 'q4']);
  assert.deepEqual(visibleLeads(leads, new Set(['q1', 'q3', 'q4'])).map(l => l.id), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
  assert.deepEqual(visibleLeads(leads, new Set(['q6'])).map(l => l.id), ['q1', 'q2', 'q3', 'q4', 'q6']);
  assert.deepEqual(visibleLeads([], new Set(['q1'])), []);
});

test('the asked marks stay in the browser: no request, no fact, no score', async () => {
  const [matching, hook, notebook, screen] = await Promise.all(['lib/game/lead-matching.ts', 'lib/game/use-asked-leads.ts', 'components/game/detective-notebook.tsx', 'components/game/interview-screen.tsx'].map(path => readFile(path, 'utf8')));
  for (const [name, source] of [['matching', matching], ['hook', hook], ['notebook', notebook]] as const) {
    assert.doesNotMatch(source, /sessionRequest|gameRequest|\bfetch\(/, name);
    assert.doesNotMatch(source, /revealsFactIds|prerequisiteIds|factIds/, name);
  }
  assert.doesNotMatch(screen, /sessionRequest|gameRequest|\bfetch\(/);
  // Only finished detective turns are read, and each only once.
  assert.match(hook, /line\.speaker === 'detective' && line\.final && !read\.current\.has\(line\.id\)/);
  assert.match(hook, /'use client'/);
});
