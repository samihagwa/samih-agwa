---
name: market-whales-os
description: Build, change, review, or integrate the Market Whales operating system safely. Use for any task involving its React UI, Supabase backend, team workflows, content production, campaigns, CRM, analytics, Telegram bot, permissions, shared components, or cross-page behavior.
---

# Market Whales OS

Build one coherent operating system for the Market Whales team. Preserve shared contracts and verify the full system after every meaningful change.

## Start with truth

Read `references/product-context.md` before defining scope, data, workflows, or priorities. Do not turn test Telegram tasks into real work or assume the team has been onboarded.

Read `references/change-safety.md` before changing a shared UI primitive, status, action, schema, role, permission, integration, or navigation item.

## Use the canonical architecture

- Use React and TypeScript for the interface.
- Use Supabase Postgres, Auth, Storage, Realtime, and short Edge Functions for the backend.
- Keep long-running or privileged integrations in trusted workers; let Telegram act as an interface, not a source of truth.
- Keep domain rules outside page components and critical transitions outside browser-only code.
- Keep the existing Market Whales app isolated until an approved API or event contract exists.

## Implement safely

1. Identify the domain invariant and every affected consumer.
2. Search for all usages of changed shared symbols and persisted values.
3. Update the canonical component, contract, migration, policy, or function.
4. Update dependent pages and tests in the same change.
5. Apply RLS and least privilege before connecting real data.
6. Run type checking, lint, build, and route tests.
7. Report coverage and unresolved live-system approvals.

## Preserve interface quality

- Work RTL-first and support mobile, keyboard, reduced motion, and color-vision differences.
- Pair status color with a symbol and explicit text.
- Use shared tokens and primitives; do not create near-duplicate page-local buttons or badges.
- Show honest empty states instead of invented numbers or tasks.

## Stop before unsafe live actions

Request owner confirmation before creating paid resources, restoring paused projects, publishing production code, changing DNS, sending messages, importing customer data, or connecting privileged third-party accounts.
