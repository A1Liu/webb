class WasmChunksFixPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("WasmChunksFixPlugin", (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: "WasmChunksFixPlugin" },
        (assets) =>
          Object.entries(assets).forEach(([pathname, source]) => {
            if (!pathname.match(/\.wasm$/)) return;
            compilation.deleteAsset(pathname);

            const name = pathname.split("/")[1];
            const info = compilation.assetsInfo.get(pathname);
            compilation.emitAsset(name, source, info);
          }),
      );
    });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  distDir: "out",
  webpack: (config, { isServer, dev }) => {
    if (!dev && isServer) {
      config.output.webassemblyModuleFilename = "chunks/[id].wasm";
      config.plugins.push(new WasmChunksFixPlugin());
    }

    return {
      ...config,
      experiments: {
        asyncWebAssembly: true,
        syncWebAssembly: true,
        layers: true,
      },
      optimization: {
        ...config.optimization,
        moduleIds: "named",
      },
      output: {
        ...config.output,
        // webassemblyModuleFilename: isServer
        //   ? "./../static/wasm/[modulehash].wasm"
        //   : "static/wasm/[modulehash].wasm",
      },
    };
  },

  // For when things are confusing, and you just need to make sure double-effects
  // aren't fucking with mutation frequency
  // reactStrictMode: false,
};

export default nextConfig;
