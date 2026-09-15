import type { Metadata } from "next";
import { ContentWorkspace } from "../../components/content/ContentWorkspace";

export const metadata: Metadata = { title: "طلبات التنفيذ" };

export default function ContentPage() {
  return (
    <main className="page-stack">
      <ContentWorkspace />
    </main>
  );
}
