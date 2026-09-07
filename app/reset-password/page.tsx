import type { Metadata } from "next";
import { ResetPasswordWorkspace } from "../../components/auth/ResetPasswordWorkspace";

export const metadata: Metadata = { title: "استعادة كلمة المرور" };

export default function ResetPasswordPage() {
  return <ResetPasswordWorkspace />;
}
