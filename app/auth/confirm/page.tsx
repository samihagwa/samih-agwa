import type { Metadata } from "next";
import { AuthConfirmWorkspace } from "../../../components/auth/AuthConfirmWorkspace";

export const metadata: Metadata = { title: "تأكيد تسجيل الدخول" };

export default function AuthConfirmPage() {
  return <AuthConfirmWorkspace />;
}
