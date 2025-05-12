
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
  webpack: (config, { isServer, webpack: webpackInstance }) => { // Destructure webpackInstance from options
    // Fix for Node.js-specific modules (like async_hooks, fs, tls, net, http2, dns, perf_hooks)
    // being incorrectly included in the client-side bundle.
    if (!isServer) {
      // Ensure config.plugins exists
      config.plugins = config.plugins || [];

      // Add NormalModuleReplacementPlugin to strip 'node:' prefix from requests
      // This allows fallbacks for the base module name (e.g., 'async_hooks') to work.
      config.plugins.push(
        new webpackInstance.NormalModuleReplacementPlugin(
          /^node:(.*)/,
          (resource) => {
            // Remove the 'node:' prefix
            resource.request = resource.request.substring('node:'.length);
          }
        )
      );

      // Define fallbacks for Node.js core modules.
      // After the NormalModuleReplacementPlugin strips 'node:', these fallbacks will apply.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'async_hooks': false,
        'fs': false,
        'tls': false,
        'net': false,
        'http2': false,
        'dns': false,
        'perf_hooks': false, // Added perf_hooks
        // Keep fallbacks for 'node:*' prefixed modules as a safeguard,
        // though they might be less effective if the plugin always transforms them first.
        'node:async_hooks': false,
        'node:fs': false,
        'node:tls': false,
        'node:net': false,
        'node:http2': false,
        'node:dns': false,
        'node:perf_hooks': false, // Added node:perf_hooks
      };
    }

    // Important: return the modified config
    return config;
  },
};

export default nextConfig;

