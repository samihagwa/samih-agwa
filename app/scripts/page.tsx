import type { Metadata } from "next";
import { ScriptsWorkspace } from "../../components/scripts/ScriptsWorkspace";

export const metadata: Metadata = { title: "استوديو الاسكريبتات" };

export default function ScriptsPage() {
  return <main className="page-stack script-library-page">
    <ScriptsWorkspace />
  </main>;
}
