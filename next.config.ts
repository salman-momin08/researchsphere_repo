
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
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer, webpack: webpackInstance }) => { 
    if (!isServer) {
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpackInstance.NormalModuleReplacementPlugin(
          /^node:(.*)/,
          (resource) => {
            resource.request = resource.request.substring('node:'.length);
          }
        )
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'async_hooks': false,
        'fs': false,
        'tls': false,
        'net': false,
        'http2': false,
        'dns': false,
        'perf_hooks': false,
        'node:async_hooks': false,
        'node:fs': false,
        'node:tls': false,
        'node:net': false,
        'node:http2': false,
        'node:dns': false,
        'node:perf_hooks': false,
      };
    }
    return config;
  },
};

export default nextConfig;
