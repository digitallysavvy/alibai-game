import { rpc } from '@/lib/server/db';
import { handle } from '@/lib/server/http';
export const runtime='nodejs';
// Public and the same for everyone: the CDN may share it. Errors carry no cache header.
// Takes no request, so a query string only changes the CDN key, never the response.
export async function GET(){return handle(()=>rpc('read_leaderboard',{}),'s-maxage=5, stale-while-revalidate=5')}
