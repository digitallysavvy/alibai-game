# Database setup

Everything a new Alibai project needs: the tables, policies and game functions, plus the cases to play.

The schema lives in `supabase/migrations`, and the cases live in `lib/scenarios`. The SQL files here are generated from those, so change the source and run `pnpm data:build`. Don't edit them by hand. A unit test fails if they fall behind.

| File | What it is |
| --- | --- |
| `cases.sql` | Publishes every case. Safe to re-run |
| `install.sql` | All migrations and cases in one transaction, for the SQL Editor |
| `preflight.sql` | Read-only check for name collisions before `install.sql` |
| `postflight.sql` | Read-only check of RLS, privileges and case count after install |
| `build.ts` | Regenerates the SQL files. Doesn't touch a database |

## A new Supabase project

You'll need the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```sh
supabase login
supabase link --project-ref <your-project-ref>
pnpm data:setup
```

This applies each migration, records it in the project's migration history, then publishes the cases.

## Local development

You'll need Docker.

```sh
supabase start
pnpm data:setup:local
```

Run `supabase status` for the local keys, and put them in `.env.local`.

## Without the CLI

In the Supabase SQL Editor, run these in order:

1. `preflight.sql`. If it returns any rows, stop. Those objects already exist.
2. `install.sql`. It rolls back completely if anything collides.
3. `postflight.sql`. All app tables should show RLS enabled, and the case count should match `cases.sql`.

This path doesn't fill in the CLI's migration history, so don't mix it with `pnpm data:setup` on the same project.

## An existing project

Add new migrations and never edit applied ones. `pnpm data:setup` pushes only what's missing, and the CLI stops if your migration history doesn't match, which is what you want. Don't run `install.sql` on a project that's already set up.

`cases.sql` also retires any handcrafted case that's no longer in the set. Retired cases stop being assigned, and finished sessions keep the case they were played on.
