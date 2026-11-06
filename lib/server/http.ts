import { z } from 'zod';
import { GameError } from './db';
export async function handle(work:()=>Promise<unknown>,cacheControl='no-store'){try{return Response.json(await work(),{headers:{'Cache-Control':cacheControl}})}catch(error){if(error instanceof GameError)return Response.json({error:error.code},{status:error.status});if(error instanceof z.ZodError)return Response.json({error:'INVALID_REQUEST'},{status:400});console.error('Game request failed',error instanceof Error?error.name:'UnknownError');return Response.json({error:'SERVICE_UNAVAILABLE'},{status:503});}}
export async function body(request:Request){const text=await request.text();if(text.length>16000)throw new GameError('REQUEST_TOO_LARGE',413);try{return JSON.parse(text)}catch{throw new GameError('INVALID_JSON')}}
