# Alibai: agent guide

"Interrogate the Agent" is a voice detective game. A player signs in, gets a fictional case and one suspect, questions a live AI avatar for three minutes, then files a guilty or innocent verdict backed by evidence. The server scores it out of 1,000.

A lie doesn't prove guilt: innocent suspects may hide something unrelated to the crime.

Check facts about live systems before relying on them. Status notes here can go stale.

## For judges

**The pitch:** most AI characters improvise, so you can't fairly win or lose against them. Alibai gives each suspect a fixed, validated case file. The AI performs the character, and trusted server code decides what was discovered and what the score is. The model can't change the truth or award points.

**Try it**

1. Open https://alibai-game.vercel.app/rules on a laptop or phone with a microphone. Chrome is the safest choice.
2. Sign in with Google, enter a detective name, and test your microphone.
3. Assign a case, read the briefing, and enter the interrogation room. The interview connects by itself, and the clock starts only once the suspect's audio and video are playing.
4. Question the suspect aloud for up to three minutes. The notebook lists leads to say aloud: a lead is marked asked when your captions match it, and answered, with the suspect's words beneath it, once the server records the fact. Tapping one only highlights it; nothing is sent.
5. End the interview, choose guilty or innocent, and cite evidence.
6. See the truth, your score and any missed clues, then check the leaderboard.

**What to look at**

| Area | Where | Why it matters |
| --- | --- | --- |
| Live voice and video | `lib/agora/`, `components/game/production-session.tsx` | Real-time AI suspect, with the clock gated on real media readiness |
| Hidden answers stay hidden | `supabase/migrations/`, `lib/scenarios/schema.ts`, `leads()` in `lib/scenarios/engine.ts` | Private truth lives in server-only tables, and browsers get allowlisted fields only: a lead carries a recorded fact's statement and nothing about an undiscovered one |
| Verifiable discovery | `lib/server/provider-facts.ts`, `session_action` in SQL | Facts count only when server-side checks pass, never from a browser claim |
| Case quality | `lib/scenarios/validate.ts`, `lib/scenarios/cases/`, `docs/writing-cases.md` | Timelines, access, clue reachability and answer keys are checked before publishing, and public text is checked for guilt tells across the whole set |
| Fair assignment | `assign_scenario` in SQL | Atomic, idempotent, no repeats per player, with guilt never chosen at random at join time |

**Data model:** mysteries are pre-generated into `scenarios`, `suspects`, `evidence` and `suggested_questions`, with hidden truth and undiscovered evidence in separate server-only tables. The starting inventory is eight hand-authored cases, four guilty and four innocent, plus a catalog of 14 Anam avatars. `players` and `game_sessions` track accounts and assignments, while `session_events` keeps every suspect reply seen by the server, and `session_facts` and `session_clues` record validated discoveries. `verdicts` hold player input, and `scores` are calculated on the server for the leaderboard. There are 21 tables, all with RLS.

**Data quality:**

- Every case passes a strict Zod schema and deterministic checks on evidence references, timeline consistency, clue reachability, answer-key agreement and public/private separation.
- Foreign keys, unique constraints, content fingerprints and atomic assignment prevent broken links, duplicate cases and repeat assignments.
- Idempotent discovery and verdict handling prevent double scoring.
- Sodabase is linked to this project, but monitors were not yet enabled at the last check, because its read-only role had access to none of the app tables.

**Evidence so far:**

- 20 automated unit tests pass, along with typecheck, lint, and a production build.
- 23 hosted database smoke checks passed before the latest recovery migration. They covered privacy, ownership, scoring and pool exhaustion.
- 19 recovery-migration checks passed on embedded Postgres, using a throwaway script that isn't in this repo.
- Production endpoints respond, and cross-origin POSTs are rejected with 403.
- Not yet shown: a full live voice session, a completed production Google sign-in, or simultaneous joins on the hosted database.

**Limits worth knowing:** see "Known gaps" below. The largest is that a fact only counts when the suspect uses one of its spoken lines, so a paraphrase earns nothing. How often that happens is unproven until live games are played.

## Links

