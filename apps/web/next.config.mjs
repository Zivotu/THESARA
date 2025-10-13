import process from 'node:process';

const isStaticExport = process.env.NEXT_OUTPUT === 'export';
const SAFE_PUBLISH_ENABLED = process.env.SAFE_PUBLISH_ENABLED === 'true';
const isDev = process.env.NODE_ENV !== 'production';
const API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:8788';

/** @type {import('next').NextConfig} */
const baseConfig = {
  ...(isStaticExport ? { output: 'export' } : {}),
  reactStrictMode: true,
  trailingSlash: false,
  images: {
    unoptimized: true,
  },
  env: {
    SAFE_PUBLISH_ENABLED: process.env.SAFE_PUBLISH_ENABLED,
    SANDBOX_SUBDOMAIN_ENABLED: process.env.SANDBOX_SUBDOMAIN_ENABLED,
    ROOMS_ENABLED: process.env.ROOMS_ENABLED,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_STRIPE_PK:
      process.env.NEXT_PUBLIC_STRIPE_PK ?? process.env.STRIPE_PUBLISHABLE_KEY,
  },
  async rewrites() {
    if (isStaticExport) {
      return [];
    }
    return [
      // Proxy app routes to the API server for same-origin iframe loading
      { source: '/app/:path*', destination: `${API_URL}/app/:path*` },

      // Static player assets served by API (ensures frontend 3000 can open /builds/* URLs)
      { source: '/builds/:path*', destination: `${API_URL}/builds/:path*` },
      { source: '/review/builds/:path*', destination: `${API_URL}/review/builds/:path*` },
      { source: '/public/builds/:path*', destination: `${API_URL}/public/builds/:path*` },
      { source: '/play-wrapper.js', destination: `${API_URL}/play-wrapper.js` },
      { source: '/play.css', destination: `${API_URL}/play.css` },
      { source: '/api/health', destination: `${API_URL}/health` },
      { source: '/api/listings', destination: `${API_URL}/listings` },
      { source: '/api/listing/:path*', destination: `${API_URL}/listing/:path*` },
      { source: '/api/oglasi', destination: `${API_URL}/oglasi` },
      { source: '/api/avatar/:path*', destination: `${API_URL}/avatar/:path*` },
      { source: '/api/review/:path*', destination: `${API_URL}/review/:path*` },
      { source: '/billing/:path*', destination: `${API_URL}/billing/:path*` },
      { source: '/api/:path*', destination: `${API_URL}/:path*` },
      // Fix browsers requesting relative favicon on nested routes (/u/favicon.ico, /creators/favicon.ico)
      { source: '/:segment/favicon.ico', destination: '/favicon.ico' },
    ];
  },
};

if (SAFE_PUBLISH_ENABLED && isDev) {
  baseConfig.assetPrefix = '/assets';
}

let config = baseConfig;
try {
  const { withSitemap } = await import('next-sitemap');
  if (typeof withSitemap === 'function') {
    config = withSitemap({
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com',
      generateRobotsTxt: false,
    })(baseConfig);
  }
} catch {
  // next-sitemap not installed
}

export default config;
