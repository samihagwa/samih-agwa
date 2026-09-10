import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOKUP_PATTERN = /^[A-Za-z0-9._-]{3,160}$/;
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 45_000;
const SYNC_BATCH_SIZE = 250;
const EXNESS_BASE_URL = "https://my.exnessaffiliates.com";
const EXNESS_PAGE_SIZE = 500;
const EXNESS_MAX_PAGES = 100;
const ACCOUNT_NUMBER_PATTERN = /^[A-Za-z0-9._-]{3,80}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

type JsonRecord = Record<string, unknown>;
type NormalizedAccount = {
  organization_id: string;
  integration_id: string;
  external_client_id: string;
  account_number: string;
  client_profile: JsonRecord;
  is_active: boolean;
  lots: number;
  commission: number;
  commission_currency: string;
  registered_at: string | null;
  last_activity_at: string | null;
  last_synced_at: string;
  source_hash: string;
};

class ExnessError extends Error {
  constructor(message: string, readonly publicMessage: string, readonly status = 502) {
    super(message);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function identifier(value: unknown) {
  if (typeof value === "string") return value.replaceAll("\u0000", "").trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function object(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function exnessRequest(path: string, init: RequestInit = {}, authenticationRequest = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${EXNESS_BASE_URL}${path}`, { ...init, cache: "no-store", signal: controller.signal });
    const rawPayload = await response.json().catch(() => null);
    if (!response.ok) {
      const providerMessage = text(object(rawPayload)?.message ?? object(rawPayload)?.detail);
      if (response.status === 401 || response.status === 403) {
        throw new ExnessError(
          `Exness ${path} returned ${response.status}: ${providerMessage || "authentication failed"}`,
          authenticationRequest
            ? "رفضت Exness بيانات حساب الشراكة. راجع البريد أو رقم الدخول وكلمة السر المحفوظة في أسرار الخادم."
            : "انتهت جلسة Exness أو لا يملك حساب الشراكة صلاحية قراءة التقارير.",
          502,
        );
      }
      if (response.status === 429) throw new ExnessError(`Exness ${path} throttled`, "Exness أوقفت الطلبات مؤقتًا بسبب كثرتها. حاول بعد قليل.", 429);
      throw new ExnessError(`Exness ${path} returned ${response.status}: ${providerMessage}`, "تعذّر الاتصال بواجهة Exness الرسمية الآن.", 502);
    }
    return rawPayload;
  } catch (error) {
    if (error instanceof ExnessError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ExnessError(`Exness ${path} timed out`, "انتهت مهلة مزامنة Exness. حاول مرة أخرى.", 504);
    throw new ExnessError(`Exness ${path} request failed`, "تعذّر الوصول إلى واجهة Exness الرسمية الآن.");
  } finally {
    clearTimeout(timeout);
  }
}

async function exnessToken() {
  const login = text(Deno.env.get("EXNESS_PARTNER_LOGIN"));
  const password = text(Deno.env.get("EXNESS_PARTNER_PASSWORD"));
  if (!login || !password) throw new ExnessError("Official Exness credentials are missing", "بيانات حساب شراكة Exness غير مكتملة في أسرار الخادم.", 500);
  const payload = object(await exnessRequest("/api/v2/auth/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  }, true));
  const token = text(payload?.token);
  if (token.length < 20) throw new ExnessError("Exness auth did not return a token", "لم تُرجع Exness جلسة صالحة لحساب الشراكة.");
  return token;
}

function authorizedHeaders(token: string) {
  return {
    Authorization: `JWT ${token}`,
    Accept: "application/json",
  };
}

function extractRows(payload: unknown) {
  const root = object(payload);
  if (Array.isArray(root?.data)) return root.data;
  if (Array.isArray(root?.results)) return root.results;
  return [];
}

function extractTotal(payload: unknown) {
  const root = object(payload);
  const meta = object(root?.meta);
  const totals = object(root?.totals);
  const candidate = meta?.count ?? meta?.total ?? totals?.count ?? root?.count;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function fetchExnessPages(path: string, token: string, ordering: string) {
  const rows: unknown[] = [];
  for (let page = 0; page < EXNESS_MAX_PAGES; page += 1) {
    const url = new URL(path, EXNESS_BASE_URL);
    url.searchParams.set("limit", String(EXNESS_PAGE_SIZE));
    url.searchParams.set("offset", String(page * EXNESS_PAGE_SIZE));
    url.searchParams.set("ordering", ordering);
    const payload = await exnessRequest(`${url.pathname}${url.search}`, { headers: authorizedHeaders(token) });
    const pageRows = extractRows(payload);
    rows.push(...pageRows);
    const total = extractTotal(payload);
    if (pageRows.length < EXNESS_PAGE_SIZE || (total !== null && rows.length >= total)) return rows;
  }
  throw new ExnessError(`Exness pagination exceeded ${EXNESS_MAX_PAGES} pages for ${path}`, "حجم بيانات Exness أكبر من حد المزامنة الآمن. راجع مسؤول النظام.", 502);
}

async function normalizeAccount(
  rawValue: unknown,
  organizationId: string,
  integrationId: string,
  syncedAt: string,
  statusByClient: ReadonlyMap<string, string>,
): Promise<NormalizedAccount | null> {
  const raw = object(rawValue);
  if (!raw) return null;
  const data = raw;
  const accountNumber = identifier(data.client_account ?? data.account_number);
  const externalClientId = identifier(data.client_uid ?? data.external_client_id) || accountNumber;
  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber) || !CLIENT_ID_PATTERN.test(externalClientId)) return null;
  const currencyCandidate = text(data.currency ?? data.commission_currency).toUpperCase();
  const currency = /^[A-Z]{3,8}$/.test(currencyCandidate) ? currencyCandidate : "USD";
  const status = (statusByClient.get(externalClientId) || text(data.client_status ?? data.status)).toLowerCase();
  const clientProfile: JsonRecord = {
    account_type: text(data.client_account_type ?? data.account_type) || null,
    partner_account: text(data.partner_account) || null,
    partner_account_name: text(data.partner_account_name) || null,
    country: text(data.client_country ?? data.country) || null,
    platform: text(data.platform) || null,
    comment: text(data.comment) || null,
    currency,
    volume_mln_usd: finiteNumber(data.volume_mln_usd),
    reward: finiteNumber(data.reward),
    source_record_id: data.id === null || data.id === undefined ? null : String(data.id),
    source_status: status || null,
  };
  const stablePayload = JSON.stringify({
    accountNumber,
    externalClientId,
    clientProfile,
    status,
    lots: finiteNumber(data.volume_lots ?? data.lots),
    commission: finiteNumber(data.reward_usd ?? data.commission),
    registeredAt: isoDate(data.client_account_created ?? data.reg_date ?? data.registered_at),
    lastActivityAt: isoDate(data.client_account_last_trade ?? data.trade_fn ?? data.last_activity_at),
  });
  const inactiveStatuses = new Set(["inactive", "disabled", "deactivated", "blocked", "archived", "closed", "suspended"]);
  return {
    organization_id: organizationId,
    integration_id: integrationId,
    external_client_id: externalClientId,
    account_number: accountNumber,
    client_profile: clientProfile,
    // The official account report is itself the current agency-membership source.
    // Exness currently omits a status value for ordinary linked accounts, so an
    // absent/unknown status must not turn every returned account into inactive.
    is_active: !inactiveStatuses.has(status),
    lots: Math.max(0, finiteNumber(data.volume_lots ?? data.lots)),
    commission: finiteNumber(data.reward_usd ?? data.commission),
    commission_currency: currency,
    registered_at: isoDate(data.client_account_created ?? data.reg_date ?? data.registered_at),
    last_activity_at: isoDate(data.client_account_last_trade ?? data.trade_fn ?? data.last_activity_at),
    last_synced_at: syncedAt,
    source_hash: await sha256(stablePayload),
  };
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    if (authError || !context?.userClaims?.id) return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);

    let body: JsonRecord;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400);
    }

    const action = text(body.action);
    const organizationId = text(body.organization_id);
    if (!UUID_PATTERN.test(organizationId)) return jsonResponse({ message: "مساحة العمل غير صالحة." }, 400);

    if (action === "lookup_exness_account") {
      const lookupValue = text(body.lookup_value);
      if (!LOOKUP_PATTERN.test(lookupValue)) return jsonResponse({ message: "اكتب رقم حساب أو معرّف عميل صحيحًا." }, 400);
      const { data: lookupMembership, error: lookupMembershipError } = await context.supabaseAdmin.from("memberships")
        .select("role,allowed_sections").eq("organization_id", organizationId).eq("user_id", context.userClaims.id)
        .eq("status", "active").maybeSingle();
      if (lookupMembershipError) return jsonResponse({ message: "تعذّر التحقق من صلاحية البحث." }, 500);
      if (!lookupMembership || lookupMembership.role === "viewer" || (lookupMembership.role !== "owner" && !lookupMembership.allowed_sections?.includes("crm"))) {
        return jsonResponse({ message: "حسابك غير مصرح له ببحث الوكالة." }, 403);
      }

      const { data: lookupIntegration, error: lookupIntegrationError } = await context.supabaseAdmin.from("broker_integrations")
        .select("id,status,account_lookup_enabled").eq("organization_id", organizationId).eq("provider", "exness").maybeSingle();
      if (lookupIntegrationError) return jsonResponse({ message: "تعذّر تحميل ربط Exness." }, 500);
      if (!lookupIntegration || lookupIntegration.status !== "ready" || !lookupIntegration.account_lookup_enabled) {
        return jsonResponse({ integration_ready: false, under_agency: false, is_active: false, last_synced_at: null, external_client_id: null, accounts: [] });
      }

      try {
        const checkedAt = new Date().toISOString();
        const token = await exnessToken();
        const rawAccounts = await fetchExnessPages("/api/reports/clients/accounts/", token, "client_account");
        const matchingClientIds = new Set<string>();
        for (const rawValue of rawAccounts) {
          const raw = object(rawValue);
          if (!raw) continue;
          const accountNumber = identifier(raw.client_account ?? raw.account_number);
          const clientId = identifier(raw.client_uid ?? raw.external_client_id) || accountNumber;
          if (accountNumber === lookupValue || clientId === lookupValue) matchingClientIds.add(clientId);
        }
        const relatedRawAccounts = rawAccounts.filter((rawValue) => {
          const raw = object(rawValue);
          if (!raw) return false;
          const accountNumber = identifier(raw.client_account ?? raw.account_number);
          const clientId = identifier(raw.client_uid ?? raw.external_client_id) || accountNumber;
          return matchingClientIds.has(clientId) || accountNumber === lookupValue;
        });
        const normalized = (await Promise.all(relatedRawAccounts.map((raw) => normalizeAccount(
          raw,
          organizationId,
          lookupIntegration.id,
          checkedAt,
          new Map(),
        )))).filter((account): account is NormalizedAccount => account !== null);
        const relatedByNumber = new Map<string, NormalizedAccount>();
        for (const account of normalized) relatedByNumber.set(account.account_number, account);
        const relatedAccounts = Array.from(relatedByNumber.values());
        if (relatedAccounts.length) {
          for (let offset = 0; offset < relatedAccounts.length; offset += SYNC_BATCH_SIZE) {
            const { error: lookupUpsertError } = await context.supabaseAdmin.from("broker_client_accounts")
              .upsert(relatedAccounts.slice(offset, offset + SYNC_BATCH_SIZE), { onConflict: "integration_id,account_number" });
            if (lookupUpsertError) throw new ExnessError(`Lookup upsert failed: ${lookupUpsertError.code}`, "تم التحقق من Exness لكن تعذّر تحديث ملف الحساب.", 500);
          }
        } else {
          await context.supabaseAdmin.from("broker_client_accounts").update({ is_active: false, last_synced_at: checkedAt })
            .eq("organization_id", organizationId).eq("integration_id", lookupIntegration.id)
            .or(`account_number.eq.${lookupValue},external_client_id.eq.${lookupValue}`);
        }
        await context.supabaseAdmin.from("audit_events").insert({
          organization_id: organizationId,
          actor_id: context.userClaims.id,
          action: "broker.exness_lookup_refreshed",
          entity_type: "broker_integration",
          entity_id: lookupIntegration.id,
          after_data: {
            source: "official_partnership_api",
            source_rows: rawAccounts.length,
            matched_source_rows: relatedRawAccounts.length,
            matched_accounts: relatedAccounts.length,
          },
        });
        const primary = relatedAccounts.find((account) => account.account_number === lookupValue) ?? relatedAccounts[0] ?? null;
        return jsonResponse({
          integration_ready: true,
          under_agency: relatedAccounts.length > 0,
          is_active: relatedAccounts.some((account) => account.is_active),
          last_synced_at: checkedAt,
          external_client_id: primary?.external_client_id ?? null,
          accounts: relatedAccounts.map((account) => ({
            account_number: account.account_number,
            registered_at: account.registered_at,
            last_activity_at: account.last_activity_at,
            is_active: account.is_active,
          })),
        });
      } catch (error) {
        const exnessError = error instanceof ExnessError ? error : new ExnessError("Unexpected live lookup failure", "تعذّر التحقق المباشر من Exness الآن.", 500);
        console.error("Exness live lookup failed", { message: exnessError.message, status: exnessError.status });
        return jsonResponse({ message: exnessError.publicMessage }, exnessError.status);
      }
    }

    if (action === "get_exness_overview") {
      const { data, error } = await context.supabaseAdmin.rpc("get_exness_agency_summary", {
        target_user_id: context.userClaims.id,
        target_organization_id: organizationId,
      });
      if (error) {
        if (/Owner access is required/i.test(error.message)) return jsonResponse({ message: "ملخص الوكالة متاح للمالك فقط." }, 403);
        return jsonResponse({ message: "تعذّر تحميل ملخص الوكالة." }, 500);
      }
      return jsonResponse(data?.[0] ?? null);
    }

    if (action !== "sync_exness_official" && action !== "sync_exness_bridge") return jsonResponse({ message: "أمر تكامل غير معروف." }, 400);

    const { data: ownerMembership, error: membershipError } = await context.supabaseAdmin.from("memberships")
      .select("id").eq("organization_id", organizationId).eq("user_id", context.userClaims.id)
      .eq("status", "active").eq("role", "owner").maybeSingle();
    if (membershipError) return jsonResponse({ message: "تعذّر التحقق من صلاحية المالك." }, 500);
    if (!ownerMembership) return jsonResponse({ message: "المزامنة متاحة للمالك فقط." }, 403);

    const integrationResult = await context.supabaseAdmin.from("broker_integrations")
      .select("*").eq("organization_id", organizationId).eq("provider", "exness").maybeSingle();
    if (integrationResult.error) return jsonResponse({ message: "تعذّر تحميل إعداد التكامل." }, 500);
    let integration = integrationResult.data;
    if (!integration) {
      const created = await context.supabaseAdmin.from("broker_integrations").insert({
        organization_id: organizationId,
        provider: "exness",
        display_name: "Exness Agency",
        status: "not_configured",
        base_url: EXNESS_BASE_URL,
        account_lookup_enabled: false,
        created_by: context.userClaims.id,
      }).select("*").single();
      if (created.error) return jsonResponse({ message: "تعذّر إنشاء إعداد التكامل." }, 500);
      integration = created.data;
    }

    const requestKey = text(body.request_key) || crypto.randomUUID();
    if (!/^[A-Za-z0-9._-]{8,160}$/.test(requestKey)) return jsonResponse({ message: "معرّف المزامنة غير صالح." }, 400);
    const { data: previousRun } = await context.supabaseAdmin.from("broker_sync_runs").select("*")
      .eq("integration_id", integration.id).eq("request_key", requestKey).maybeSingle();
    if (previousRun) return jsonResponse({ sync: previousRun, replayed: true });

    const lastSyncMs = integration.last_sync_at ? new Date(integration.last_sync_at).getTime() : 0;
    const remainingMs = SYNC_COOLDOWN_MS - (Date.now() - lastSyncMs);
    if (remainingMs > 0) return jsonResponse({ message: "البيانات محدثة بالفعل. انتظر قليلًا قبل المزامنة التالية.", retry_after_seconds: Math.ceil(remainingMs / 1000) }, 429);

    const startedAt = new Date().toISOString();
    const { data: syncRun, error: syncRunError } = await context.supabaseAdmin.from("broker_sync_runs").insert({
      organization_id: organizationId,
      integration_id: integration.id,
      request_key: requestKey,
      status: "running",
      triggered_by: context.userClaims.id,
      started_at: startedAt,
    }).select("*").single();
    if (syncRunError) return jsonResponse({ message: "تعذّر بدء سجل المزامنة." }, 500);
    await context.supabaseAdmin.from("broker_integrations").update({ status: "syncing", last_error: null }).eq("id", integration.id);

    try {
      const token = await exnessToken();
      const [rawAccounts, rawClients] = await Promise.all([
        fetchExnessPages("/api/reports/clients/accounts/", token, "client_account"),
        fetchExnessPages("/api/v2/reports/clients/", token, "client_uid"),
      ]);
      const statusByClient = new Map<string, string>();
      for (const rawClient of rawClients) {
        const client = object(rawClient);
        const clientId = identifier(client?.client_uid ?? client?.external_client_id);
        const status = text(client?.client_status ?? client?.status ?? client?.state);
        if (clientId && status) statusByClient.set(clientId, status);
      }
      const normalizedResults = await Promise.all(
        rawAccounts.map((raw) => normalizeAccount(raw, organizationId, integration.id, startedAt, statusByClient)),
      );
      const normalizedAccounts = normalizedResults.filter((account): account is NormalizedAccount => account !== null);
      const uniqueClientAccountRows = new Set(
        normalizedAccounts.map((account) => `${account.external_client_id}\u0000${account.account_number}`),
      ).size;
      const invalidRows = normalizedResults.length - normalizedAccounts.length;
      const duplicateSourceRows = normalizedAccounts.length - uniqueClientAccountRows;
      const accountsByNumber = new Map<string, NormalizedAccount>();
      for (const account of normalizedAccounts) accountsByNumber.set(account.account_number, account);
      const accounts = Array.from(accountsByNumber.values());
      await context.supabaseAdmin.from("broker_sync_runs").update({
        fetched_rows: rawAccounts.length,
        error_rows: invalidRows,
      }).eq("id", syncRun.id);
      for (let offset = 0; offset < accounts.length; offset += SYNC_BATCH_SIZE) {
        const batch = accounts.slice(offset, offset + SYNC_BATCH_SIZE);
        const { error: upsertError } = await context.supabaseAdmin.from("broker_client_accounts")
          .upsert(batch, { onConflict: "integration_id,account_number" });
        if (upsertError) {
          console.error("Exness account upsert failed", {
            code: upsertError.code,
            message: upsertError.message,
            details: upsertError.details,
            hint: upsertError.hint,
            batch_offset: offset,
            batch_size: batch.length,
          });
          throw new ExnessError(`Account upsert failed: ${upsertError.code}`, "تعذّر حفظ حسابات Exness في النظام الجديد.", 500);
        }
      }
      const completedAt = new Date().toISOString();
      await context.supabaseAdmin.from("broker_sync_runs").update({
        status: "completed",
        fetched_rows: rawAccounts.length,
        upserted_rows: accounts.length,
        error_rows: invalidRows,
        completed_at: completedAt,
      }).eq("id", syncRun.id);
      await context.supabaseAdmin.from("broker_integrations").update({
        status: "ready",
        base_url: EXNESS_BASE_URL,
        account_lookup_enabled: true,
        last_sync_at: startedAt,
        last_error: invalidRows ? `تم تجاهل ${invalidRows} سجل حساب غير صالح.` : null,
      }).eq("id", integration.id);
      await context.supabaseAdmin.from("audit_events").insert({
        organization_id: organizationId,
        actor_id: context.userClaims.id,
        action: "broker.exness_synced",
        entity_type: "broker_integration",
        entity_id: integration.id,
        request_id: UUID_PATTERN.test(requestKey) ? requestKey : null,
        after_data: {
          source: "official_partnership_api",
          fetched_rows: rawAccounts.length,
          fetched_clients: rawClients.length,
          normalized_rows: normalizedAccounts.length,
          unique_client_account_rows: uniqueClientAccountRows,
          duplicate_source_rows: duplicateSourceRows,
          upserted_rows: accounts.length,
          error_rows: invalidRows,
        },
      });
      return jsonResponse({
        sync: {
          ...syncRun,
          status: "completed",
          fetched_rows: rawAccounts.length,
          fetched_clients: rawClients.length,
          upserted_rows: accounts.length,
          duplicate_source_rows: duplicateSourceRows,
          error_rows: invalidRows,
          completed_at: completedAt,
        },
      });
    } catch (error) {
      const exnessError = error instanceof ExnessError ? error : new ExnessError("Unexpected sync failure", "تعذّرت مزامنة Exness الآن.", 500);
      console.error("Exness synchronization failed", { message: exnessError.message, status: exnessError.status });
      const completedAt = new Date().toISOString();
      await context.supabaseAdmin.from("broker_sync_runs").update({ status: "failed", error_message: exnessError.publicMessage, completed_at: completedAt }).eq("id", syncRun.id);
      await context.supabaseAdmin.from("broker_integrations").update({ status: "error", account_lookup_enabled: false, last_error: exnessError.publicMessage }).eq("id", integration.id);
      return jsonResponse({ message: exnessError.publicMessage }, exnessError.status);
    }
  },
};
