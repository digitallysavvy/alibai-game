import { connectVoice,readyVoice,stopVoice } from '@/lib/server/voice';
import { syncProviderFacts } from '@/lib/server/provider-facts';
import { z } from 'zod';
import { authenticate,checkOrigin } from '@/lib/server/auth';
import { getNotebook,getSuggestedQuestions,readProjection,submitVerdict,transition } from '@/lib/server/game';
import { GameError,rpc } from '@/lib/server/db';
import { body,handle } from '@/lib/server/http';
import { noTimer,stepTimer } from '@/lib/server/timing';
export const runtime='nodejs';
type Context={params:Promise<{id:string;action:string}>};
export async function GET(request:Request,context:Context){return handle(async()=>{const user=await authenticate(request),{id,action}=await context.params;z.uuid().parse(id);if(action==='read')return readProjection(user.id,id);if(action==='notebook')return getNotebook(user.id,id);if(action==='questions')return getSuggestedQuestions(user.id,id,z.coerce.number().int().min(0).max(100).parse(new URL(request.url).searchParams.get('offset')??0));throw new GameError('NOT_FOUND',404)})}
export async function POST(request:Request,context:Context){const {id,action}=await context.params,timer=action==='connect'||action==='ready'?stepTimer(action):noTimer;try{return await handle(async()=>{checkOrigin(request);const user=await timer.step('auth',()=>authenticate(request));z.uuid().parse(id);if(action==='sync-facts')return syncProviderFacts(user.id,id);if(action==='connect')return connectVoice(user.id,id,timer);if(action==='ready')return readyVoice(user.id,id,timer);if(action==='start'){if(process.env.ENABLE_MANUAL_INTERVIEW!=='true')throw new GameError('MEDIA_NOT_CONFIGURED',503);return transition(user.id,id,'start')}if(action==='end'){await syncProviderFacts(user.id,id).catch(()=>{});await rpc('end_session',{p_player:user.id,p_session:id});await stopVoice(user.id,id).catch(()=>console.error('Agent stop requires cleanup retry'));return readProjection(user.id,id);}if(action==='verdict')return submitVerdict(user.id,id,await body(request));throw new GameError('NOT_FOUND',404)})}finally{timer.done()}}
