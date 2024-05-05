import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/** @type {import('vite').UserConfig} */
export default defineConfig({
  root: "./app",
  plugins: [react(), tsconfigPaths()],
   build: {
    commonjsOptions: {
      include: [/ui-shared/],
    },
  },
});
