import './only';
import { createHash } from 'node:crypto';
import { getSuspectProviderHistory } from '../agora/server-agent';
import { matchProviderDisclosures } from '../scenarios/provider-disclosures';
import { GameError, rest } from './db';
import { loadSession, projectSnapshot, readProjection, recordFactRevealed, recordTranscriptTurn } from './game';

const SKIPPABLE = new Set(['UNSUPPORTED_DISCLOSURE', 'UNVERIFIED_DISCLOSURE', 'TURN_CONFLICT', 'FACT_LOCKED']);
// session_action refuses turns from this point, so writing after it would only burn calls.
const TURN_WINDOW_MS = 195_000;

type Turn = Parameters<typeof recordTranscriptTurn>[1];

/**
 * Keeps replies that matched nothing so a missed fact can be reviewed once Agora's history has
 * gone. These rows use a matched turn's ID and source, so a locked reply that matches on a later
 * poll finds its row instead of hitting TURN_CONFLICT. They earn nothing alone: scoring reads
 * session_facts, and only the matcher above can name a turn as a fact's proof. Best effort: a
 * failure stops here, and the next poll retries what is still missing.
 */
async function keepUnmatchedReplies(sessionId: string, turns: Turn[]) {
  try {
    for (const turn of turns) await recordTranscriptTurn(sessionId, turn);
  } catch (error) {
    console.error('Suspect reply not kept', error instanceof GameError ? error.code : 'UNKNOWN');
  }
}

/**
 * Owner-authenticated polling trigger only: accepts no transcript or fact IDs.
 * Provider memory verifies model output, not audio delivery (managed history has
 * no per-turn playback timestamps). Matching asserts a scripted spoken line inside
 * a sentence and fails closed on denials, questions, quotes and ambiguous text.
 */
export async function syncProviderFacts(playerId: string, sessionId: string) {
  const snapshot = await loadSession(playerId, sessionId);
  if (snapshot.session.state !== 'active') throw new GameError('NOT_ACTIVE', 409);
  // Embedded in this existing read so a poll with nothing new costs no extra database call.
  const runs = await rest<{ agent_id: string | null; state: string; game_sessions?: { session_events: { turn_id: string }[] } | null }[]>(
    `agent_runs?session_id=eq.${sessionId}&select=agent_id,state,game_sessions(session_events(turn_id))`);
  const agentId = runs[0]?.agent_id;
  if (!agentId || runs[0].state !== 'running') throw new GameError('AGENT_NOT_READY', 409);
  const history = await getSuspectProviderHistory(agentId);
  const discovered = new Set(snapshot.factIds);
  const knownBefore = discovered.size;
  const kept = new Set(runs[0].game_sessions?.session_events.map(event => event.turn_id));
  const unmatched: Turn[] = [];
  const source = 'agora-provider-history';
  for (const message of history) {
    const transcript = message.content.trim();
    if (message.role !== 'assistant' || !transcript) continue;
    // History has no stable managed turn IDs and its window shifts. Hash exact
    // text with agent ID, not array index; repeated disclosures earn no points.
    const turnId = `agora-history-${createHash('sha256').update(agentId).update('\0').update(transcript).digest('hex')}`;
    const firstSeen = !kept.has(turnId);
    kept.add(turnId);
    const facts = matchProviderDisclosures(snapshot.scenario, message.role, message.content, discovered);
    if (!facts.length) {
      if (firstSeen) unmatched.push({ turnId, actor: 'suspect', transcript, source });
      continue;
    }
    try {
      await recordTranscriptTurn(sessionId, { turnId, actor: 'suspect', transcript, source });
      for (const fact of facts) {
        await recordFactRevealed(sessionId, fact.id, turnId, source);
        discovered.add(fact.id);
      }
    } catch (error) {
      // This turn stays in history, so a rejection must not block the turns after it.
      if (!(error instanceof GameError) || !SKIPPABLE.has(error.code)) throw error;
      console.error('Provider disclosure rejected', error.code);
    }
  }
  // After the scoring writes above, so that keeping a reply can never delay one.
  if (Date.now() < Date.parse(snapshot.session.started_at ?? '') + TURN_WINDOW_MS) await keepUnmatchedReplies(sessionId, unmatched);
  // Nothing new means the snapshot still holds; projecting it stamps a fresh serverTime.
  return discovered.size > knownBefore ? readProjection(playerId, sessionId) : projectSnapshot(snapshot, sessionId);
}
