import './only';
import { createLocalJWKSet, decodeProtectedHeader, errors, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { env, GameError, publicKey } from './db';

// Supabase access tokens are ES256 JWTs, so every request can be checked here without a call
// to Supabase Auth. The trade-off: a token revoked by logout or a ban works until `exp`
// (jwt_expiry, one hour), because revocation is only known to Supabase. Refresh tokens are
// still checked by Supabase, and session ownership is still enforced in SQL by p_player.
const FRESH_MS = 10 * 60_000; // Picks up retired keys without waiting for an unknown kid.
const STALE_LIMIT_MS = 60 * 60_000; // Longest a cached key is trusted while JWKS is unreachable.
const UNKNOWN_KID_COOLDOWN_MS = 30_000; // Random kids can't turn into a stream of JWKS fetches.
const FETCH_TIMEOUT_MS = 3000;

type Lookup = ReturnType<typeof createLocalJWKSet>;
interface Store { keys?: { lookup: Lookup; kids: Set<string>; fetchedAt: number }; attemptedAt: number; lastFailed: boolean; refreshing?: Promise<void> }
const stores = new Map<string, Store>();

async function refresh(store: Store, issuer: string) {
  store.attemptedAt = Date.now();
  try {
    const response = await fetch(`${issuer}/.well-known/jwks.json`, { cache: 'no-store', headers: { apikey: publicKey() }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`JWKS responded ${response.status}`);
    const jwks = await response.json() as JSONWebKeySet;
    store.keys = { lookup: createLocalJWKSet(jwks), kids: new Set(jwks.keys.flatMap(key => key.kid ? [key.kid] : [])), fetchedAt: Date.now() };
    store.lastFailed = false;
  } catch (error) {
    store.lastFailed = true;
    console.error('JWKS refresh failed', error instanceof Error ? error.name : 'UnknownError');
  }
}

/** Returns the key lookup, or null when the signing keys are known and this kid isn't one of them. */
async function lookupFor(issuer: string, kid: string) {
  let store = stores.get(issuer);
  if (!store) { store = { attemptedAt: 0, lastFailed: false }; stores.set(issuer, store); }
  const now = Date.now(), held = store.keys;
  const wanted = !held || now - held.fetchedAt > FRESH_MS || !held.kids.has(kid);
  // A cold instance always tries. One holding keys waits out the cooldown between attempts.
  if (wanted && (!held || now - store.attemptedAt >= UNKNOWN_KID_COOLDOWN_MS)) {
    store.refreshing ??= refresh(store, issuer).finally(() => { store.refreshing = undefined; });
    await store.refreshing;
  }
  const keys = store.keys;
  // Fail closed, as "try again" rather than "signed out": a 503 keeps the player's cookies and
  // doesn't spend their refresh token, and no token is accepted without a checked signature.
  if (!keys || Date.now() - keys.fetchedAt > STALE_LIMIT_MS) throw new GameError('AUTH_UNAVAILABLE', 503);
  if (keys.kids.has(kid)) return keys.lookup;
  // A kid we can't place while JWKS is failing may be a rotated key, so it can't be called invalid.
  if (store.lastFailed) throw new GameError('AUTH_UNAVAILABLE', 503);
  return null;
}

/** The player for a verified token, or null if it is invalid. Throws 503 if keys are unavailable. */
export async function verifyAccessToken(token: string): Promise<{ id: string } | null> {
  const issuer = `${env('NEXT_PUBLIC_SUPABASE_URL')}/auth/v1`;
  let kid: unknown;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'ES256') return null;
    kid = header.kid;
  } catch { return null; }
  if (typeof kid !== 'string') return null;
  const lookup = await lookupFor(issuer, kid);
  if (!lookup) return null;
  try {
    const { payload } = await jwtVerify(token, lookup, { issuer, audience: 'authenticated', algorithms: ['ES256'], requiredClaims: ['sub', 'exp'] });
    const id = z.uuid().safeParse(payload.sub);
    return id.success && payload.is_anonymous !== true ? { id: id.data } : null;
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}