| What | Where |
| --- | --- |
| Production | https://alibai-game.vercel.app/ |
| GitHub | `digitallysavvy/alibai-game` |
| Vercel | project `alibai-ui`, team scope `digitallysavvys-projects`, functions in `pdx1` next to Supabase (`vercel.json`). Pushing to `main` deploys production |
| Supabase | project **Alibai**, ref `vfqxxkvokbgrooxhkdmi` |
| Agora | project **testing** |
| Sodabase | https://sodabase.io/projects/vfqxxkvokbgrooxhkdmi |

Product specs sit in the parent workspace folder, outside this repo: `Architecture.md`, `Design.md`, `Game-Rules.md`, `HANDOFF.md`. The Agora skill is at `.agents/skills/agora/`. Where they disagree with the code, trust the code and `docs/agora.md`. The specs still mention Gradium and anonymous players, and neither is used now.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn-style components on Base UI. This Next.js may differ from what you remember, so check `node_modules/next/dist/docs/` before relying on an API.
- Supabase: Postgres, Auth, Realtime.
- Agora Conversational AI: ARES speech-to-text, `gpt-4o-mini`, MiniMax `speech_2_6_turbo` voices, Anam avatars. Packages: `agora-agents`, `agora-token`, `agora-rtc-sdk-ng`.
- Zod for validation. Tests use `node:test` through `tsx`.

## Commands

Use **pnpm**. `package-lock.json` also exists but isn't the source of truth.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm lint                  # only covers lib/scenarios lib/server scripts tests app/api
pnpm test                  # unit and provider-facts tests
pnpm test:db               # needs a disposable local Supabase; refuses remote hosts
pnpm scenarios:validate
pnpm build --webpack       # no `--` separator: `pnpm build -- --webpack` fails
pnpm agents:cleanup        # one sweep
pnpm agents:cleanup:watch  # sweeps every minute
pnpm data:build                                      # regenerates scripts/data from migrations and cases
pnpm data:setup                                      # applies migrations and cases to the linked Supabase project
```

## Layout

```text
app/                      pages and API routes
  api/sessions/[id]/[action]/   read, notebook, questions (unused by the UI), agent, agent-ready,
                                sync-facts, end, verdict, start (dev only)
  api/auth, api/auth/google, auth/callback
