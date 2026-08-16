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
- Keep authorization helpers in a non-exposed `private` schema. Route privileged commands through trusted server code rather than public `SECURITY DEFINER` RPCs.

## Initial domains

1. Identity, organizations, memberships, and roles.
2. Tasks, dependencies, reviews, and activity.
3. Content assets, briefs, production stages, publishing, and metrics.
4. Campaigns, launches, milestones, assets, and readiness gates.
5. People, leads, customers, sources, consent, and pipeline.
6. Metric definitions, observations, targets, experiments, and decisions.
