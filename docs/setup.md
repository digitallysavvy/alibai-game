# Run the integrated app

The application is in `alibai-ui/`. The parent directory's `Architecture.md` and `Design.md` describe the product; run application and Supabase commands from this directory. The existing Noir Deco UI now uses authenticated server routes instead of client-side mock case truth and scoring.

The latest product decision **requires an email/password account to play**. This supersedes the original anonymous-player requirement. The persistent Supabase user ID owns case history, sessions and scores. Login can continue the same account on another device; clearing browser storage does not reset its history. The leaderboard aggregates scores per user.

## Local setup

Use Node 22 or newer, Docker, and the Supabase CLI. The app retains its existing pnpm manifest/lockfile. These npm script examples also work when the pnpm launcher cannot download its pinned version:

```sh
cd alibai-ui
npm install
cp env.example .env.local
supabase start
supabase status
```

Copy the local Supabase URL and keys from `supabase status` into `.env.local`. Set:

- `APP_ORIGIN=http://localhost:3000`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Legacy local installations may supply `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` instead. Only the URL and publishable/anon key belong in browser configuration. Never prefix the secret/service role key, Agora certificate or provider credentials with `NEXT_PUBLIC_`.

Create the tables and cases, then start the app:

```sh
pnpm data:setup:local
pnpm dev
```

`supabase db reset` **recreates the local database** and executes `scripts/data/cases.sql`; use it only for disposable local data. To fill an already migrated database without resetting it, run `npm run scenarios:seed`. The eight cases need no model credentials. Register at `/rules`, confirm the email if requested, sign in, enter a detective name, and request a case. Local email confirmation messages appear in the email testing service reported by `supabase status`.

The scenario scripts load `.env.local` automatically. For standalone test commands, export the relevant environment variables or use the explicit `node --env-file` command below.

## Voice and manual testing

The server Agora lifecycle adapter uses the existing **testing** project, Agora-managed ARES → gpt-4o-mini → MiniMax, and Anam avatars. Follow [Agora setup](agora.md) for CLI credential binding, required Anam values, source mapping and runtime checks. The interview screen now joins RTC, publishes the microphone, receives suspect audio, and renders the Anam video track. It starts the game clock only after audio and video frames arrive. It does not simulate suspect speech or unlock clues when a hint is clicked. Live end-to-end media still needs verification.

For local development only, add this to `.env.local`:

```dotenv
ENABLE_MANUAL_INTERVIEW=true
```

The development-only `/start` API starts a real server-measured clock but does not provide voice responses; the normal interview button uses the voice APIs. Leave this variable unset in production. Without it, `/start` returns `MEDIA_NOT_CONFIGURED` and preserves the briefing. The browser uses `/agent`, connects the returned RTC credentials, waits for actual media readiness, then calls `/agent-ready`. RTM captions are a remaining integration step. An accepted agent start request is not evidence that audio is ready. Schedule `npm run agents:cleanup` every minute in a trusted worker to stop expired/disconnected agents and retry cleanup.

## Browser API

All session operations require the logged-in account. Auth is maintained in HttpOnly cookies; browser calls use same-origin credentials. Mutating requests require the configured app origin. Do not send a player ID, score, private prompt, agent ID, provider key, client timestamp or discovered fact ID from the browser.

| Route | Request / result |
| --- | --- |
| `GET /api/auth` | `{ authenticated, displayName? }` |
| `POST /api/auth` | `{ action: "signup", email, password, detectiveName? }`, `{ action: "login", email, password }`, or `{ action: "logout" }`. Signup may return `confirmationRequired`. |
| `POST /api/sessions` | `Idempotency-Key: <UUID>` header; optional `{ detectiveName }`. Returns session/case IDs and public briefing, suspect, evidence and three starting prompts. Reuse the same key for retries. |
| `GET /api/sessions/:id/read` | Session state/timestamps, public briefing, current notebook, eligible suggestions; results only after scoring. |
| `GET /api/sessions/:id/notebook` | Public evidence and genuinely discovered evidence. |
| `GET /api/sessions/:id/questions?offset=0` | Up to three eligible prompts and `more` offset, or `null`. |
| `POST /api/sessions/:id/connect` | Called once the room's view shows a session that can connect. Claims and starts the session's voice agent, then returns the view and safe connection credentials. Also renews tokens and reconnects. |
| `POST /api/sessions/:id/ready` | Called after client media readiness; checks the associated agent, starts the clock and returns the view. |
| `POST /api/sessions/:id/start` | Manual development start, enabled only by `ENABLE_MANUAL_INTERVIEW`. |
| `POST /api/sessions/:id/end` | Freeze an active clock, or abandon a cancelled startup, then request agent cleanup. |
| `POST /api/sessions/:id/sync-facts` | Fetch trusted provider history on the server and verify canonical disclosures; accepts no client transcript or fact IDs. |
| `POST /api/sessions/:id/verdict` | `{ verdict: "guilty" | "innocent", evidenceIds: string[], reasoning?: string }`. One immutable verdict; identical retries are safe. |
| `GET /api/realtime-auth` | Authenticated user's short-lived token plus public Supabase URL/key for owner-filtered Realtime subscriptions. |
| `GET /api/leaderboard` | Per-user `{ playerId, detectiveName, total, bestScore, gamesPlayed }`; no case secrets or transcripts. Cached at the CDN (`s-maxage=5, stale-while-revalidate=5`), so a new score reaches other players within about 10 seconds. The results page link and the Refresh button add a unique query parameter to skip the cache; the route ignores it. |

