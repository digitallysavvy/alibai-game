import { z } from 'zod';
const id = z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/);
const text = z.string().min(3).max(4000);
const ids = z.array(id).max(30);
export const difficultySchema = z.enum(['easy', 'medium', 'hard']);
export const verdictSchema = z.enum(['guilty', 'innocent']);
export const triggerSchema = z.strictObject({ allFactIds: ids });
export const evidenceSchema = z.strictObject({
  id, title: text, description: text, category: z.enum(['physical','record','testimony','red_herring']),
  source: text, kind: z.enum(['observation','character_claim']), interpretation: text,
  availability: z.enum(['public','discoverable']), trigger: triggerSchema,
});
export const questionSchema = z.strictObject({
  id, text, category: z.enum(['alibi','timeline','access','motive','evidence','follow_up']),
  priority: z.number().int().min(1).max(100), prerequisiteIds: ids, revealsFactIds: ids,
  spoilerSafety: z.enum(['safe','contextual','spoiler']),
});
export const suspectSchema = z.strictObject({ id, name: text, ageRange: text, role: text,
  avatarDescription: text, speechStyle: text, attitude: text, relationship: text });
export const scenarioSchema = z.strictObject({
  scenarioId: z.uuid(), schemaVersion: z.literal(1), generatorVersion: text, version: z.number().int().positive(),
  title: text, genre: text, setting: text, crime: text, difficulty: difficultySchema,
  estimatedDurationSeconds: z.literal(180), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['draft','validated','published','retired']), publicBriefing: text,
  suspect: suspectSchema,
  truth: z.strictObject({ guilty: z.boolean(), culpritId: id, actualEvent: text, motive: text,
    opportunity: text, means: text, realAlibi: text, explanation: text,
    timeline: z.array(z.strictObject({ id, actorId: id, at: z.iso.datetime(), until: z.iso.datetime(),
      location: text, description: text, requiresAccess: z.boolean() })).min(3).max(30),
    access: z.array(z.strictObject({ actorId: id, location: text, from: z.iso.datetime(), until: z.iso.datetime() })).min(1),
  }),
  knowledge: z.strictObject({
    facts: z.array(z.strictObject({ id, statement: text, disclosurePhrases: z.array(text).min(1).max(5),
      prerequisiteFactIds: ids })).min(3).max(20),
    knows: ids, doesNotKnow: z.array(text), admitsImmediately: ids, revealsWhenQuestioned: ids,
    misleading: z.array(z.strictObject({ factId: id, realFact: text, permittedDeception: text })).max(5),
  }),
  publicEvidence: z.array(evidenceSchema).min(3).max(5), discoverableEvidence: z.array(evidenceSchema).min(3).max(5),
  redHerrings: z.array(evidenceSchema).min(1).max(2), suggestedQuestions: z.array(questionSchema).min(6).max(10),
  answerKey: z.strictObject({ verdict: verdictSchema,
    pivotal: z.array(z.strictObject({ evidenceId: id, why: text })).min(3).max(5),
    misleading: z.array(z.strictObject({ evidenceId: id, why: text })).min(1).max(2),
  }),
  solvabilityPath: z.array(z.strictObject({ questionId: id, alternativePhrasings: z.array(text).min(2),
    expectedFactIds: ids, why: text })).min(3).max(6),
  scoring: z.strictObject({ version: z.literal(1), verdict: z.literal(500), evidence: z.literal(300),
    facts: z.literal(150), time: z.literal(50) }),
});
export type Scenario = z.infer<typeof scenarioSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export const allEvidence = (s: Scenario) => [...s.publicEvidence, ...s.discoverableEvidence, ...s.redHerrings];
export const publicEvidenceDTO = (e: Evidence) => ({ id:e.id, title:e.title, description:e.description, category:e.category === 'red_herring' ? 'testimony' as const : e.category, source:e.source, kind:e.kind, availability:e.availability });
// speechStyle and attitude stay private: they are actor direction and can hint at guilt.
export const publicSuspectDTO = (s: Scenario['suspect']) => ({ id:s.id, name:s.name, role:s.role, relationship:s.relationship, avatarDescription:s.avatarDescription });
// Category stays private: which kinds of question a case carries can hint at its verdict.
export const questionDTO = (q: Question) => ({ id:q.id, text:q.text });
// Only for a fact the server has already recorded: the statement is what the suspect gave up aloud.
export const factDTO = (f: Scenario['knowledge']['facts'][number]) => ({ id:f.id, statement:f.statement });
