import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["dist/**", "node_modules/**"],
  },
  staged: {
    "*": "vp check --fix",
  },
  plugins: [
    {
      name: "options-dev-url",
      configureServer(server) {
        if (process.env.VITE_MOCK_EXTENSION !== "true") {
          return;
        }

        const printUrls = server.printUrls;
        server.printUrls = () => {
          const urls = server.resolvedUrls;
          if (!urls) {
            printUrls();
            return;
          }

          for (const url of urls.local) {
            console.info(`  ➜  Local:   ${url}src/options.html`);
          }
          for (const url of urls.network) {
            console.info(`  ➜  Network: ${url}src/options.html`);
          }
        };
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        popup: "src/popup.html",
        options: "src/options.html",
        background: "src/background.ts",
        content: "src/content.ts",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
