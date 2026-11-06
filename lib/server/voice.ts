import './only';
import { createPlayerRtcCredentials,startSuspectAgent,stopSuspectAgent,querySuspectAgent } from '../agora/server-agent';
import { buildSuspectAgentContext,loadSession,readProjection } from './game';
import { GameError,rest,rpc } from './db';
import { noTimer,type StepTimer } from './timing';
const lifecycle=(playerId:string,sessionId:string,action:string,agentId?:string)=>rpc<{claimed?:boolean;state?:string;agentId?:string}>('agent_lifecycle',{p_player:playerId,p_session:sessionId,p_action:action,...(agentId?{p_agent:agentId}:{})});
export async function startVoice(playerId:string,sessionId:string,timer:StepTimer=noTimer){
 const assigned=await timer.step('load',()=>loadSession(playerId,sessionId));
 const claim=await timer.step('claim',()=>lifecycle(playerId,sessionId,'claim'));
 if(!claim.claimed){if(claim.state==='running'&&claim.agentId)return createPlayerRtcCredentials(sessionId);throw new GameError('AGENT_START_PENDING',409)}
 let agentId:string|undefined;
 try{
  const instructions=await timer.step('context',()=>buildSuspectAgentContext(sessionId));
  const started=await timer.step('agora-start',()=>startSuspectAgent({sessionId,avatarId:assigned.session.avatar_id,voiceId:assigned.session.minimax_voice_id,instructions}));agentId=started.agentId;
  await timer.step('commit',()=>lifecycle(playerId,sessionId,'commit',agentId));
  return createPlayerRtcCredentials(sessionId);
 }catch(error){if(agentId)await stopSuspectAgent(agentId).catch(()=>{});await lifecycle(playerId,sessionId,'failed').catch(()=>{});throw error}
}
export async function readyVoice(playerId:string,sessionId:string,timer:StepTimer=noTimer){
 await timer.step('load',()=>loadSession(playerId,sessionId));
 const rows=await timer.step('agent-run',()=>rest<{agent_id:string;state:string}[]>(`agent_runs?session_id=eq.${sessionId}&select=agent_id,state`));
 if(!rows[0]?.agent_id||!(await timer.step('agent-query',()=>querySuspectAgent(rows[0].agent_id))).running)throw new GameError('AGENT_NOT_READY',409);
 await timer.step('ready',()=>lifecycle(playerId,sessionId,'ready'));return timer.step('projection',()=>readProjection(playerId,sessionId));
}
export async function stopVoice(playerId:string,sessionId:string){
 const stop=await lifecycle(playerId,sessionId,'stop');if(stop.agentId){await stopSuspectAgent(stop.agentId);await lifecycle(playerId,sessionId,'stopped')}
}
