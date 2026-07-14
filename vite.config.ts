/// <reference types="vitest/config" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Local Claude worktrees mirror the repository and otherwise make Vitest
    // discover every suite twice (and occasionally exhaust the worker pool).
    exclude: ["**/node_modules/**", "**/.git/**", "**/.claude/worktrees/**"],
  },
  server: {
    proxy: {
      // forward collector API to the Node server (npm run server, port 8787)
      "/api": {
        target: "http://localhost:8787",
        // Preserve the browser Host so the public sign-in handler can enforce
        // its same-origin Origin/Host check in local development too.
        changeOrigin: false,
      },
    },
  },
});
