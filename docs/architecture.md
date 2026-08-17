# Architecture

## Decision

Use a React + TypeScript web application with Supabase as the primary backend.

## Boundaries

```text
React web app
  -> Supabase Auth (identity)
  -> Postgres + RLS (source of truth)
  -> Storage (files and metadata ownership)
  -> Realtime (board updates and notifications)
  -> Edge Functions (short privileged operations)

Trusted integration workers
  -> Telegram delivery and action callbacks
  -> Google Drive synchronization
  -> Meta and analytics ingestion
  -> retries, queues, rate limits, and dead-letter handling

Existing Market Whales application
  -> isolated external system until an approved API/event contract exists
```

## Frontend rules

- Keep a single application shell and shared design primitives.
- Generate database types after schema changes and consume them from one module.
- Never make the UI the only enforcer of a business rule.
- Prefer server-side or database-validated commands for irreversible transitions.

## Backend rules

- Use UUID primary keys, `created_at`, `updated_at`, and explicit organization ownership.
- Enable RLS before exposing tables through the Data API.
- Use `app_metadata` or database membership rows for authorization.
- Put uploads in private buckets and use short-lived signed URLs.
- Make webhook and job handlers idempotent and audit every privileged mutation.
- Keep authorization helpers in a non-exposed `private` schema. Prefer trusted server code for privileged operations; any narrow `SECURITY DEFINER` command must validate the authenticated caller, use an empty search path, expose no table writes, and have explicit execute grants.

## Task workflow contract

- `tasks` is the operational source of truth; Telegram messages are never treated as task records.
- A task cannot be created without one active organization owner, a future deadline, and acceptance criteria.
- Leadership can define and reassign work. An assigned member can move only their own task and cannot rewrite its scope, owner, priority, or deadline.
- Status transitions are validated by `private.enforce_task_rules`, not by the browser. The UI mirrors the same transition map for guidance only.
- Every task change creates an immutable `task_events` record and a leadership-visible `audit_events` record.
- The first organization is created atomically by an authenticated Edge Function. Its database command is `SECURITY INVOKER` and executable by `service_role` only.

## Content production contract

- `content_items` is the source of truth for a publishable asset and its brief.
- A reel workflow is created atomically through the JWT-protected `create-content-workflow` Edge Function; its database command is executable by `service_role` only, so partial task sets cannot be saved.
- Each workflow produces seven normal tasks: brief, recording, editing, thumbnail, caption, approval, and publishing.
- `task_dependencies` models the handoff graph. Completing a predecessor unlocks only downstream tasks whose dependencies are all done.
- Caption work can run in parallel after brief approval; final approval waits for editing, thumbnail, and caption.
- Content status is derived by database triggers from linked task state, and important changes are written to the audit log.
- External social publishing remains manual until a verified platform integration returns a real publish confirmation.

## Initial domains

1. Identity, organizations, memberships, and roles — foundation live; team onboarding pending.
2. Tasks, transitions, ownership, deadlines, acceptance criteria, Realtime, and activity — foundation live.
3. Content assets, briefs, dependency-based production stages, and manual publish confirmation — foundation live; external publishing and metrics pending.
4. Campaigns, launches, milestones, assets, and readiness gates.
5. People, leads, customers, sources, consent, and pipeline.
6. Metric definitions, observations, targets, experiments, and decisions.
