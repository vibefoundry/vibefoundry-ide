import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    strictPort: false
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020"
  }
});
