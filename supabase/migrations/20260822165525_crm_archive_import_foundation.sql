-- TradingView is a searchable, deduplicated customer identity. Keep the enum
-- extension in its own migration because PostgreSQL cannot safely consume a
-- newly-added enum value until the transaction that added it has committed.

alter type public.crm_identity_kind add value if not exists 'tradingview';
