import { createHash } from 'node:crypto';
import type { Evidence, Question, Scenario } from '../schema';
import { fingerprint } from '../fingerprint';

// Every line a player or the suspect reads is hand-written in that case's own file. These helpers only
// fill contract boilerplate (IDs, versions, scoring, fingerprint) and object shape. See docs/writing-cases.md.
type Draft = Omit<Scenario, 'scenarioId' | 'schemaVersion' | 'generatorVersion' | 'version' | 'estimatedDurationSeconds' | 'fingerprint' | 'status' | 'scoring' | 'difficulty'>;
const difficulties = ['easy', 'medium', 'hard'] as const;
export function build(i: number, draft: Draft): Scenario {
  const h = createHash('sha256').update(`handcrafted-v2-${i}`).digest('hex');
  const s: Scenario = {
    scenarioId: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`,
    schemaVersion: 1, generatorVersion: 'handcrafted-2', version: 1, difficulty: difficulties[i % 3],
    estimatedDurationSeconds: 180, fingerprint: '0'.repeat(64), status: 'validated',
    scoring: { version: 1, verdict: 500, evidence: 300, facts: 150, time: 50 },
    ...draft,
  };
  s.fingerprint = fingerprint(s);
  return s;
}
type Category = Evidence['category']; type Kind = Evidence['kind'];
export const pub = (id: string, title: string, category: Category, source: string, kind: Kind, description: string, interpretation: string): Evidence =>
  ({ id, title, description, category, source, kind, interpretation, availability: 'public', trigger: { allFactIds: [] } });
export const disc = (id: string, title: string, category: Category, source: string, kind: Kind, description: string, interpretation: string, allFactIds: string[]): Evidence =>
  ({ id, title, description, category, source, kind, interpretation, availability: 'discoverable', trigger: { allFactIds } });
export const fact = (id: string, statement: string, disclosurePhrases: string[], prerequisiteFactIds: string[] = []) => ({ id, statement, disclosurePhrases, prerequisiteFactIds });
export const ask = (id: string, text: string, category: Question['category'], priority: number, prerequisiteIds: string[], revealsFactIds: string[], spoilerSafety: Question['spoilerSafety']): Question =>
  ({ id, text, category, priority, prerequisiteIds, revealsFactIds, spoilerSafety });
const at = (day: string, hm: string) => `${day}T${hm}:00Z`;
export const span = (id: string, actorId: string, day: string, from: string, to: string, location: string, description: string, requiresAccess: boolean) =>
  ({ id, actorId, at: at(day, from), until: at(day, to), location, description, requiresAccess });
export const grant = (actorId: string, day: string, location: string, from: string, until: string) => ({ actorId, location, from: at(day, from), until: at(day, until) });
