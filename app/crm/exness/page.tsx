import type { Metadata } from "next";
import { CrmSectionNav } from "../../../components/crm/CrmSectionNav";
import { ExnessAgencyWorkspace } from "../../../components/crm/ExnessAgencyWorkspace";

export const metadata: Metadata = { title: "حسابات وكالة Exness" };

export default function ExnessAgencyPage() {
  return (
    <main className="page-stack">
      <CrmSectionNav />
      <ExnessAgencyWorkspace />
    </main>
  );
}
