import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/runs": "http://localhost:8000",
      "/opportunities": "http://localhost:8000",
      "/lessons": "http://localhost:8000",
      "/prompts": "http://localhost:8000",
    },
  },
});
