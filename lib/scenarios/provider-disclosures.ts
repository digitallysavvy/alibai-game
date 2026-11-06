import type { Scenario } from './schema';

type Fact = Scenario['knowledge']['facts'][number];

/**
 * Spoken-text comparison form. Keep in step with public.speech_normalize in
 * supabase/migrations/20261105170000_disclosure_and_scoring.sql: tests compare the two.
 */
export function speechNormalize(text: string) {
  return text.toLowerCase().replace(/[’‘ʼ`´]/g, "'")
    .replace(/\bcan't\b/g, 'can not').replace(/\bcannot\b/g, 'can not').replace(/\bwon't\b/g, 'will not')
    .replace(/n't\b/g, ' not').replace(/'re\b/g, ' are').replace(/'ve\b/g, ' have').replace(/'ll\b/g, ' will')
    .replace(/'d\b/g, ' would').replace(/\bi'm\b/g, 'i am').replace(/\b(it|that|there|here|he|she|what|who)'s\b/g, '$1 is')
    .replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Words beside a phrase that turn it into a denial, hypothetical or report of someone else's claim.
const UNDERCUTTING = new Set(['not', 'never', 'no', 'nobody', 'nothing', 'nor', 'deny', 'denied', 'denies', 'false', 'untrue',
  'wrong', 'lie', 'lying', 'lied', 'if', 'unless', 'suppose', 'supposing', 'imagine', 'pretend', 'hypothetically', 'maybe',
  'perhaps', 'claim', 'claims', 'claimed', 'say', 'says', 'said', 'told', 'tell', 'asked', 'allegedly', 'whether']);
const RETRACTION = /\b(false|untrue|not true|lie|lying|made up|joking|kidding)\b/;

/**
 * Sentence ends need no following space: real replies arrive as "break.My tool roll". When in
 * doubt a sentence stays whole, because the rules above can only reject what shares its sentence.
 * So these don't end one: a full stop before a digit (19.10) or after a lone letter (R. Mayhew,
 * M.V, a.m.), a pause running on in lower case (I didn't… take it), and anything inside double
 * quotes. A semi-colon never ends one: it joins clauses, so a denial reaches across it.
 */
function sentencesOf(content: string) {
  const sentences: string[] = [];
  let start = 0, quoted = false;
  for (const { 0: mark, index } of content.matchAll(/["“”]|[.!?…]+/g)) {
    if (/["“”]/.test(mark)) { quoted = !quoted; continue; }
    const end = index + mark.length, rest = content.slice(end);
    const notAnEnd = mark === '.'
      ? /^\d/.test(rest) || /(?:^|[^\p{L}\d])\p{L}$/u.test(content.slice(start, index))
      : /…|\.\./.test(mark) && /^\s*\p{Ll}/u.test(rest);
    if (quoted || notAnEnd) continue;
    sentences.push(content.slice(start, end));
    start = end;
  }
  sentences.push(content.slice(start));
  return sentences.map(raw => raw.trim()).filter(Boolean);
}

function statesPhrase(sentence: string, next: string | undefined, phrase: string) {
  if (/[?"“”]/.test(sentence)) return false;
  const spoken = ` ${speechNormalize(sentence)} `, target = ` ${phrase} `;
  if (!spoken.includes(target)) return false;
  if (spoken.replace(target, ' ').split(' ').some(word => UNDERCUTTING.has(word))) return false;
  return !next || !RETRACTION.test(speechNormalize(next));
}

/**
 * Facts this reply gives up. A phrase must be asserted in its own sentence, so a suspect can
 * add a lead-in or speak two facts at once, but a denial, question or quote never counts.
 * A phrase shared by two facts is ambiguous and is ignored.
 */
export function matchProviderDisclosures(scenario: Scenario, role: string, content: string, discovered: ReadonlySet<string>): Fact[] {
  if (role !== 'assistant' || !content.trim()) return [];
  const facts = scenario.knowledge.facts.filter(fact => scenario.knowledge.knows.includes(fact.id));
  const owners = new Map<string, Set<string>>();
  for (const fact of facts) for (const raw of fact.disclosurePhrases) {
    const phrase = speechNormalize(raw);
    if (phrase) owners.set(phrase, (owners.get(phrase) ?? new Set()).add(fact.id));
  }
  const sentences = sentencesOf(content);
  const stated = facts.filter(fact => fact.disclosurePhrases.some(raw => {
    const phrase = speechNormalize(raw);
    return owners.get(phrase)?.size === 1 && sentences.some((sentence, i) => statesPhrase(sentence, sentences[i + 1], phrase));
  }));
  // A reply can satisfy its own prerequisite, so keep passing until nothing else unlocks.
  const known = new Set(discovered), found: Fact[] = [];
  for (let unlocked = true; unlocked;) {
    unlocked = false;
    for (const fact of stated) {
      if (known.has(fact.id) || fact.prerequisiteFactIds.some(id => !known.has(id))) continue;
      known.add(fact.id); found.push(fact); unlocked = true;
    }
  }
  return found;
}
