import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a Node.js global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('@codemirror') || id.includes('@uiw/react-codemirror') || id.includes('lezer')) {
            return 'codemirror';
          }

          if (id.includes('@dnd-kit')) {
            return 'dnd-kit';
          }

          if (id.includes('react-resizable-panels')) {
            return 'layout';
          }

          if (id.includes('react-virtuoso')) {
            return 'virtuoso';
          }

          if (
            /[\\/]react[\\/]/.test(id) ||
            /[\\/]react-dom[\\/]/.test(id) ||
            /[\\/]scheduler[\\/]/.test(id) ||
            /[\\/]use-sync-external-store[\\/]/.test(id)
          ) {
            return 'react-vendor';
          }

          if (id.includes('@tauri-apps')) {
            return 'tauri';
          }
        },
      },
    },
  },
}));
