# Scenario authoring and pool operations

The handcrafted cases in `lib/scenarios/cases/` are an offline starting pool, not randomly reskinned stories. They cover theft, diversion, contamination and mechanical sabotage in eight fictional venues. Four suspects are guilty and four are innocent. Guilty suspects hold a false claim that a record can catch; innocent suspects may hide something unrelated, and at least one hides nothing. `validateCaseSet` fails if a public word or case shape splits on guilt. Every case has an executable path plus optional followups, and exactly one pivotal item is public. Everything a player or suspect reads is authored per case. See [writing-cases.md](writing-cases.md).

Run from `alibai-ui`:

```sh
pnpm scenarios:validate
pnpm data:build
# Start/reset local Supabase using its CLI; db reset executes scripts/data/cases.sql.
pnpm scenarios:generate --fixtures --count 8 --dry-run
pnpm scenarios:seed
pnpm scenarios:generate --count 30 --difficulty mixed --seed 2026 --concurrency 2 --retries 3
pnpm test
RUN_DB_TESTS=1 pnpm test:db
```

The package scripts load `.env.local` automatically. Exported environment variables take precedence. Next.js also loads `.env.local` for app routes. The SQL seed script is idempotent by fingerprint; the publishing CLI intentionally reports duplicate DB fingerprints as failures rather than silently manufacturing duplicates. `--fixtures` makes no model calls. With no model configured, generation falls back to the finite handcrafted pool. A request larger than the matching fixture inventory fails explicitly. Seeds select reproducible fixture cases; model seeds and prompts provide reproducible job provenance, not guaranteed identical provider output.

## Environment

