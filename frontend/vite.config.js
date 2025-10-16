import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  server: {
    host: true,
    port: 3000,
    // Allow access when running behind Docker/Gateway where host header may be 'frontend'
    allowedHosts: ["frontend", "gateway", "localhost", "127.0.0.1"],
  },
  plugins: [react()],
});
