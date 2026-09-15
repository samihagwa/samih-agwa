import type { Metadata } from "next";
import { ScriptEditor } from "../../../components/scripts/ScriptEditor";

export const metadata: Metadata = { title: "محرر الاسكريبت" };

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="page-stack script-document-page">
    <ScriptEditor scriptId={id} />
  </main>;
}
