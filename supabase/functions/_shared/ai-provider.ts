export type AiProtocol = "openai_chat_completions" | "openai_responses";

export type AiProviderRuntime = {
  id: string;
  name: string;
  protocol: AiProtocol;
  base_url: string;
  model: string;
  api_key: string;
};

const blockedHostSuffixes = [".localhost", ".local", ".internal", ".home", ".lan"];

function isBlockedIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((value) => value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

function isBlockedIpv6(hostname: string) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!value.includes(":")) return false;
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")
    || /^fe[89ab]/.test(value) || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.")
    || value.startsWith("::ffff:192.168.");
}

export function normalizePublicHttpsBaseUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 500) throw new Error("اكتب رابط API صالحًا.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("رابط API غير صالح."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("رابط API يجب أن يكون HTTPS بدون بيانات دخول أو query parameters.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix))
    || isBlockedIpv4(hostname) || isBlockedIpv6(hostname) || /^\d+$/.test(hostname) || /^0x/i.test(hostname)) {
    throw new Error("هذا العنوان الداخلي غير مسموح به لحماية النظام.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function parseProviderRuntime(value: unknown): AiProviderRuntime | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const protocol = item.protocol;
  if (protocol !== "openai_chat_completions" && protocol !== "openai_responses") return null;
  const runtime = {
    id: typeof item.id === "string" ? item.id : "",
    name: typeof item.name === "string" ? item.name : "",
    protocol,
    base_url: typeof item.base_url === "string" ? item.base_url : "",
    model: typeof item.model === "string" ? item.model : "",
    api_key: typeof item.api_key === "string" ? item.api_key : "",
  };
  return Object.values(runtime).every(Boolean) ? runtime : null;
}

export function providerEndpoint(provider: Pick<AiProviderRuntime, "base_url" | "protocol">) {
  const baseUrl = normalizePublicHttpsBaseUrl(provider.base_url);
  return `${baseUrl}/${provider.protocol === "openai_responses" ? "responses" : "chat/completions"}`;
}

export function extractProviderText(response: Record<string, unknown>, protocol: AiProtocol) {
  if (protocol === "openai_chat_completions") {
    const choices = response.choices;
    if (!Array.isArray(choices)) return "";
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return "";
    return message.content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return (item.type === "text" || item.type === "output_text") && typeof item.text === "string" ? item.text : "";
    }).filter(Boolean).join("\n");
  }
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return "";
  for (const output of response.output) {
    if (!output || typeof output !== "object") continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as Record<string, unknown>).type === "output_text"
        && typeof (part as Record<string, unknown>).text === "string") {
        return String((part as Record<string, unknown>).text);
      }
    }
  }
  return "";
}

export function stripJsonFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function fetchProviderJson(
  provider: AiProviderRuntime,
  body: Record<string, unknown>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(providerEndpoint(provider), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    let json: Record<string, unknown> = {};
    try { json = await response.json() as Record<string, unknown>; } catch { /* no provider body needed */ }
    return { response, json, requestId };
  } finally {
    clearTimeout(timeout);
  }
}

export function safeProviderFailure(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "انتهت مهلة الاتصال بالمزوّد.";
  return "تعذّر الاتصال بالمزوّد. راجع الرابط والموديل والمفتاح.";
}
