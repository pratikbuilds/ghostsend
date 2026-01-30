import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "wsrv.nl",
      },
    ],
  },
  // Use Turbopack with resolve aliases for browser polyfills
  // Note: These aliases apply to both client and server code in Turbopack
  // For API routes, we rely on Node.js built-ins being available
  turbopack: {
    resolveAlias: {
      // Only alias for client-side, server can use Node.js crypto
      // Unfortunately Turbopack doesn't support conditional aliases yet
      // So we comment these out and handle polyfills differently
      // crypto: "crypto-browserify",
      stream: "stream-browserify",
      buffer: "buffer/",
      path: "path-browserify",
    },
  },
  // Webpack config for production builds and WASM handling
  webpack: (config, { isServer }) => {
    // Handle WASM files
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // Add rule to handle WASM files, excluding wasm-bindgen generated files
    config.module.rules.push({
      test: /\.wasm$/,
      exclude: /(@lightprotocol|hasher\.rs)/,
      type: "webassembly/async",
    });

    // Mark @lightprotocol/hasher.rs as external on server to avoid WASM bundling issues
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "@lightprotocol/hasher.rs": "commonjs @lightprotocol/hasher.rs",
      });
    }

    if (!isServer) {
      // Polyfill Node.js modules for browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: require.resolve("crypto-browserify"),
        stream: require.resolve("stream-browserify"),
        buffer: require.resolve("buffer/"),
        path: require.resolve("path-browserify"),
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        readline: false,
        worker_threads: false,
      };
    }
    return config;
  },
};

export default nextConfig;