Example join:

```ts
const key = crypto.randomUUID() // retain this key until this request succeeds
const response = await fetch('/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ detectiveName: 'Detective Vale' }),
})
const briefing = await response.json()
```

The UI subscribes to `session_updates` with a `session_id` filter and refreshes its safe projection after an event. RLS restricts this subscription to the session owner. Public/hidden evidence are physically separated. Browser roles cannot read the complete dossier, answer key, undiscovered evidence, private question conditions or generation logs.

Assignment never invokes a model. A per-player transaction lock serializes retries; scenario allocation uses `SKIP LOCKED` and five-minute leases. Another player's leased scenario is temporarily unavailable, keeping concurrent joins distinct while inventory permits. Leases expire rather than locking stock forever. History still prevents the same player receiving a previous case. `POOL_BUSY` means unused cases are temporarily reserved; `POOL_EXHAUSTED` means that account has played the available published pool. Neither response silently repeats a case. Refill/retire inventory through the [scenario workflow](scenarios.md).

## Trusted voice integration

`lib/server/game.ts` exposes `buildSuspectAgentContext(scenario)`, `recordTranscriptTurn(sessionId, turn)` and `recordFactRevealed(sessionId, factId, turnId, evidenceSource)` for trusted server integrations only. There is no browser endpoint for reading the context or awarding discoveries.

A provider bridge must authenticate its events, correlate the stored session/agent, store an actually delivered suspect transcript turn, then request the corresponding fact revelation. The MVP deliberately requires the complete canonical disclosure sentence, not an arbitrary substring or model assertion. Facts outside the active time window, detective utterances, unknown references and duplicate scoring claims are rejected. This constrains the agent's disclosure output, not the wording a player must use. The browser triggers a server-side provider-history sync every five seconds while connected and before ending. That adapter reads managed assistant history from the persisted agent and accepts only canonical complete utterances. Managed history proves generated output, not that each utterance finished playing; per-turn audio-delivery verification remains a limitation.

## Checks and current verification limits

```sh
npm test
npm run scenarios:validate
npm run lint
npm run typecheck
npm run build
# Disposable local Supabase only; creates test accounts and records:
RUN_DB_TESTS=1 node --env-file=.env.local --import tsx --test tests/db.test.ts
```

At the latest check, 18 unit tests, fixture validation, full TypeScript checking and the configured backend lint scope passed. Local dependency links were used where normal installation was blocked; replace these with a normal package installation before treating the checkout as deployable. The production build did not pass: Google Fonts could not be downloaded. An earlier build also rejected temporary external dependency links; those packages were subsequently copied locally and that error cleared.

The three migrations and eight fixtures were applied to hosted Alibai (`vfqxxkvokbgrooxhkdmi`) through Supabase MCP. Its bounded rollback smoke passed 23 checks, including actual authenticated-role RLS denial and deterministic scoring. Docker access was denied, so the separate simultaneous multi-connection database tests remain unexecuted; the hosted distinct-allocation check was sequential within one transaction. Agora CLI DNS/config access prevented credential binding and live project checks. Scenario model calls, agent start/stop, Anam video, audio roundtrips and a timed human playtest remain unverified. These are environment/integration gaps, not passing tests. See [scenario test coverage](scenarios.md#test-coverage-and-limits) and [Agora runtime status](agora.md#runtime-status).

The prepared `scripts/data/install.sql` is an alternative SQL Editor installation path for a new schema, with collision checks and a transaction. Run `preflight.sql` first and `postflight.sql` afterward. It does not populate the Supabase CLI migration ledger; reconcile migration history before subsequently using CLI push on that same database. The hosted Alibai database now has these migrations and fixture records; do not run the fresh-install bundle against it again. Reconcile the hosted migration ledger with the local filenames before later CLI pushes.
