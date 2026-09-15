import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Explicit standalone local fixture. Not registered as an application route and has no backend.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: "../../lib/supabase/client", replacement: new URL("./content-preview-backend.ts", import.meta.url).pathname }] },
  server: { host: "127.0.0.1", port: 4175, strictPort: true },
});
