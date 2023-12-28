import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/kit/vite";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://kit.svelte.dev/docs/integrations#preprocessors
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter(),
    files: {
      lib: "components",
      params: "params",
      routes: "routes",
      appTemplate: "app.html",
      errorTemplate: "error.html",
    },
  },
};

export default config;
