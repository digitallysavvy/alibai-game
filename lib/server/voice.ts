import './only';
import { createPlayerRtcCredentials,startSuspectAgent,stopSuspectAgent,querySuspectAgent } from '../agora/server-agent';
import { buildSuspectAgentContext,projectSnapshot,type Snapshot } from './game';
import { GameError,rest,rpc } from './db';
import { noTimer,type StepTimer } from './timing';
const lifecycle=(playerId:string,sessionId:string,action:string,agentId?:string)=>rpc<{claimed?:boolean;state?:string;agentId?:string}>('agent_lifecycle',{p_player:playerId,p_session:sessionId,p_action:action,...(agentId?{p_agent:agentId}:{})});
/** Also renews tokens and reconnects: only the call that wins the claim starts an agent. */
export async function connectVoice(playerId:string,sessionId:string,timer:StepTimer=noTimer){
 const {claim,snapshot}=await timer.step('connect',()=>rpc<{claim:{claimed?:boolean;state?:string;agentId?:string}|null;snapshot:Snapshot}>('session_connect',{p_player:playerId,p_session:sessionId}));
 // A null claim is a session past connecting, which the room still shows.
 if(!claim)return {view:projectSnapshot(snapshot,sessionId),connection:null};
 if(!claim.claimed){if(claim.state==='running'&&claim.agentId)return {view:projectSnapshot(snapshot,sessionId),connection:createPlayerRtcCredentials(sessionId)};throw new GameError('AGENT_START_PENDING',409)}
 let agentId:string|undefined;
 try{
  const instructions=await timer.step('context',async()=>buildSuspectAgentContext(snapshot.scenario));
  const started=await timer.step('agora-start',()=>startSuspectAgent({sessionId,avatarId:snapshot.session.avatar_id,voiceId:snapshot.session.minimax_voice_id,instructions}));agentId=started.agentId;
  await timer.step('commit',()=>lifecycle(playerId,sessionId,'commit',agentId));
  // Projected last so serverTime doesn't lag by the length of Agora's start.
  return {view:projectSnapshot(snapshot,sessionId),connection:createPlayerRtcCredentials(sessionId)};
 }catch(error){if(agentId)await stopSuspectAgent(agentId).catch(()=>{});await lifecycle(playerId,sessionId,'failed').catch(()=>{});throw error}
}
export async function readyVoice(playerId:string,sessionId:string,timer:StepTimer=noTimer){
 // With no agent ID, session_ready refuses: SESSION_NOT_FOUND for a stranger, else AGENT_NOT_READY.
 const [run]=await timer.step('agent-run',()=>rest<{agent_id:string|null}[]>(`agent_runs?session_id=eq.${sessionId}&game_sessions.player_id=eq.${playerId}&select=agent_id,game_sessions!inner(player_id)`));
 if(run?.agent_id&&!(await timer.step('agent-query',()=>querySuspectAgent(run.agent_id!))).running)throw new GameError('AGENT_NOT_READY',409);
 return projectSnapshot(await timer.step('session-ready',()=>rpc<Snapshot>('session_ready',{p_player:playerId,p_session:sessionId,p_agent:run?.agent_id??null})),sessionId);
}
export async function stopVoice(playerId:string,sessionId:string){
 const stop=await lifecycle(playerId,sessionId,'stop');if(stop.agentId){await stopSuspectAgent(stop.agentId);await lifecycle(playerId,sessionId,'stopped')}
}
