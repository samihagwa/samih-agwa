import type { Tables } from "./supabase/database.types";

export const workspaceSectionDefinitions = [
  { id: "dashboard", label: "مركز القيادة", href: "/" },
  { id: "tasks", label: "مهام الفريق", href: "/tasks" },
  { id: "planning", label: "الخطة وتقويم المحتوى", href: "/planning" },
  { id: "content", label: "مصنع المحتوى", href: "/content" },
  { id: "scripts", label: "استوديو الاسكريبتات", href: "/scripts" },
  { id: "publishing", label: "النشر التلقائي", href: "/publishing" },
  { id: "brand", label: "مركز معرفة البراند", href: "/brand" },
  { id: "campaigns", label: "الحملات والإطلاقات", href: "/campaigns" },
  { id: "crm", label: "العملاء والـCRM", href: "/crm" },
  { id: "analytics", label: "النتائج والتحليلات", href: "/analytics" },
  { id: "chat", label: "مجتمع الفريق", href: "/chat" },
  { id: "team", label: "الفريق والصلاحيات", href: "/team" },
  { id: "settings", label: "الإعدادات والتكاملات", href: "/settings" },
] as const;

export type WorkspaceSection = typeof workspaceSectionDefinitions[number]["id"];
export type WorkspaceMembership = Pick<Tables<"memberships">, "organization_id" | "role" | "status" | "allowed_sections" | "onboarding_acknowledgements" | "onboarding_completed_at">;

export const allWorkspaceSections = workspaceSectionDefinitions.map((section) => section.id);

const sectionSet = new Set<string>(allWorkspaceSections);

export const defaultSectionsByRole: Record<Exclude<Tables<"memberships">["role"], "owner">, WorkspaceSection[]> = {
  admin: [...allWorkspaceSections],
  manager: ["tasks", "planning", "chat"],
  member: ["tasks", "chat"],
  viewer: ["tasks", "chat"],
};

export function normalizeWorkspaceSections(values: readonly string[]): WorkspaceSection[] {
  return [...new Set(values)].filter((value): value is WorkspaceSection => sectionSet.has(value));
}

export function membershipSections(membership: WorkspaceMembership): WorkspaceSection[] {
  if (membership.role === "owner") return [...allWorkspaceSections];
  return normalizeWorkspaceSections(membership.allowed_sections);
}

export function canAccessWorkspaceSection(membership: WorkspaceMembership, section: WorkspaceSection) {
  return membership.status === "active"
    && (membership.role === "owner" || membership.allowed_sections.includes(section));
}

export function sectionForPathname(pathname: string): WorkspaceSection {
  if (pathname === "/") return "dashboard";
  return workspaceSectionDefinitions.find((section) => section.href !== "/" && pathname.startsWith(section.href))?.id
    ?? "dashboard";
}

export function firstAllowedSectionHref(membership: WorkspaceMembership) {
  const allowed = membershipSections(membership);
  return workspaceSectionDefinitions.find((section) => allowed.includes(section.id))?.href ?? "/login";
}
