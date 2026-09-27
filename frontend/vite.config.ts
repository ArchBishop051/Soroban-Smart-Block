import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPluginPkg from "vite-plugin-monaco-editor";
const monacoEditorPlugin = monacoEditorPluginPkg.default || monacoEditorPluginPkg;

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({
      languageWorkers: ["editorWorkerService", "typescript", "json", "css", "html"],
    }),
  ],
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks for better caching
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
          "stellar-vendor": ["@stellar/stellar-sdk", "@stellar/freighter-api"],
          "monaco-vendor": ["monaco-editor", "monaco-editor-workers"],
          "viz-vendor": ["3d-force-graph", "cytoscape", "react-flow-renderer"],
          "webcontainer-vendor": ["@webcontainer/api"],
        },
      },
    },
    // Bundle size budgets - fail if exceeded
    chunkSizeWarningLimit: 500,
    reportCompressedSize: true,
  },
  server: { proxy: { "/api": "http://localhost:3001" } },
  test: { environment: "jsdom", globals: true, setupFiles: [] },
});
