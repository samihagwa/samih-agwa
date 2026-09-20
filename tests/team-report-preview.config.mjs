import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], resolve: { alias: [
  { find: "../../lib/supabase/client", replacement: new URL("./team-report-preview-backend.ts", import.meta.url).pathname },
  { find: "next/navigation", replacement: new URL("./team-report-preview-navigation.ts", import.meta.url).pathname },
] }, server: { host: "127.0.0.1", port: 4189, strictPort: true } });
