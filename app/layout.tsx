import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-arabic/wght.css";
import { AppShell } from "../components/layout/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Market Whales OS",
    template: "%s | Market Whales OS",
  },
  description: "نظام تشغيل فريق ماركت ويلز للمحتوى والمشروعات والعملاء.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
