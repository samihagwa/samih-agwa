import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Explicit local fixture only. No backend and no production application route.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: "../../lib/supabase/client", replacement: new URL("./attention-preview-backend.ts", import.meta.url).pathname }] },
  server: { host: "127.0.0.1", port: 4186, strictPort: true },
});
