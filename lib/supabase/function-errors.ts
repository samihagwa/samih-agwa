import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

type ErrorPayload = {
  error?: unknown;
  message?: unknown;
};

export async function getSupabaseFunctionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json() as ErrorPayload;
      const message = typeof payload.message === "string"
        ? payload.message.trim()
        : typeof payload.error === "string"
          ? payload.error.trim()
          : "";
      return message || fallback;
    } catch {
      return fallback;
    }
  }

  if (error instanceof FunctionsRelayError) {
    return "خدمة التنفيذ غير متاحة مؤقتًا. جرّب مرة أخرى بعد قليل.";
  }

  if (error instanceof FunctionsFetchError) {
    return "تعذّر الاتصال بخدمة التنفيذ. تحقق من الإنترنت ثم أعد المحاولة.";
  }

  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
