
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
    // Fix for Node.js-specific modules (like async_hooks, fs, tls, net)
    // being incorrectly included in the client-side bundle.
    // By setting them to `false` in `resolve.fallback` for non-server builds,
    // we instruct Webpack (or Turbopack) to treat them as empty modules on the client,
    // preventing "Module not found" errors.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        async_hooks: false,
        fs: false, 
        tls: false,
        net: false, // Add net to fallback
      };
    }

    // Important: return the modified config
    return config;
  },
};

export default nextConfig;

