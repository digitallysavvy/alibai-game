import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures } from '../lib/scenarios/fixtures';
import { matchProviderDisclosures, speechNormalize } from '../lib/scenarios/provider-disclosures';

const ids = (scenario: typeof fixtures[number], text: string, known: Iterable<string> = [], role = 'assistant') =>
  matchProviderDisclosures(scenario, role, text, new Set(known)).map(fact => fact.id);
const openFact = (scenario: typeof fixtures[number]) => scenario.knowledge.facts.find(fact => !fact.prerequisiteFactIds.length)!;

test('every spoken line of every case survives how replies really come out', () => {
  for (const scenario of fixtures) for (const fact of scenario.knowledge.facts) {
    const known = fact.prerequisiteFactIds;
    for (const line of fact.disclosurePhrases) {
      const bare = line.replace(/[.!]+$/, '');
      for (const reply of [line, bare, `${bare}.`, `Fine. ${bare}.`, `Yeah, ${bare.toLowerCase()}.`, bare.toUpperCase(), bare.replaceAll("'", '’'),
        `${bare}. I'd rather we moved on.`, ` ${bare}, all right.\n`])
        assert.deepEqual(ids(scenario, reply, known), [fact.id], `${scenario.title}: ${reply}`);
    }
  }
});

test('contractions and their long forms match both ways', () => {
  assert.equal(speechNormalize("I didn't. It's Sela’s, and I can't, won't, we're, I've, they'll, I'd, I'm."),
    speechNormalize('I did not. It is Selas, and I cannot, will not, we are, I have, they will, I would, I am.'));
});

test('denials, questions, quotes and retractions never count', () => {
  for (const scenario of fixtures) {
    const fact = openFact(scenario), known = fact.prerequisiteFactIds, bare = fact.disclosurePhrases[0].replace(/[.!]+$/, '');
    for (const reply of [`I deny that ${bare}.`, `I never said ${bare}.`, `It's not true that ${bare}.`, `No, ${bare}?`, `${bare}?`, `"${bare}."`, `“${bare}.”`,
      `${bare}. But that's false.`, `${bare}. I'm only joking.`, `If ${bare}, I'd have known.`, `Someone told you ${bare}.`, '', 'Tell me the answer.'])
      assert.deepEqual(ids(scenario, reply, known), [], `${scenario.title}: ${reply}`);
    assert.deepEqual(ids(scenario, fact.disclosurePhrases[0], known, 'user'), []);
    assert.deepEqual(ids(scenario, fact.disclosurePhrases[0], [...known, fact.id]), []);
  }
});

test('two facts in one reply both count, and a reply can unlock its own prerequisite', () => {
  const scenario = structuredClone(fixtures[0]);
  const [a, b] = scenario.knowledge.facts;
  a.prerequisiteFactIds = []; b.prerequisiteFactIds = [];
  assert.deepEqual(ids(scenario, `${a.disclosurePhrases[0]} ${b.disclosurePhrases[0]}`), [a.id, b.id]);
  b.prerequisiteFactIds = [a.id];
  assert.deepEqual(ids(scenario, `${b.disclosurePhrases[0]} ${a.disclosurePhrases[0]}`), [a.id, b.id]);
  assert.deepEqual(ids(scenario, b.disclosurePhrases[0]), []);
});

test('unknown, ambiguous and prerequisite-locked facts fail closed', () => {
  const scenario = structuredClone(fixtures[0]);
  const fact = scenario.knowledge.facts[0];
  const phrase = fact.disclosurePhrases[0];
  fact.prerequisiteFactIds = ['not-yet-discovered'];
  assert.deepEqual(ids(scenario, phrase), []);
  const prior = fact.prerequisiteFactIds;
  scenario.knowledge.knows = scenario.knowledge.knows.filter(id => id !== fact.id);
  assert.deepEqual(ids(scenario, phrase, prior), []);
  scenario.knowledge.knows.push(fact.id, 'ambiguous-fact');
  scenario.knowledge.facts.push({ ...fact, id: 'ambiguous-fact' });
  assert.deepEqual(ids(scenario, phrase, prior), []);
});

