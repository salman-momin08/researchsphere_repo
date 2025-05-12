
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // Fix for Node.js-specific modules (like async_hooks, fs, tls, net, http2, dns)
    // being incorrectly included in the client-side bundle.
    // By setting them to `false` in `resolve.fallback` for non-server builds,
    // we instruct Webpack (or Turbopack) to treat them as empty modules on the client,
    // preventing "Module not found" errors.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'async_hooks': false,
        'node:async_hooks': false, // Added to handle "node:async_hooks"
        'fs': false,
        'node:fs': false,          // Added for consistency
        'tls': false,
        'node:tls': false,         // Added for consistency
        'net': false,
        'node:net': false,         // Added for consistency
        'http2': false,
        'node:http2': false,       // Added for consistency
        'dns': false,
        'node:dns': false,         // Added for consistency
      };
    }

    // Important: return the modified config
    return config;
  },
};

export default nextConfig;




