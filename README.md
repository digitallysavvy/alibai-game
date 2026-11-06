# Alibai

**Everyone has a story. Not everyone is telling the truth.**

Alibai is a voice detective game. You get a fictional case and one suspect, then question a live AI avatar out loud for three minutes. When time's up, you decide whether they're guilty or innocent and back it up with evidence.

Play it at **[alibai-game.vercel.app](https://alibai-game.vercel.app/)**. You'll need a Google account and a microphone.

## How to play

1. **Read the case.** Study the briefing, the suspect and the evidence on file. The clock hasn't started.
2. **Question the suspect.** The interview connects on its own, and your three minutes begin once you can see and hear them. Ask whatever you like. Suggested questions are only hints, and tapping one sends nothing.
3. **Watch the notebook.** Evidence appears as the suspect gives up facts, and a live transcript runs alongside it.
4. **File your verdict.** Pick guilty or innocent and cite the evidence that convinced you. It's final.
5. **See the truth.** Find out what happened, what you missed and where you landed on the leaderboard.

A lie doesn't prove guilt, and a clean story doesn't prove innocence. Guilty suspects lie about the crime, and innocent ones can be hiding something embarrassing that has nothing to do with it. The file alone won't settle a case, so you'll have to ask.

| Scoring | Points |
| --- | ---: |
| Correct verdict | 500 |
| Pivotal evidence cited | 300 |
| Facts uncovered | 150 |
| Time left when the interview ended | 50 |
| **Total** | **1,000** |

Evidence only counts with the right verdict, and a citation that doesn't hold up cancels one that does. Finish without finding a single fact and there's no time bonus.

## Why it's built this way

Most AI characters improvise, which makes them impossible to beat fairly: the answer can shift mid-conversation. In Alibai, the case is fixed before you join and the AI only plays the part.

- **The truth is locked.** Each case is validated and immutable. Guilt never changes during a game, and the actor playing the suspect has no bearing on it.
- **Answers stay on the server.** Private case data lives in tables the browser can't reach, and the browser only receives allowlisted fields.
- **The AI doesn't keep score.** Scores are calculated in Postgres from the answer key and verified events. Neither the model nor the browser can award a point.
- **The clock is fair.** It's measured on the server and starts only once the suspect's audio and video are playing.

## Built with

| Layer | Tools |
| --- | --- |
| App | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Data and sign-in | Supabase Postgres, Row Level Security, Realtime, Auth with Google |
| Live interview | Agora Conversational AI with ARES speech-to-text, `gpt-4o-mini` and MiniMax voices |
| Avatars | Anam |
| Hosting | Vercel |

## Run it locally

You'll need Node 22 or newer, pnpm, the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), and Agora and Anam credentials.

```sh
pnpm install --frozen-lockfile
cp env.example .env.local
```

Create the tables and cases. For a hosted Supabase project:

```sh
supabase login
supabase link --project-ref <your-project-ref>
pnpm data:setup
```

Or run it locally with Docker:

```sh
supabase start
pnpm data:setup:local
```

[scripts/data](scripts/data/README.md) also covers setup without the CLI. Then run `pnpm dev`.

Fill in `.env.local` with these values, and keep it out of git:

| Variable | What it's for |
| --- | --- |
| `APP_ORIGIN` | The app's exact origin, such as `http://localhost:3000` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Supabase secret key, server only |
| `NEXT_PUBLIC_AGORA_APP_ID` | Agora app ID |
| `NEXT_AGORA_APP_CERTIFICATE` | Agora app certificate, server only |
| `ANAM_API_KEY` | Anam API key, server only |

For Google sign-in, follow [docs/google-auth.md](docs/google-auth.md). Add `http://localhost:3000/auth/callback` to your Supabase redirect URLs.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the app |
| `pnpm build --webpack` | Builds for production |
| `pnpm typecheck` | Checks types |
| `pnpm lint` | Lints the server, scenario, script, test and API code |
| `pnpm test` | Runs the unit tests |
| `pnpm test:db` | Runs database tests against a disposable local Supabase |
| `pnpm scenarios:validate` | Validates every case, and checks the set for guilt tells |
| `pnpm data:build` | Regenerates the SQL in `scripts/data` from the migrations and cases |
| `pnpm data:setup` | Applies migrations and cases to your linked Supabase project |
| `pnpm agents:cleanup:watch` | Stops expired agents, once a minute |

Run the cleanup worker alongside any deployment. Agents expire on their own after five minutes, but the worker also clears stuck sessions, and browsers can't be relied on to do it when a tab closes.

## Project layout

```text
app/                 Pages and API routes
components/game/     Game screens
lib/agora/           Agent start-up, browser media and live transcript
lib/scenarios/       Case schema, validation and generation
lib/scenarios/cases/ One file per case
lib/server/          Server-only auth, game logic, voice and fact sync
supabase/migrations/ Database schema, policies and game logic
scripts/data/        Generated setup SQL and how to use it
scripts/             Case tooling and the cleanup worker
tests/               Unit and database tests
```

## Status

Alibai began as a hackathon project and has sixteen hand-written cases. Each player can play each case once.

Some things to know:

- A fact only counts when the suspect uses one of its spoken lines. Punctuation, contractions and a lead-in are fine, but a paraphrase earns nothing, so some clues can be missed. This is the biggest known weakness.
- A guilty suspect's prompt includes what they did, so a determined player could try to coax it out. Innocent suspects aren't told who did it.
- The first live games are still being tested, so expect rough edges.

## More documentation

- [AGENTS.md](AGENTS.md): full project guide, architecture rules and known gaps
- [docs/agora.md](docs/agora.md): voice and avatar pipeline
- [docs/google-auth.md](docs/google-auth.md): Google sign-in setup
- [docs/writing-cases.md](docs/writing-cases.md): how to write a case that's fair and hard to call
- [docs/scenarios.md](docs/scenarios.md): validating and publishing cases
- [docs/setup.md](docs/setup.md) and [docs/verification.md](docs/verification.md): earlier setup and test notes, which predate Google sign-in
