/** @type {import('next').NextConfig} */
const nextConfig = {
  // @node-rs/argon2 ships a native .node binary. Keep it external on the
  // server so webpack never tries to parse the .node file. serverExternalPackages
  // is the official hook; the webpack externals fallback covers dev-mode edge
  // cases where the RSC layer still attempts to bundle it.
  serverExternalPackages: ['@node-rs/argon2'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [...existing, '@node-rs/argon2'];
    }
    return config;
  },
};

module.exports = nextConfig;
