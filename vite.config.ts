import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const roomOrigin = env.VITE_ROOM_ORIGIN || "https://localhost:4433";
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self' ${roomOrigin}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");

  return {
    plugins: [react()],
    server: {
      headers: {
        "Content-Security-Policy": csp,
        "Cross-Origin-Opener-Policy": "same-origin",
        "Permissions-Policy": "camera=(self), microphone=(self), display-capture=()",
        "Referrer-Policy": "no-referrer"
      }
    },
    preview: { headers: { "Content-Security-Policy": csp } },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      coverage: { reporter: ["text", "json-summary"] }
    }
  };
});
