import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "desktop"),
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    outDir: resolve(__dirname, "dist-desktop"),
    emptyOutDir: true,
    target: "safari13",
  },
  plugins: [react()],
});
