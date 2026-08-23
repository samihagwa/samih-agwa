import type { Metadata } from "next";
import { CrmCustomerWorkspace } from "../../../components/crm/CrmCustomerWorkspace";

export const metadata: Metadata = { title: "ملف العميل" };

export default async function CrmCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="page-stack"><CrmCustomerWorkspace contactId={id} /></main>;
}
