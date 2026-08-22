import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const allowedRoles = new Set(["admin", "manager", "member", "viewer"]);
const allowedMembershipStatuses = new Set(["active", "suspended"]);
const allowedOnboardingSteps = new Set(["role", "workflow", "brand"]);
const allowedSections = new Set([
  "dashboard", "tasks", "planning", "content", "scripts", "publishing",
  "brand", "campaigns", "crm", "analytics", "team", "settings",
  "chat",
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanSections(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanString).filter((section) => allowedSections.has(section)))];
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function safeErrorMessage(message: string, fallback: string) {
  const known = [
    "Only the active organization owner", "Enter a valid work email", "Enter a valid email address",
    "Enter the team member name", "Owner access cannot", "Invitation expiry",
    "This email already belongs", "Invitation was not found", "Invitation link is invalid",
    "Sign in with the same email", "already belongs to another", "account is suspended",
    "Team membership was not found", "workspace owner access cannot",
    "Reassign or close", "Reassign or archive", "Active organization membership",
    "Unknown onboarding step", "Choose at least one valid workspace section",
  ];
  return known.some((part) => message.includes(part)) ? message : fallback;
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    const actorId = context?.userClaims?.id;
    const actorEmail = cleanString(context?.userClaims?.email).toLowerCase();
    if (authError || !actorId) return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);

    let body: Record<string, unknown>;
    try {
      body = asRecord(await request.json());
    } catch {
      return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400);
    }

    const action = cleanString(body.action);
    const organizationId = cleanString(body.organization_id);

    if (action === "create_invitation") {
      const email = cleanString(body.email).toLowerCase();
      const fullName = cleanString(body.full_name);
      const role = cleanString(body.role);
      const sections = cleanSections(body.allowed_sections);
      const expiresInDays = Number(body.expires_in_days ?? 7);
      if (!organizationId || !email || !fullName || !allowedRoles.has(role) || !sections.length) {
        return jsonResponse({ message: "أكمل اسم العضو وبريده ودوره واختر قسمًا واحدًا على الأقل." }, 400);
      }
      if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 14) {
        return jsonResponse({ message: "مدة الرابط يجب أن تكون من يوم إلى 14 يومًا." }, 400);
      }

      const token = randomToken();
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await context.supabaseAdmin.rpc("create_team_invitation_with_sections", {
        target_actor_id: actorId,
        target_organization_id: organizationId,
        target_email: email,
        target_full_name: fullName,
        target_role: role,
        target_allowed_sections: sections,
        plain_token: token,
        target_expires_at: expiresAt,
      });
      if (error) return jsonResponse({ message: safeErrorMessage(error.message, "تعذّر إنشاء رابط الدعوة.") }, 400);
      return jsonResponse({ invitation_id: data, token, expires_at: expiresAt }, 201);
    }

    if (action === "revoke_invitation") {
      const invitationId = cleanString(body.invitation_id);
      if (!invitationId) return jsonResponse({ message: "حدد الدعوة المطلوب إلغاؤها." }, 400);
      const { data, error } = await context.supabaseAdmin.rpc("revoke_team_invitation", {
        target_actor_id: actorId,
        target_invitation_id: invitationId,
      });
      if (error) return jsonResponse({ message: safeErrorMessage(error.message, "تعذّر إلغاء الدعوة.") }, 400);
      return jsonResponse({ revoked: data });
    }

    if (action === "accept_invitation") {
      const token = cleanString(body.token);
      if (!token || !actorEmail) return jsonResponse({ message: "رابط الدعوة أو بريد الحساب غير صالح." }, 400);
      const { data, error } = await context.supabaseAdmin.rpc("accept_team_invitation", {
        target_user_id: actorId,
        target_email: actorEmail,
        plain_token: token,
      });
      if (error) return jsonResponse({ message: safeErrorMessage(error.message, "تعذّر تفعيل عضوية الفريق.") }, 400);
      return jsonResponse({ organization_id: data });
    }

    if (action === "update_member") {
      const userId = cleanString(body.user_id);
      const role = cleanString(body.role);
      const status = cleanString(body.status);
      const sections = cleanSections(body.allowed_sections);
      if (!organizationId || !userId || !allowedRoles.has(role) || !allowedMembershipStatuses.has(status) || !sections.length) {
        return jsonResponse({ message: "بيانات العضو أو الصلاحية غير صالحة." }, 400);
      }
      const { data, error } = await context.supabaseAdmin.rpc("manage_team_membership_access", {
        target_actor_id: actorId,
        target_organization_id: organizationId,
        target_user_id: userId,
        target_role: role,
        target_status: status,
        target_allowed_sections: sections,
      });
      if (error) return jsonResponse({ message: safeErrorMessage(error.message, "تعذّر تحديث صلاحية العضو.") }, 400);
      return jsonResponse({ updated: data });
    }

    if (action === "acknowledge_onboarding") {
      const step = cleanString(body.step);
      if (!organizationId || !allowedOnboardingSteps.has(step)) {
        return jsonResponse({ message: "خطوة التعريف غير صالحة." }, 400);
      }
      const { data, error } = await context.supabaseAdmin.rpc("acknowledge_team_onboarding", {
        target_user_id: actorId,
        target_organization_id: organizationId,
        target_step: step,
      });
      if (error) return jsonResponse({ message: safeErrorMessage(error.message, "تعذّر حفظ خطوة التعريف.") }, 400);
      return jsonResponse({ updated: data });
    }

    return jsonResponse({ message: "أمر الفريق غير معروف." }, 400);
  },
};
