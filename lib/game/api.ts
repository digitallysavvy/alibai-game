'use client'

export interface PublicEvidence {
  id: string
  title: string
  description: string
  category: string
  source: string
  kind: 'observation' | 'character_claim'
  availability: 'public' | 'discoverable'
}
export interface PublicQuestion { id: string; text: string }
/** A fact the server has recorded, in the suspect's own words. Never present for an undiscovered fact. */
export interface RecordedFact { id: string; statement: string }
/** A question on the notebook page. The server says open or answered; "asked" is a browser-only reading of the captions. */
export interface Lead extends PublicQuestion { status: 'open' | 'answered'; facts: RecordedFact[] }
export interface Briefing {
  sessionId: string
  caseId: string
  title: string
  publicBriefing: string
  publicSuspect: { avatarId: string; voiceId: string; id: string; name: string; role: string; relationship: string; avatarDescription: string }
  publicEvidence: PublicEvidence[]
  initialSuggestedQuestions: PublicQuestion[]
}
export interface SessionView {
  session: { id: string; state: string; started_at: string | null; ended_at: string | null }
  serverTime: string
  briefing: Briefing
  notebook: PublicEvidence[]
  leads: Lead[]
  /** Recorded facts that no lead on the page lists, so they still show. */
  admissions: RecordedFact[]
  suggestions: { questions: PublicQuestion[]; more: number | null }
  results?: {
    correctVerdict: 'guilty' | 'innocent'
    explanation: string
    score: { verdict_points: number; evidence_points: number; fact_points: number; time_points: number; total: number; reason_codes: string[] }
    citedEvidence: PublicEvidence[]
    missedImportantClues: { evidence: PublicEvidence; why: string }[]
  }
}
const messages: Record<string, string> = {
  AUTH_UNAVAILABLE: 'Sign-in checks are briefly unavailable. Please try again in a moment.',
  LOGIN_REQUIRED: 'Please sign in at the rules page to continue.',
  INVALID_LOGIN: 'Sign in failed. Check your email, password and email confirmation.',
  SIGNUP_FAILED: 'Could not create your account. Check your details or try signing in.',
  AVATAR_POOL_EMPTY: 'No interview avatars are currently available. Please try again later.',
  POOL_EXHAUSTED: 'You have investigated every available case. Please return when the bureau adds more.',
  POOL_BUSY: 'Every available case is currently reserved. Please try again shortly.',
  SESSION_NOT_FOUND: 'This case is unavailable for your detective identity. Return to the rules to start a new case.',
  END_INTERROGATION_FIRST: 'End the interrogation before filing your verdict.',
  VERDICT_LOCKED: 'Your verdict is already filed. Open the results to review it.',
  AGENT_START_PENDING: 'The suspect is still being brought in. Please wait a moment and retry.',
  AGENT_NOT_READY: 'The suspect is not ready yet. Please retry the connection.',
  AGENT_STATE_CONFLICT: 'This interview was cancelled before the suspect arrived. Request another case.',
  MEDIA_NOT_CONFIGURED: 'The voice interview is not configured yet. Your case is saved and the clock has not started.',
}
export async function gameRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : body.error?.code ?? body.code
    throw new Error(messages[code] ?? 'The bureau could not complete that request. Please try again.')
  }
  return body as T
}
/** A unique query string misses the CDN, for a player who needs to see their own score now. */
export const leaderboardPath = (fresh = false) => fresh ? `/api/leaderboard?fresh=${Date.now()}-${Math.random().toString(36).slice(2)}` : '/api/leaderboard'
export const sessionRequest = <T>(id: string, action: string, body?: unknown) => gameRequest<T>(`/api/sessions/${encodeURIComponent(id)}/${action}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
