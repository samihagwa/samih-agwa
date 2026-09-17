import type { Tables } from "../lib/supabase/database.types";
type Page = Tables<"script_pages">;
const pages: Page[] = [];
export function getSupabaseBrowserClient() {
  return {
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [...pages], error: null }) }) }) }) }),
    rpc: (_name: string, args: { page_id: string; target_script_id: string; parent_page_id: string | null; page_title: string; page_body: string; expected_version: number }) => ({ single: async () => {
      const page: Page = { id: args.page_id, script_id: args.target_script_id, parent_id: args.parent_page_id, title: args.page_title, body: args.page_body, edit_version: args.expected_version + 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const index = pages.findIndex((item) => item.id === page.id); if (index < 0) pages.push(page); else pages[index] = page;
      return { data: page, error: null };
    } }),
  };
}
