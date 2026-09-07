import type { Metadata } from "next";
import { ContentFileWorkspace } from "../../../../components/content/ContentFileWorkspace";

export const metadata: Metadata = { title: "ملف المحتوى" };

export default async function ContentFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="page-stack"><ContentFileWorkspace contentId={id} /></main>;
}
