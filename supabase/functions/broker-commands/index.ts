import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";
// @ts-types="npm:@types/crypto-js@4.2.2"
import CryptoJS from "npm:crypto-js@4.2.0";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOKUP_PATTERN = /^[A-Za-z0-9._-]{3,160}$/;
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 45_000;
const SYNC_BATCH_SIZE = 250;

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

class BridgeError extends Error {
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

function bridgeBaseUrl() {
  const configured = text(Deno.env.get("EXNESS_BRIDGE_BASE_URL")) || "https://market-whales.onrender.com";
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new BridgeError("Invalid EXNESS_BRIDGE_BASE_URL", "إعداد عنوان جسر Exness غير صالح.", 500);
  }
  if (parsed.protocol !== "https:") throw new BridgeError("Bridge URL must use HTTPS", "يجب أن يعمل جسر Exness عبر اتصال HTTPS آمن.", 500);
  return parsed.origin;
}

function unwrapBridgePayload(payload: unknown) {
  const record = object(payload);
  const encryptedData = text(record?.encryptedData);
  if (!encryptedData) return payload;
  const responseKey = text(Deno.env.get("EXNESS_BRIDGE_RESPONSE_KEY"));
  if (!responseKey) throw new BridgeError("Missing bridge response key", "مفتاح قراءة بيانات جسر Exness غير مضبوط على الخادم.", 500);
  try {
    const clearText = CryptoJS.AES.decrypt(encryptedData, responseKey).toString(CryptoJS.enc.Utf8);
    if (!clearText) throw new Error("empty payload");
    return JSON.parse(clearText) as unknown;
  } catch {
    throw new BridgeError("Could not decrypt legacy bridge response", "تعذّرت قراءة استجابة جسر Exness. يلزم تحديث مفتاح الربط.");
  }
}

