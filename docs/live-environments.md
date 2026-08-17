# Live environments

## Supabase foundation

| Field | Value |
| --- | --- |
| Project | Market Whales OS |
| Project ref | `xmnqwcevqahtoixvcdya` |
| Region | `eu-central-1` (Frankfurt) |
| API URL | `https://xmnqwcevqahtoixvcdya.supabase.co` |
| Local environment | `.env.local` (ignored by Git) |

Applied migrations:

1. `initial_foundation`: profiles, organizations, memberships, audit events, private authorization helpers, RLS, explicit grants, and indexes.
2. `add_foundation_fk_indexes`: covering indexes for foreign keys reported by the performance advisor.
3. `task_management`: real tasks, task activity, status and priority contracts, transition validation, RLS, Realtime, explicit column grants, and the service-only organization bootstrap command.
4. `task_created_by_default`: database-owned creator attribution for browser inserts.
5. `content_production_pipeline`: content briefs, seven-step reel workflows, task dependency graph, automatic handoffs, RLS, audit events, and Realtime content state.

Deployed Edge Functions:

1. `bootstrap-organization` v1: JWT-protected, one-time owner workspace initialization. Unauthenticated requests return `401`.
2. `create-content-workflow` v1: JWT-protected, validates the caller, and creates one content item plus seven dependent tasks atomically. Unauthenticated requests return `401`.

Verification on 2026-08-17:

- Project status: `ACTIVE_HEALTHY`.
- Security advisor: no findings.
- RLS: enabled on all eight public application tables.
- `anon`: no table read grant.
- `authenticated`: explicit reads, column-scoped task writes, and one validated workflow command; all access is filtered by RLS and database rules.
- Performance advisor: only unused-index informational notices, expected for an empty new database.
- Security advisor: no findings after the task migrations.
- The organization bootstrap database command is not executable by `anon` or `authenticated`; only the trusted server role can call it.
- The content workflow database command is not executable by `anon` or `authenticated`; the authenticated browser calls the JWT-protected Edge Function instead.

Never commit `.env.local`, secret keys, legacy service-role keys, or production customer data.
