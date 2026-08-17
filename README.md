# Market Whales OS

A private, web-first operating system for Market Whales. The interface uses React and TypeScript; the backend is designed for Supabase.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

This starter does not use `wrangler.jsonc`.

## Repository shape

- `app/`: routes and RTL application styles
- `components/ui`: canonical shared interface primitives
- `components/layout`: canonical navigation and shell
- `lib/`: shared domain configuration and Supabase client boundary
- `supabase/`: migrations and server functions after project creation
- `docs/`: architecture and decisions
- `.agents/skills/market-whales-os`: repository-specific operating rules for Codex

## Important status

The identity, task-management, reel-production, and campaign-launch foundations are live. The team has not been onboarded, no live tasks, content, or launches have been entered, and no production customer, sales, or social data is connected.

## First owner setup

1. Open `/tasks` on the deployed site.
2. Request a one-time sign-in link using the owner's email.
3. After the verified session returns, choose **Create Market Whales workspace** once.
4. During personal testing, do not enter team members. Create only clearly labeled test tasks and reel workflows.

The bootstrap endpoint is authenticated and can create only the first organization. No invitation flow is active and no invitation is sent during personal testing.

## Personal content test

1. Sign in and create the owner workspace from `/tasks`.
2. Open `/content` and choose **New reel**.
3. Complete the brief and publish date. The owner account is assigned to all seven steps by default.
4. Move linked tasks through the allowed states on `/tasks`. Completing a dependency unlocks the next eligible task automatically.
5. The final publishing task is a manual confirmation until a verified Meta/platform integration is added.

## Personal launch test

1. Sign in with the owner account and open `/campaigns`.
2. Create a launch with a real brief, future start/end, and at least one measurable target. The owner can remain assigned to all eight gates during personal testing.
3. Move the active gate through the task board. Completing a gate unlocks only the next eligible gates; Go / No-Go remains locked until registration, delivery, promotion, and tracking are complete.
4. Create content in `/content`, then attach it to the launch from the launch card. Removing the link never deletes either record.
5. Target values are planning data. Actual registrations, revenue, and social results remain visibly unavailable until a verified source is connected.
