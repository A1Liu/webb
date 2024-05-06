import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import wasmPlugin from "vite-plugin-wasm";

/** @type {import('vite').UserConfig} */
export default defineConfig({
  plugins: [react(), tsconfigPaths(), wasmPlugin()],
  build: {
    target: "esnext",
    commonjsOptions: {
      // include: [],
      exclude: [/@a1liu\/webb-ui-shared/],
    },
  },
});
