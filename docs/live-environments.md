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

Verification on 2026-08-16:

- Project status: `ACTIVE_HEALTHY`.
- Security advisor: no findings.
- RLS: enabled on all four public foundation tables.
- `anon`: no table read grant.
- `authenticated`: explicit read grants filtered by RLS.
- Performance advisor: only unused-index informational notices, expected for an empty new database.

Never commit `.env.local`, secret keys, legacy service-role keys, or production customer data.
