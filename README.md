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

The current UI contains foundation and sample states only. The team has not been onboarded and no production customer or social data is connected.
