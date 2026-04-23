import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare(), react()],
  resolve: {
    dedupe: [
      "tldraw",
      "@tldraw/sync",
      "@tldraw/sync-core",
      "@tldraw/editor",
      "@tldraw/store",
      "@tldraw/tlschema",
      "@tldraw/validate",
      "@tldraw/state",
      "@tldraw/state-react",
      "@tldraw/utils",
    ],
  },
  // server: {
  //   host: "0.0.0.0",
  //   allowedHosts: true,
  // },
  // preview: {
  //   host: "0.0.0.0",
  //   allowedHosts: true,
  // },
});
