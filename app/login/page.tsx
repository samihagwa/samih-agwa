import type { Metadata } from "next";
import { LoginWorkspace } from "../../components/auth/LoginWorkspace";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default function LoginPage() {
  return <LoginWorkspace />;
}

