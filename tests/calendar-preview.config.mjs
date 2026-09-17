import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const backend=new URL("./calendar-preview-backend.ts",import.meta.url).pathname;
export default defineConfig({plugins:[react()],resolve:{alias:[{find:"../../lib/supabase/client",replacement:backend},{find:"./client",replacement:backend}]},server:{host:"127.0.0.1",port:4187,strictPort:true}});
