import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const root = path.resolve(process.cwd(), "../..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No root .env: the environment is provided by the host.
}
process.env.MEDIA_DIR = path.resolve(root, process.env.MEDIA_DIR || "media");
process.env.SANDBOX_DIR = path.resolve(root, process.env.SANDBOX_DIR || "sandbox");

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["scene"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
