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
6. `secure_content_workflow_command`: moves content creation behind a JWT-protected Edge Function and restricts the database command to `service_role`.
7. `campaign_launch_pipeline`: launches, eight readiness gates represented as tasks, shared dependency unlocking, derived launch status, content links, RLS, audit events, and Realtime state.
8. `campaign_launch_fk_indexes`: covering indexes for the launch composite foreign keys reported by the performance advisor.
9. `campaign_launch_detach_content`: reversible, leadership-only, audited content-link removal through a service-only database command.
10. `campaign_launch_positive_target`: requires at least one positive measurable target for every launch.

Deployed Edge Functions:

1. `bootstrap-organization` v1: JWT-protected, one-time owner workspace initialization. Unauthenticated requests return `401`.
2. `create-content-workflow` v1: JWT-protected, validates the caller, and creates one content item plus seven dependent tasks atomically. Unauthenticated requests return `401`.
3. `launch-commands` v3: JWT-protected launch creation plus audited content attach/detach commands, including positive-target validation. Unauthenticated requests return `401`.

Verification on 2026-08-17:

- Project status: `ACTIVE_HEALTHY`.
- Security advisor: no schema or RLS findings. A project-level warning remains for leaked-password protection; the current application uses passwordless one-time email links and does not expose password sign-in.
- RLS: enabled on all ten public application tables.
- `anon`: no table read grant.
- `authenticated`: explicit reads, column-scoped task writes, and one validated workflow command; all access is filtered by RLS and database rules.
- Performance advisor: only unused-index informational notices, expected for an empty new database.
- Security advisor: no findings after the task migrations.
- The organization bootstrap database command is not executable by `anon` or `authenticated`; only the trusted server role can call it.
- The content workflow database command is not executable by `anon` or `authenticated`; the authenticated browser calls the JWT-protected Edge Function instead.
- Launch creation and content-link commands are not executable by `anon` or `authenticated`; the authenticated browser calls the JWT-protected Edge Function instead.
- Composite launch foreign keys have covering indexes; the performance advisor reports only unused-index informational notices expected for an empty database.

Never commit `.env.local`, secret keys, legacy service-role keys, or production customer data.
