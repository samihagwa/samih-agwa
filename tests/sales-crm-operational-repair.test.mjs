import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("manual sales intake supports chat-only leads, current customers, cashback, and trading experience atomically", async () => {
  const [migration, command, workspace, crm] = await Promise.all([
    read("../supabase/migrations/20260909035602_crm_customer_intake_simplification.sql"),
    read("../supabase/functions/crm-commands/index.ts"),
    read("../components/crm/CrmWorkspace.tsx"),
    read("../lib/crm.ts"),
  ]);

  assert.match(migration, /create or replace function public\.create_crm_lead_v5/);
  assert.match(migration, /identity_count > 0/);
  assert.match(migration, /contact_initial_stage not in \('new', 'won'\)/);
  assert.match(migration, /alter type public\.crm_interest add value if not exists 'cashback'/);
  assert.match(command, /create_crm_lead_v5/);
  assert.match(command, /cashback/);
  assert.match(workspace, /حفظ كعميل حالي/);
  assert.match(workspace, /رقم الهاتف أو البريد أو اسم المستخدم ليست شروطًا للحفظ/);
  assert.match(workspace, /url\.searchParams\.get\("add"\) !== "1"/);
  assert.match(workspace, /selfSalesPerson/);
  assert.match(workspace, /خبرة التداول/);
  assert.match(crm, /اسم مستخدم Instagram/);
  assert.match(crm, /اسم مستخدم Facebook/);
});

test("CRM directory exposes one clear set of customer views and trading-experience filters", async () => {
  const [migration, directory] = await Promise.all([
    read("../supabase/migrations/20260909035602_crm_customer_intake_simplification.sql"),
    read("../components/crm/CrmCustomerDirectory.tsx"),
  ]);

  assert.match(migration, /target_segment text/);
  assert.match(migration, /target_segment = 'indicator' and contact\.interest = 'indicator'/);
  assert.match(migration, /target_segment = 'cashback' and contact\.interest::text = 'cashback'/);
  assert.match(migration, /target_trading_experience is null/);
  assert.match(directory, /عملاء المؤشر/);
  assert.match(directory, /عملاء الكاش باك/);
  assert.match(directory, /عملاء حاليون/);
  assert.match(directory, /search_crm_contacts_v8/);
});

test("agency customers are visible to CRM sales without financial data", async () => {
  const [migration, workspace, nav] = await Promise.all([
    read("../supabase/migrations/20260909010100_sales_crm_operational_repair.sql"),
    read("../components/crm/ExnessAgencyWorkspace.tsx"),
    read("../components/crm/CrmSectionNav.tsx"),
  ]);

  assert.match(migration, /create or replace function public\.search_exness_agency_clients/);
  assert.doesNotMatch(migration.match(/create or replace function public\.search_exness_agency_clients[\s\S]*?revoke all/)?.[0] ?? "", /commission|lots/);
  assert.match(workspace, /search_exness_agency_clients/);
  assert.match(workspace, /عملاء Exness الحاليون تحت الوكالة/);
  assert.match(nav, /عملاء الوكالة/);
});

test("deduplicated Whales Zone registrations still create the indicator workflow", async () => {
  const migration = await read("../supabase/migrations/20260909010100_sales_crm_operational_repair.sql");

  assert.match(migration, /private\.ensure_whales_zone_indicator_workflow/);
  assert.match(migration, /intake_result\.outcome in \('created', 'deduplicated'\)/);
  assert.match(migration, /event\.outcome = 'deduplicated'/);
  assert.match(migration, /'عملية تفعيل المؤشر — '/);
  assert.match(migration, /'متابعة سيلز — '/);
});

test("the customer file updates trading experience with the sales summary", async () => {
  const [customer, command, migration] = await Promise.all([
    read("../components/crm/CrmCustomerWorkspace.tsx"),
    read("../supabase/functions/crm-commands/index.ts"),
    read("../supabase/migrations/20260909010200_crm_sales_profile_trading_experience.sql"),
  ]);

  assert.match(customer, /name="trading_experience"/);
  assert.match(command, /save_crm_sales_profile_v2/);
  assert.match(migration, /crm\.trading_experience_updated/);
});