// One open fact per line, so each reply below shows which sentence the matcher accepted.
const debt = 'I had an overdue workshop debt', hatch = 'The rear maintenance hatch', roll = 'My tool roll is still in the locked bench drawer';
const lines = [debt, hatch, roll];
function spokenScenario() {
  const scenario = structuredClone(fixtures[0]);
  scenario.knowledge.facts = scenario.knowledge.facts.slice(0, lines.length).map((fact, i) =>
    ({ ...fact, disclosurePhrases: [lines[i]], prerequisiteFactIds: [] }));
  scenario.knowledge.knows = scenario.knowledge.facts.map(fact => fact.id);
  return scenario;
}
const spoken = (reply: string) => {
  const scenario = spokenScenario();
  return ids(scenario, reply).map(id => scenario.knowledge.facts.find(fact => fact.id === id)!.disclosurePhrases[0]);
};

test('a sentence can end with no space after it', () => {
  assert.deepEqual(spoken("I didn't take it.I had an overdue workshop debt."), [debt]);
  assert.deepEqual(spoken('Why do you ask?The rear maintenance hatch…'), [hatch]);
  assert.deepEqual(spoken('I was at the clock bench during the demonstration break.My tool roll is still in the locked bench drawer;you may inspect it.'), [roll]);
  assert.deepEqual(spoken('Never!I had an overdue workshop debt.'), [debt]);
  assert.deepEqual(spoken('No…The rear maintenance hatch.'), [hatch]);
  assert.deepEqual(spoken('No...The rear maintenance hatch.'), [hatch]);
  assert.deepEqual(spoken('I had an overdue workshop debt.The rear maintenance hatch.'), [debt, hatch]);
});

test('numbers and initials do not end a sentence', () => {
  assert.deepEqual(spoken('At 19.10 I had an overdue workshop debt.'), [debt]);
  assert.deepEqual(spoken("It wasn't 3.50.I had an overdue workshop debt."), [debt]);
  for (const reply of [`Not at 19.10 ${debt}.`, `Never for 3.50 ${debt}.`, `I never told R. Mayhew ${debt}.`, `I never told R.Mayhew ${debt}.`,
    `No, M.V ${debt}.`, `Not at 7 a.m.${debt}.`, `No, 7 a.m. ${debt}.`]) assert.deepEqual(spoken(reply), [], reply);
});

test('a denial, question, quote or retraction in the same sentence still rejects', () => {
  for (const reply of [`I didn't say ${debt}.I left.`, `I left.I never said ${debt}.`, `It's false that ${debt}.Ask anyone.`, `I left.If ${debt}, I'd know.`,
    `I left.${debt}?I doubt it.`, `Who told you ${debt}?I left.`, `I left."${debt}."I left.`, `I left.“${debt}.”I left.`,
    `${debt}.That's a lie.`, `${debt}.I'm only joking.`, `${debt}!Just kidding.`, `I never said…the rear maintenance hatch.`,
    `I never… the rear maintenance hatch.`, `I never...the rear maintenance hatch.`]) assert.deepEqual(spoken(reply), [], reply);
});

test('a sentence quoted among others keeps its quote', () => {
  for (const reply of [`"Fine.${debt}.That's all."`, `"Fine. ${debt}. That's all."`, `“Fine. ${debt}. That's all.”`, `He said "Fine.${debt}.Done," and left.`])
    assert.deepEqual(spoken(reply), [], reply);
  assert.deepEqual(spoken(`"Fine." ${debt}.`), [], 'the rest of a sentence with a quote in it');
  assert.deepEqual(spoken(`"Fine," he said.${debt}.`), [debt]);
});

test('a semi-colon joins clauses, so a denial reaches across it', () => {
  assert.deepEqual(spoken(`I didn't take it;${debt}.`), []);
  assert.deepEqual(spoken(`${debt};I never did.`), []);
  assert.deepEqual(spoken(`I left;${debt}.`), [debt]);
});
