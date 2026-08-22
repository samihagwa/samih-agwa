alter table private.crm_lead_intake_rate_limits
  add column id bigint generated always as identity primary key;
