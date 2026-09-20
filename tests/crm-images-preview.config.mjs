import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],optimizeDeps:{entries:['tests/crm-images-preview.html']},resolve:{alias:[{find:'../../lib/supabase/client',replacement:new URL('./crm-images-preview-backend.ts',import.meta.url).pathname}]},server:{host:'127.0.0.1',port:4190,strictPort:true}});
