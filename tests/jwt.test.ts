import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { authenticate, authenticateCookies } from '../lib/server/auth';
import { GameError } from '../lib/server/db';
import { verifyAccessToken } from '../lib/server/jwt';

// No network: JWKS and the Auth API land in this stub, on a fresh host per test so that each
// test starts with an empty key cache.
const realFetch = globalThis.fetch;
const playerId = randomUUID();
let host: string, issuer: string, jwks: { keys: JWK[] } | null, jwksCalls: number, authCalls: string[], refreshBody: unknown;
const pair = async (kid: string) => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  return { privateKey, jwk: { ...await exportJWK(publicKey), kid, alg: 'ES256', use: 'sig' } as JWK, kid };
};
type Key = { privateKey: CryptoKey; kid: string };
const sign = (key: Key, claims: Record<string, unknown> = {}, edit: (jwt: SignJWT) => SignJWT = jwt => jwt) => edit(new SignJWT({ is_anonymous: false, role: 'authenticated', ...claims })
  .setProtectedHeader({ alg: 'ES256', kid: key.kid }).setSubject(playerId).setIssuer(issuer).setAudience('authenticated').setIssuedAt().setExpirationTime('1h')).sign(key.privateKey);

beforeEach(() => {
  host = `${randomUUID()}.supabase.invalid`; issuer = `https://${host}/auth/v1`;
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: `https://${host}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test' });
  jwks = null; jwksCalls = 0; authCalls = []; refreshBody = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/.well-known/jwks.json') {
      jwksCalls += 1;
      return jwks ? Response.json(jwks) : new Response('down', { status: 503 });
    }
    authCalls.push(url.pathname);
    return Response.json(refreshBody ?? {}, { status: refreshBody ? 200 : 400 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });
const unavailable = (error: unknown) => error instanceof GameError && error.code === 'AUTH_UNAVAILABLE' && error.status === 503;
const loginRequired = (error: unknown) => error instanceof GameError && error.code === 'LOGIN_REQUIRED' && error.status === 401;
const jar = (values: Record<string, string>) => {
  const written: Record<string, string> = {};
  return { written, get: (name: string) => (values[name] ? { name, value: values[name] } : undefined), set: (name: string, value: string) => { written[name] = value; } } as never as Parameters<typeof authenticateCookies>[0] & { written: Record<string, string> };
};

test('a valid token verifies with one JWKS fetch and no call to Supabase Auth', async () => {
  const key = await pair('a'); jwks = { keys: [key.jwk] };
  const token = await sign(key);
  for (let i = 0; i < 5; i++) assert.deepEqual(await verifyAccessToken(token), { id: playerId });
  assert.equal(jwksCalls, 1); assert.deepEqual(authCalls, []);
});
test('bad signature, wrong issuer, wrong audience, expired, anonymous and missing claims are rejected', async () => {
  const key = await pair('a'), forger = await pair('a'); jwks = { keys: [key.jwk] };
  const bad = {
    forgedSignature: await sign(forger),
    wrongIssuer: await sign(key, {}, jwt => jwt.setIssuer('https://other.supabase.invalid/auth/v1')),
    wrongAudience: await sign(key, {}, jwt => jwt.setAudience('anon')),
    expired: await sign(key, {}, jwt => jwt.setExpirationTime(Math.floor(Date.now() / 1000) - 5)),
    anonymous: await sign(key, { is_anonymous: true }),
    notAUuidSubject: await sign(key, {}, jwt => jwt.setSubject('service')),
    noExpiry: await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'a' }).setSubject(playerId).setIssuer(issuer).setAudience('authenticated').sign(key.privateKey),
    noSubject: await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'a' }).setIssuer(issuer).setAudience('authenticated').setExpirationTime('1h').sign(key.privateKey),
    noKid: await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(playerId).setIssuer(issuer).setAudience('authenticated').setExpirationTime('1h').sign(key.privateKey),
    hs256: await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'a' }).setSubject(playerId).setIssuer(issuer).setAudience('authenticated').setExpirationTime('1h').sign(new Uint8Array(32)),
    unsigned: `${Buffer.from('{"alg":"none","kid":"a"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: playerId, iss: issuer, aud: 'authenticated', exp: 9999999999 })).toString('base64url')}.`,
    garbage: 'not.a.jwt',
  };
  for (const [name, token] of Object.entries(bad)) assert.equal(await verifyAccessToken(token), null, name);
});
test('a kid that appears inside the cooldown is rejected without a fetch', async () => {
  const oldKey = await pair('old'), newKey = await pair('new'); jwks = { keys: [oldKey.jwk] };
  assert.ok(await verifyAccessToken(await sign(oldKey)));
  jwks = { keys: [oldKey.jwk, newKey.jwk] };
  assert.equal(await verifyAccessToken(await sign(newKey)), null); assert.equal(jwksCalls, 1);
});
test('rotation: after the cooldown a new kid loads, and random kids cannot hammer JWKS', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const oldKey = await pair('old'), newKey = await pair('new'), stranger = await pair('stranger'); jwks = { keys: [oldKey.jwk] };
  assert.ok(await verifyAccessToken(await sign(oldKey)));
  jwks = { keys: [oldKey.jwk, newKey.jwk] };
  t.mock.timers.tick(31_000);
  assert.ok(await verifyAccessToken(await sign(newKey))); assert.equal(jwksCalls, 2);
  for (let i = 0; i < 20; i++) assert.equal(await verifyAccessToken(await sign(stranger)), null);
  assert.equal(jwksCalls, 2);
  t.mock.timers.tick(31_000);
  assert.equal(await verifyAccessToken(await sign(stranger)), null); assert.equal(jwksCalls, 3);
});
test('JWKS down on a cold instance fails closed as 503, and recovers without waiting', async () => {
  const key = await pair('a'), token = await sign(key);
  await assert.rejects(verifyAccessToken(token), unavailable);
  await assert.rejects(authenticate(new Request('https://x.invalid', { headers: { authorization: `Bearer ${token}` } })), unavailable);
  jwks = { keys: [key.jwk] };
  assert.ok(await verifyAccessToken(token));
});
test('JWKS down with cached keys keeps known kids for an hour, and never accepts an unknown kid', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const key = await pair('a'), rotated = await pair('b'); jwks = { keys: [key.jwk] };
  assert.ok(await verifyAccessToken(await sign(key)));
  jwks = null;
  t.mock.timers.tick(11 * 60_000);
  assert.ok(await verifyAccessToken(await sign(key)), 'stale key still verifies');
  t.mock.timers.tick(31_000);
  await assert.rejects(verifyAccessToken(await sign(rotated)), unavailable);
  t.mock.timers.tick(49 * 60_000);
  await assert.rejects(verifyAccessToken(await sign(key, {}, jwt => jwt.setExpirationTime('2h'))), unavailable);
});
test('a retired key stops verifying at the next periodic refresh', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const retired = await pair('a'), current = await pair('b'); jwks = { keys: [retired.jwk] };
  const token = await sign(retired, {}, jwt => jwt.setExpirationTime('2h'));
  assert.ok(await verifyAccessToken(token));
  jwks = { keys: [current.jwk] };
  t.mock.timers.tick(11 * 60_000);
  assert.equal(await verifyAccessToken(token), null);
});
test('Bearer: a valid token passes, and a bad one never falls through to cookies', async () => {
  const key = await pair('a'), forger = await pair('a'); jwks = { keys: [key.jwk] };
  const request = async (token: string) => authenticate(new Request('https://x.invalid', { headers: { authorization: `Bearer ${token}` } }));
  const token = await sign(key);
  assert.deepEqual(await request(token), { id: playerId, accessToken: token });
  await assert.rejects(request(await sign(forger)), loginRequired);
  assert.deepEqual(authCalls, []);
});
test('cookies: a valid access cookie needs no Supabase call and leaves the refresh token alone', async () => {
  const key = await pair('a'); jwks = { keys: [key.jwk] };
  const token = await sign(key), cookies = jar({ 'alibai-access': token, 'alibai-refresh': 'r1' });
  assert.deepEqual(await authenticateCookies(cookies), { id: playerId, accessToken: token });
  assert.deepEqual(authCalls, []); assert.deepEqual(cookies.written, {});
});
test('cookies: expired access still runs the refresh path and rewrites both cookies', async () => {
  const key = await pair('a'); jwks = { keys: [key.jwk] };
  const expired = await sign(key, {}, jwt => jwt.setExpirationTime(Math.floor(Date.now() / 1000) - 5));
  refreshBody = { access_token: 'next-access', refresh_token: 'next-refresh', expires_in: 3600, user: { id: playerId } };
  const cookies = jar({ 'alibai-access': expired, 'alibai-refresh': 'r1' });
  assert.deepEqual(await authenticateCookies(cookies), { id: playerId, accessToken: 'next-access' });
  assert.deepEqual(authCalls, ['/auth/v1/token']);
  assert.deepEqual(cookies.written, { 'alibai-access': 'next-access', 'alibai-refresh': 'next-refresh' });
});
test('cookies: a failed or anonymous refresh requires login, and JWKS trouble spends no refresh token', async () => {
  const key = await pair('a'), token = await sign(key);
  await assert.rejects(authenticateCookies(jar({ 'alibai-access': token, 'alibai-refresh': 'r1' })), unavailable);
  assert.deepEqual(authCalls, []);
  await assert.rejects(authenticateCookies(jar({ 'alibai-refresh': 'r1' })), loginRequired);
  refreshBody = { access_token: 'x', refresh_token: 'y', expires_in: 3600, user: { id: playerId, is_anonymous: true } };
  await assert.rejects(authenticateCookies(jar({ 'alibai-refresh': 'r1' })), loginRequired);
  await assert.rejects(authenticateCookies(jar({})), loginRequired);
});
