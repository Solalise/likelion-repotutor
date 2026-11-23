import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Next supplies the server-only marker during bundling. Node tests use Next's
  // own server implementation; these aliases never affect the application build.
  resolve: { alias: {
    "@": path.resolve(__dirname, "src"),
    "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    "next/server": path.resolve(__dirname, "node_modules/next/server.js"),
    "next/headers": path.resolve(__dirname, "node_modules/next/headers.js"),
    "next/navigation": path.resolve(__dirname, "node_modules/next/navigation.js"),
  } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"], maxWorkers: 2,
    server: { deps: { inline: ["next-auth"] } },
  },
});
