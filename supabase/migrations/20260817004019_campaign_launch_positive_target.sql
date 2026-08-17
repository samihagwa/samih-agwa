-- A launch cannot be evaluated against an all-zero plan. Keep individual fields
-- nullable or zero, but require at least one meaningful positive target.

alter table public.launches
  add constraint launches_has_positive_target check (
    coalesce(lead_target, 0) > 0
    or coalesce(sales_target, 0) > 0
    or coalesce(revenue_target, 0) > 0
  );
