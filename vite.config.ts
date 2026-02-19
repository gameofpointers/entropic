import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",  // Bind to all interfaces (needed for Docker)
    port: 5174,
    strictPort: true,
    allowedHosts: ["host.docker.internal", "localhost", "127.0.0.1"],
    proxy: {
      // Dev-only API proxy to avoid CORS/origin issues when UI runs at http://localhost:5174
      "/api": {
        target: "https://entropic.qu.ai",
        changeOrigin: true,
        secure: true,
      },
    },
    watch: {
      ignored: [
        "**/src-tauri/target/**",
        "**/src-tauri/target-*/*",
      ],
    },
  },
  // Tauri expects a fixed port
  clearScreen: false,
});
