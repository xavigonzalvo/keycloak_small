import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/node-app/",
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/login": "http://localhost:3000",
      "/callback": "http://localhost:3000",
      "/logout": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
