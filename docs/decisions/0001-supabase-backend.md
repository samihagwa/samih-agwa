# ADR 0001: Supabase backend

## Status

Accepted and provisioned for the new Market Whales OS.

## Context

The product needs relational workflows, permissions, files, live board updates, secure integrations, and analytics. The existing company application source is not currently available.

## Decision

Use Supabase for Postgres, Auth, Storage, Realtime, and short Edge Functions. Use separate trusted workers for Telegram and long-running external integrations.

## Consequences

- One relational source of truth supports content, tasks, CRM, and campaigns.
- RLS and audit design are mandatory, not optional hardening.
- The Telegram bot becomes a client/integration instead of the database.
- The new system can operate independently and integrate with the existing app later through an explicit contract.
- A new clean Supabase project is preferred over inactive experimental projects.

## Live decision record

- Project: `Market Whales OS`
- Project ref: `xmnqwcevqahtoixvcdya`
- Region: `eu-central-1` (Frankfurt)
- Created: 2026-08-16
- Provisioned monthly cost at creation: USD 0
- Existing inactive experimental projects were not restored or modified.
