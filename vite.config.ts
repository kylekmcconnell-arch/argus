import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // forward collector API to the Node server (npm run server, port 8787)
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
