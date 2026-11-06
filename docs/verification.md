# Implementation verification

Commands run from `alibai-ui` unless noted. On 2026-11-04 the three migrations were applied to the hosted **Alibai** project (`vfqxxkvokbgrooxhkdmi`) through Supabase MCP and eight validated fixtures were seeded. The rollback smoke test passed 23 database checks. Live voice verification is still not claimed.

| Command | Outcome |
| --- | --- |
| `node --import tsx --test tests/unit.test.ts` | 18 unit tests passed after avatar/voice integration |
| `npm run typecheck` | Passed full application TypeScript check |
| `npm run lint` | Passed configured scenario/server/scripts/tests/API lint scope |
| `npm run scenarios:validate` | All 8 authored fixtures and 8 dry-run copies validated |
| `npm run scenarios:generate -- --fixtures --count 8 --dry-run` | 8 accepted, 0 failed; no model/API publication |
| `pnpm data:build` | Generated eight-case SQL seed |
| `pnpm data:build` | Generated guarded installation, preflight and postflight SQL |
| `npm run test:db` | One DB suite explicitly skipped; no local database configuration |
| `npm run build` | Failed fetching the existing Google Fonts over restricted network |
| `node --check scripts/agora-setup.mjs` | Passed |
| `agora version`, `which -a agora`, `agora doctor --json` | CLI 0.2.10 found; DNS/config-directory restrictions block readiness |
| `agora project env write .env.local --project testing --template nextjs --json` | Failed OAuth DNS; no credentials exported |
| `supabase whoami --output json` | CLI access token unavailable; hosted application subsequently used connected Supabase MCP |
| Supabase MCP: three `apply_migration` calls and fixture seed | Applied successfully to `vfqxxkvokbgrooxhkdmi`; 8 fixtures published |
| Supabase MCP: `supabase/hosted-smoke.sql` | 23 checks passed; synthetic users, sessions, history, scores and leases rolled back |
| `docker info --format '{{.ServerVersion}}'` | Docker socket access denied |

`pnpm lint`, `pnpm build` and the subsequent pnpm check chain were attempted but this environment's pnpm wrapper initiated dependency downloads that failed DNS; those attempts were interrupted. Equivalent npm scripts then ran against available local dependencies. Offline npm/pnpm installation and lockfile refresh also encountered uncached dependencies. The manifest pins newly introduced security/runtime packages, but run a normal dependency install and refresh the lockfile before deploying. Temporary local package copies/links are not a replacement for a clean installation.

The DB suite is provided for a disposable local Supabase. It covers assignment concurrency, same/different-key retries, post-verdict idempotency, exhaustion, browser-role secret/RPC access, verified disclosures, hidden-evidence rejection and SQL/TypeScript scoring parity. Its actual simultaneous multi-connection checks remain unexecuted because Docker/local Supabase is unavailable. The hosted rollback smoke below supplements it; it does not replace that concurrency test.

## Hosted database smoke coverage

`supabase/hosted-smoke.sql` ran against the real hosted database in one bounded transaction and returned **23 passed checks**, then rolled back every synthetic change. It verified all app tables have RLS, private-table browser grants are absent, actual `authenticated`-role secret/catalog/RPC access is denied, cross-player session reads are blocked, two players receive distinct leased cases, assignment/history and retry keys remain idempotent after scoring, casting/voice snapshots are immutable, briefing/hidden-evidence verdicts are rejected, detective speech cannot award facts, verified suspect disclosures deduplicate, clue projections omit private fields, scoring matches the 1,000-point rubric, verdicts lock, subsequent cases/avatars vary without changing truth, and exhausted users receive no repeats.

The two-player allocation check was **sequential within one transaction**. It proves lease-based selection chooses different cases, but does **not** prove behavior under simultaneous independent database transactions. The supplied local `tests/db.test.ts` retains that concurrent test and is still an execution gap. No real users, sessions or scores were deleted or reset by the hosted smoke.

## Remaining runtime verification

The browser RTC/avatar wiring and server lifecycle APIs are present. Authenticated ingestion of genuinely delivered provider transcripts, the cleanup worker in operation, and a timed human playtest remain to be verified. No live ARES/LLM/MiniMax/Anam roundtrip has been proven. Manual interview mode is explicitly opt-in and does not simulate fact discoveries. The host's applied migration identifiers may differ from local file timestamps; reconcile history before a later CLI migration push, rather than reapplying the initial schema.
