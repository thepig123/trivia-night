import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  preview: { proxy: { "/api": process.env.TRIVIA_BACKEND_URL ?? "http://127.0.0.1:8080", "/media": process.env.TRIVIA_BACKEND_URL ?? "http://127.0.0.1:8080" } },
  server: {
    port: 5173,
    proxy: { "/api": process.env.TRIVIA_BACKEND_URL ?? "http://127.0.0.1:8080", "/media": process.env.TRIVIA_BACKEND_URL ?? "http://127.0.0.1:8080" },
  },
});