components/game/          game UI; production-session.tsx is the main screen
lib/server/               server-only: auth, DB, game projections, voice, fact sync
lib/agora/                server-agent.ts (server), use-suspect-voice.ts (browser)
lib/scenarios/            case schema, validation, generation, engine
lib/scenarios/cases/      one file per handcrafted case
scripts/data/             generated setup SQL and how to use it
lib/game/                 browser API client, avatar and voice catalogs
scripts/                  scenario CLIs and the agent cleanup worker
supabase/migrations/      schema source of truth
tests/                    unit.test.ts, provider-facts.test.ts, db.test.ts
```

`lib/game/types.ts` and these components are v0 leftovers that nothing renders: `voice-controls`, `interrogation-timer`, `live-transcript`, `voice-waveform`.

## How a game runs

Session states: `created → preparing → active → ended → scored`, or `abandoned` if the clock never started.

1. `POST /api/sessions` runs `assign_scenario`. That picks an unplayed case and freezes one avatar and one voice on the session.
2. The player reads the briefing and enters the room, which connects automatically.
3. `POST .../agent` claims the run and starts the agent with server-built instructions. It returns RTC credentials.
4. The browser publishes the mic. Once suspect audio **and** video decode, the suspect shows and `POST .../agent-ready` starts the clock. A start acknowledgement alone never starts it.
5. Every 5 seconds, `sync-facts` reads provider history on the server and records verified facts, which unlock evidence and follow-up leads. `leads()` marks a lead answered once a fact in its `revealsFactIds` is recorded; a recorded fact no lead on the page lists comes back as an admission.
6. `POST .../end` runs a final sync, ends the session, and stops the agent.
7. `POST .../verdict` accepts one verdict. SQL calculates the score.

Scoring: verdict 500, pivotal evidence 300, facts 150, time 50. Evidence points need the right verdict, each citation that isn't pivotal cancels one that is, and no facts means no time bonus. `session_action` in SQL is authoritative. `score()` in `lib/scenarios/engine.ts` is a JS copy used by tests, so keep them in step.

## Rules to keep

- Secrets stay on the server. Never send truth, answer keys, unlock conditions or undiscovered evidence to the browser. Public shapes come from `publicEvidenceDTO`, `questionDTO`, `briefing` and `notebook`.
- Browsers can't award facts. No client request may carry a transcript, fact ID or score. Live captions are display only: `lib/game/lead-matching.ts` reads finished player captions to mark a notebook lead as asked, in the browser, and that mark goes nowhere.
- The server owns time. Browser timers are for display, and the countdown is corrected with `serverTime`. The tick lives in `session-clock.tsx`, so it doesn't re-render the session.
- Every client-reachable table has RLS. Game RPCs are service-role only. Don't add broad grants to make something work.
- Guilt is fixed per case. Scenario content and session casting are immutable, enforced by triggers.
- Avatars are cast performers. Their studio names and personas never replace the dossier's suspect. Use `avatarId`, not `personaId`.
- Add new migrations. Never edit one that has been applied, and never reset the hosted database.
- After changing migrations or cases, run `pnpm data:build`. A unit test fails if `scripts/data` is stale. Only use `install.sql` on an empty schema.

## Environment

Names only. Never print, commit or overwrite real values, and **never overwrite `.env.local`**. `vercel link` can write `.env.local`, so don't run it in this repo.

```text
APP_ORIGIN
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_AGORA_APP_ID
NEXT_AGORA_APP_CERTIFICATE
ANAM_API_KEY
```

- `APP_ORIGIN` must match the site origin exactly. It drives the origin check on POSTs and the OAuth redirect.
- These seven are set for Vercel **Production only**, so preview deployments build but their APIs fail.
- `ENABLE_MANUAL_INTERVIEW` stays `false` outside development.
- Optional scenario generation uses `SCENARIO_LLM_*` and `SCENARIO_REVIEW_LLM_*`.

## Sign-in

The UI is Google-only, using Supabase OAuth with PKCE through `/api/auth/google` and `/auth/callback`. Tokens live in HttpOnly cookies. The password actions remain in `/api/auth` but have no UI.

If Google sends people to localhost, the app isn't the cause. Fix **Site URL** and **Redirect URLs** in Supabase. Google's redirect URI should stay `https://vfqxxkvokbgrooxhkdmi.supabase.co/auth/v1/callback`.

## Deployment status

- Check the hosted migration list before applying anything. `20261105170000_disclosure_and_scoring.sql` and the 16 cases must be applied together, migration first.
- Hosted migration versions differ from local filenames because they were applied through MCP. Reconcile them before any `supabase db push`.
- Nothing schedules the cleanup worker. It needs a long-running host, and Vercel's Hobby plan isn't suitable. Agents do expire on their own after 5 minutes.

## Not yet verified

No one has confirmed these working end to end: a live Agora and Anam session, a completed production Google sign-in, Realtime delivery in production, a full human playtest, `pnpm test:db`, or the voice mappings by ear.

## Known gaps

- Fact discovery needs the suspect to use a fact's spoken line in a plain sentence. Punctuation, contractions and lead-ins are fine, but a paraphrase earns no credit. Facts are locked behind this to keep scoring trustworthy.
- `buildSuspectAgentContext` sends the full case truth to the model, so a player could coax out the answer.
- Ending the interview at once earns most of the time bonus.
- Players hit `POOL_EXHAUSTED` after all 8 cases. Allowing replays would invite leaderboard farming.
- Agent `idleTimeout` is 30 seconds, so reconnecting after a long drop may fail.
- Calling `agent` on a session started through the dev-only `/start` path resets its clock.
- There's no recording notice yet, detective turns aren't stored, and `/admin` is a placeholder.
- The landing page shows a hard-coded case number.
- `docs/setup.md` and `docs/verification.md` predate Google sign-in and the latest migrations.

## Working here

- Branch from `origin/main` and use worktrees for parallel work. Merge through PRs.
- Keep temporary files inside the workspace, not `/tmp`.
- `next dev` can generate an `AGENTS.md` block and change `next-env.d.ts`. Don't commit unrelated changes from it.
- Report what you tested. A passing build doesn't prove live voice works.
