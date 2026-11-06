import './only';
import { cookies } from 'next/headers';
import { env, publicKey, GameError } from './db';
import { verifyAccessToken } from './jwt';
const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/'};
type Tokens={access_token:string;refresh_token:string;expires_in:number};
type CookieJar=Pick<Awaited<ReturnType<typeof cookies>>,'get'|'set'>;
async function authFetch(path:string,body?:unknown,token?:string){
 const response=await fetch(`${env('NEXT_PUBLIC_SUPABASE_URL')}/auth/v1/${path}`,{method:body?'POST':'GET',cache:'no-store',headers:{apikey:publicKey(),'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>({}));return {response,data};
}
const writeTokens=(jar:CookieJar,tokens:Tokens)=>{jar.set('alibai-access',tokens.access_token,{...cookieOptions,maxAge:tokens.expires_in});jar.set('alibai-refresh',tokens.refresh_token,{...cookieOptions,maxAge:60*60*24*30});};
export async function setTokens(tokens:Tokens){writeTokens(await cookies(),tokens)}
export async function authenticate(request?:Request):Promise<{id:string;accessToken:string}>{
 const bearer=request?.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(bearer){const user=await verifyAccessToken(bearer);if(user)return {id:user.id,accessToken:bearer};throw new GameError('LOGIN_REQUIRED',401)}
 return authenticateCookies(await cookies());
}
export async function authenticateCookies(jar:CookieJar):Promise<{id:string;accessToken:string}>{
 const accessToken=jar.get('alibai-access')?.value;
 if(accessToken){const user=await verifyAccessToken(accessToken);if(user)return {id:user.id,accessToken}}
 const refresh=jar.get('alibai-refresh')?.value;
 if(refresh){const {response,data}=await authFetch('token?grant_type=refresh_token',{refresh_token:refresh});if(response.ok&&!data.user?.is_anonymous){writeTokens(jar,data);return {id:data.user.id,accessToken:data.access_token}}}
 throw new GameError('LOGIN_REQUIRED',401);
}
export async function login(email:string,password:string){const {response,data}=await authFetch('token?grant_type=password',{email,password});if(!response.ok)throw new GameError('INVALID_LOGIN',401);await setTokens(data);return {authenticated:true};}
export async function signup(email:string,password:string){const {response,data}=await authFetch('signup',{email,password});if(!response.ok)throw new GameError('SIGNUP_FAILED',400);if(data.access_token){await setTokens(data);return {authenticated:true}}return {authenticated:false,confirmationRequired:true};}
export async function logout(){const jar=await cookies();const token=jar.get('alibai-access')?.value;try{if(token)await authFetch('logout',{},token)}catch{console.error('Supabase logout failed; clearing local session')}jar.delete('alibai-access');jar.delete('alibai-refresh');return {authenticated:false};}
export function checkOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==env('APP_ORIGIN'))throw new GameError('INVALID_ORIGIN',403);}
