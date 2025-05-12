
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
    // Fix for 'async_hooks' module not found error.
    // This error typically occurs when a Node.js-specific module (like async_hooks,
    // often used by tracing libraries such as OpenTelemetry) is incorrectly
    // included in the client-side bundle.
    // By setting `async_hooks: false` in `resolve.fallback` for non-server builds,
    // we instruct Webpack (or Turbopack, which respects this config) to treat
    // `async_hooks` as an empty module on the client, preventing the error.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        async_hooks: false,
      };
    }

    // Important: return the modified config
    return config;
  },
};

export default nextConfig;
