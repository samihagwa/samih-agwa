import type { Metadata } from "next";
import { CrmCustomerDirectory } from "../../../components/crm/CrmCustomerDirectory";
import { CrmSectionNav } from "../../../components/crm/CrmSectionNav";

export const metadata: Metadata = { title: "دليل العملاء" };

export default function CrmCustomersPage() {
  return (
    <main className="page-stack">
      <CrmSectionNav />
      <CrmCustomerDirectory />
    </main>
  );
}