Publishing uses `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) on the server only. Unit tests need no database. Database tests require a disposable local Supabase, those variables, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), and `RUN_DB_TESTS=1`. They create real email test users, seed missing fixtures, reset allocation leases, and retain records for inspection; reset the local database afterward. Remote database URLs are refused.

Optional author transport:

- `SCENARIO_LLM_URL`: full HTTPS chat-completions endpoint supporting strict `response_format: json_schema`.
- `SCENARIO_LLM_API_KEY`: provider credential, never public.
- `SCENARIO_LLM_MODEL`: model identifier available from that provider.

Independent semantic reviewer uses the corresponding `SCENARIO_REVIEW_LLM_URL`, `SCENARIO_REVIEW_LLM_API_KEY`, and `SCENARIO_REVIEW_LLM_MODEL`. It has a separate editorial instruction set. It may use the same provider, but should use an independent model/request. The generic adapter does not claim compatibility with providers that lack strict JSON-schema responses.

## Validation and publishing

`generateScenario` validates strict JSON and deterministic invariants before requesting semantic review. Failures return bounded feedback to the author (default three attempts, maximum five). Review uncertainty, flagged content, and near-duplicate similarity require human review and are saved as `.review.json` drafts. Without a reviewer, generated content also remains a review draft. Handcrafted cases have already been authored and reviewed in source and can publish directly after deterministic validation.

The batch logs every failed attempt and review outcome in private `game-scenarios/generated/*.jsonl`, and records summary failures/provenance in `scenario_generation_jobs`. Keep this folder gitignored and outside `public`; it contains complete private dossiers. Dry runs validate/write local artifacts but never call the database. Do not publish a `.review.json` by renaming it: inspect and correct the source, then explicitly publish the reviewed artifact with `pnpm scenarios:publish --file path/to/draft.review.json --reviewed-by operator-name --note "Reviewed motive, clues and three-minute solvability"`. This command reruns deterministic validation and records the operator and rationale in the private job log. `--dry-run` validates without publication. The initial MVP deliberately provides no browser admin publishing endpoint.

The validator guarantees structural counts, references, verdict/culprit agreement, timeline ordering, explicit interval/access consistency, acyclic fact dependencies, satisfiable clue/question unlocks, safe starting prompts, executable pivotal-evidence paths and exact deduplication. Its text checks catch explicit or verbatim answer leaks. No deterministic parser can prove the absence of paraphrased spoilers, natural-language contradictions or real-person resemblance; independent review/human assessment addresses those. Reviewer approval never overrides deterministic failures.

The fingerprint includes normalized setting, crime, suspect role, timeline, pivotal clue text, actual event, means and motive. It excludes UUID, title and cosmetic suspect name. A unique database constraint is the final concurrent deduplication authority. Token-set similarity above 0.8 triggers review; it is a conservative warning rather than a promise of semantic equivalence.

## Schema and scoring

`schemaVersion=1` selects the contract; `version` identifies an immutable authored case revision. Content is never patched in place. Publish a new scenario UUID/version for a changed mystery, retaining the old row for historical sessions. Retire old versions from allocation; assigned sessions retain their exact dossier. Generator version and job provenance identify the authoring implementation.

The score is deterministic: correct verdict 500; `floor(300 × distinct visible pivotal citations / pivotal count)`; `floor(150 × distinct verified discovered facts / case fact count)`; `floor(50 × max(0, 180 − server elapsed seconds) / 180)`. The server freezes elapsed time when interrogation ends. A wrong verdict can still earn evidence/fact/time points. Red herrings, duplicate IDs and undiscovered evidence earn no support points. Results reveal the private explanation only after the persisted verdict locks.

Disclosure verification works on spoken text. A trusted provider stores a real suspect turn, then the reply must assert one of the fact's scripted lines. Case, punctuation, apostrophes and contractions are ignored, and a lead-in or a second fact in the same reply is fine. The server rejects a line used in a denial, question, quote or hypothetical, or retracted in the next sentence, and Postgres confirms the line is in the stored turn. Each fact needs 3–5 lines of 4–12 plain words, unique to that fact and absent from every alibi and lie.

## Test coverage and limits

Unit tests cover all fixtures, permitted innocent lies, access/time/location contradictions, explicit leaks, missing references, circular/unreachable unlocks, deduplication, private DTO exclusion, pure suggestion selection, scoring and bounded generation retries. The opt-in DB suite exercises concurrent distinct assignments, key retries, per-player history, RLS and RPC denial, duplicate fingerprints, verified discovery, one-time verdicts, SQL/TypeScript scoring parity, and exhaustion. A skipped local DB suite does not constitute concurrency validation. The hosted rollback smoke has separately passed 23 database checks; its two-player allocation check is sequential, while the true simultaneous-transaction local test remains unexecuted. Live model quality and a real three-minute human playtest remain operational checks.

## Applying the tables to an existing Supabase project

The repository includes an additive SQL Editor bundle at `scripts/data/install.sql`, generated from the migration files and the validated fixture seed. Regenerate it with `pnpm data:build` after changing migrations or fixtures.

1. Select the exact intended project in the Supabase dashboard. The SQL file does not choose a project for you.
2. Run `scripts/data/preflight.sql`. If it reports any existing app table or function, stop and adapt the migration to that schema; do not drop or replace existing tables or policies.
3. If the collision checks are empty, run `scripts/data/install.sql` in the SQL Editor. The installation is one transaction and rejects collisions before changing anything.
4. Run `scripts/data/postflight.sql`. All 21 app tables must show RLS enabled, browser execution of privileged RPCs must be false, sensitive-table SELECT privileges must be false for both browser roles, and the published handcrafted fixture count must be 8.
5. Use the local integration suite against a disposable local project for concurrency and end-to-end SQL checks; the SQL Editor read checks alone do not prove concurrency behavior.

The bundle creates no users and changes no existing Auth configuration or policies. Only owner-scoped SELECT policies are granted for player/session/clue/update records. Every game write and all private truth access require server credentials. Running the SQL Editor bundle does not automatically register versions in Supabase CLI migration history; reconcile the three applied versions before using later CLI migrations, rather than re-running the initial migrations.

Generating this bundle itself does not contact a database. The three migrations and eight fixtures were subsequently applied to hosted Alibai (`vfqxxkvokbgrooxhkdmi`) through Supabase MCP; a transactional smoke test passed 23 checks and rolled back all synthetic records. Do not reapply the fresh-install bundle to that project. A Supabase public/secret API key alone is not a database migration credential. CLI application also needs a scoped management access token with the documented database permissions or an authenticated direct database connection, plus the exact target project.


## Avatar and voice casting

All fourteen user-provided Anam avatar IDs live in the service-only `avatar_catalog`. Its dashboard labels are internal casting metadata and never replace the public fictional suspect name. Each new session receives one enabled avatar in the assignment transaction. The trigger favors that player's least-used performers, avoids the immediately previous performer when alternatives are enabled, and randomly resolves ties. The matching MiniMax voice is copied into `game_sessions.minimax_voice_id` with the avatar ID. Both values are immutable, so reconnects and idempotent joins preserve the same performer and voice even if the catalog's future default is changed or disabled.

Scenario selection randomly breaks equal allocation counts. Neither selector reads guilt, changes the answer key, or alternates verdicts predictably. Any performer may portray either a guilty or innocent suspect; the immutable scenario supplies the role, name, manner and case facts. The eight-fixture pool still exhausts after eight distinct cases for one player, even though fourteen performers are available. Refill scenarios to support longer no-repeat play.

Stop or reconcile all active and failed/ambiguous remote agent runs before the third migration; it aborts while those records remain so an existing live agent cannot be silently recast. The third additive migration backfills existing sessions with stable assignments and adds the private roster without modifying case truth. If the first two migrations have already been installed, apply only `20261104230603_avatar_catalog_assignment.sql`, not the fresh-install bundle. Its voice IDs match the reviewed source map; rendering, voice availability and audiovisual fit still require live provider checks. The DB integration suite verifies casting retry stability, immutable session binding, private roster access, non-repeating least-used selection and preservation after future catalog edits.