async function bridgeRequest(path: string, init: RequestInit = {}, unwrap = true) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${bridgeBaseUrl()}${path}`, { ...init, signal: controller.signal });
    const rawPayload = await response.json().catch(() => null);
    if (!response.ok) throw new BridgeError(`Bridge ${path} returned ${response.status}`, "تعذّر الاتصال بمصدر Exness القديم الآن.", response.status === 401 ? 502 : response.status);
    return unwrap ? unwrapBridgePayload(rawPayload) : rawPayload;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new BridgeError(`Bridge ${path} timed out`, "انتهت مهلة مزامنة Exness. حاول مرة أخرى.", 504);
    throw new BridgeError(`Bridge ${path} request failed`, "تعذّر الوصول إلى مصدر Exness القديم الآن.");
  } finally {
    clearTimeout(timeout);
  }
}

async function bridgeToken() {
  const email = text(Deno.env.get("EXNESS_BRIDGE_ADMIN_EMAIL"));
  const password = text(Deno.env.get("EXNESS_BRIDGE_ADMIN_PASSWORD"));
  if (!email || !password) throw new BridgeError("Bridge credentials are missing", "بيانات ربط لوحة Exness القديمة غير مكتملة على الخادم.", 500);
  const payload = object(await bridgeRequest("/user/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }, false));
  const token = text(payload?.token);
  if (!token || token.split(".").length !== 3) throw new BridgeError("Bridge login did not return a JWT", "تعذّر تسجيل الدخول إلى مصدر Exness القديم.");
  return token;
}

function authorizedHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-API-Source": "market-whales-os",
    "X-Client-Platform": "server",
  };
}

function extractClients(payload: unknown) {
  const root = object(payload);
  const data = object(root?.data);
  const candidates = data?.clients ?? root?.clients;
  return Array.isArray(candidates) ? candidates : [];
}

async function normalizeAccount(rawValue: unknown, organizationId: string, integrationId: string, syncedAt: string): Promise<NormalizedAccount | null> {
  const raw = object(rawValue);
  const data = object(raw?.data) ?? raw;
  if (!data) return null;
  const accountNumber = text(data.client_account ?? data.account_number);
  const externalClientId = text(data.client_uid ?? data.external_client_id) || accountNumber;
  if (!LOOKUP_PATTERN.test(accountNumber) || !LOOKUP_PATTERN.test(externalClientId)) return null;
  const currencyCandidate = text(data.currency ?? data.commission_currency).toUpperCase();
  const currency = /^[A-Z]{3,8}$/.test(currencyCandidate) ? currencyCandidate : "USD";
  const status = text(raw?.status ?? data.status).toLowerCase();
  const clientProfile: JsonRecord = {
    account_type: text(data.client_account_type ?? data.account_type) || null,
    partner_account: text(data.partner_account) || null,
    partner_account_name: text(data.partner_account_name) || null,
    country: text(data.country) || null,
    currency,
    volume_mln_usd: finiteNumber(data.volume_mln_usd),
    reward: finiteNumber(data.reward),
    source_record_id: text(raw?._id ?? data.id) || null,
    source_status: status || null,
  };
  const stablePayload = JSON.stringify({
    accountNumber,
    externalClientId,
    clientProfile,
    status,
    lots: finiteNumber(data.volume_lots ?? data.lots),
    commission: finiteNumber(data.reward_usd ?? data.commission),
    registeredAt: isoDate(data.reg_date ?? data.registered_at),
    lastActivityAt: isoDate(data.trade_fn ?? data.last_activity_at),
  });
  return {
    organization_id: organizationId,
    integration_id: integrationId,
    external_client_id: externalClientId,
    account_number: accountNumber,
    client_profile: clientProfile,
    is_active: status === "active",
    lots: Math.max(0, finiteNumber(data.volume_lots ?? data.lots)),
    commission: finiteNumber(data.reward_usd ?? data.commission),
    commission_currency: currency,
    registered_at: isoDate(data.reg_date ?? data.registered_at),
    last_activity_at: isoDate(data.trade_fn ?? data.last_activity_at),
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
      const { data, error } = await context.supabaseAdmin.rpc("lookup_exness_account", {
        target_user_id: context.userClaims.id,
        target_organization_id: organizationId,
        lookup_value: lookupValue,
      });
      if (error) {
        if (/CRM access is required/i.test(error.message)) return jsonResponse({ message: "حسابك غير مصرح له ببحث الوكالة." }, 403);
        if (/valid brokerage account/i.test(error.message)) return jsonResponse({ message: "اكتب رقم حساب أو معرّف عميل صحيحًا." }, 400);
        return jsonResponse({ message: "تعذّر فحص حساب الوكالة الآن." }, 500);
      }
      return jsonResponse(data?.[0] ?? { integration_ready: false, under_agency: false, is_active: false, last_synced_at: null });
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

    if (action !== "sync_exness_bridge") return jsonResponse({ message: "أمر تكامل غير معروف." }, 400);

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
        base_url: bridgeBaseUrl(),
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
      const token = await bridgeToken();
      const headers = authorizedHeaders(token);
      await bridgeRequest("/api/exness/clients/update", { method: "POST", headers, body: "{}" });
      const payload = await bridgeRequest("/api/exness/clients?page=1&limit=20000&sortBy=last_updated&sortOrder=desc", { headers });
      const rawClients = extractClients(payload);
      const normalizedResults = await Promise.all(rawClients.map((raw) => normalizeAccount(raw, organizationId, integration.id, startedAt)));
      const accounts = normalizedResults.filter((account): account is NormalizedAccount => account !== null);
      for (let offset = 0; offset < accounts.length; offset += SYNC_BATCH_SIZE) {
        const batch = accounts.slice(offset, offset + SYNC_BATCH_SIZE);
        const { error: upsertError } = await context.supabaseAdmin.from("broker_client_accounts")
          .upsert(batch, { onConflict: "integration_id,account_number" });
        if (upsertError) throw new BridgeError(`Account upsert failed: ${upsertError.code}`, "تعذّر حفظ حسابات Exness في النظام الجديد.", 500);
      }

      const completedAt = new Date().toISOString();
      const errorRows = rawClients.length - accounts.length;
      await context.supabaseAdmin.from("broker_sync_runs").update({
        status: "completed",
        fetched_rows: rawClients.length,
        upserted_rows: accounts.length,
        error_rows: errorRows,
        completed_at: completedAt,
      }).eq("id", syncRun.id);
      await context.supabaseAdmin.from("broker_integrations").update({
        status: "ready",
        base_url: bridgeBaseUrl(),
        account_lookup_enabled: true,
        last_sync_at: startedAt,
        last_error: errorRows ? `تم تجاهل ${errorRows} سجل غير صالح.` : null,
      }).eq("id", integration.id);
      await context.supabaseAdmin.from("audit_events").insert({
        organization_id: organizationId,
        actor_id: context.userClaims.id,
        action: "broker.exness_synced",
        entity_type: "broker_integration",
        entity_id: integration.id,
        request_id: UUID_PATTERN.test(requestKey) ? requestKey : null,
        after_data: { fetched_rows: rawClients.length, upserted_rows: accounts.length, error_rows: errorRows },
      });
      return jsonResponse({ sync: { ...syncRun, status: "completed", fetched_rows: rawClients.length, upserted_rows: accounts.length, error_rows: errorRows, completed_at: completedAt } });
    } catch (error) {
      const bridgeError = error instanceof BridgeError ? error : new BridgeError("Unexpected sync failure", "تعذّرت مزامنة Exness الآن.", 500);
      const completedAt = new Date().toISOString();
      await context.supabaseAdmin.from("broker_sync_runs").update({ status: "failed", error_message: bridgeError.publicMessage, completed_at: completedAt }).eq("id", syncRun.id);
      await context.supabaseAdmin.from("broker_integrations").update({ status: "error", account_lookup_enabled: false, last_error: bridgeError.publicMessage }).eq("id", integration.id);
      return jsonResponse({ message: bridgeError.publicMessage }, bridgeError.status);
    }
  },
};
