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

The identity and real task-management foundations are live. The team has not been onboarded, no live tasks have been entered, and no production customer or social data is connected.

## First owner setup

1. Open `/tasks` on the deployed site.
2. Request a one-time sign-in link using the owner's email.
3. After the verified session returns, choose **Create Market Whales workspace** once.
4. Do not enter team members or live work until role assignments and onboarding have been reviewed.

The bootstrap endpoint is authenticated and can create only the first organization. Once Market Whales exists, later users must be invited through the team-management flow that will be built next.
