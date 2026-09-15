/** @type {import('next').NextConfig} */
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  // A service worker in dev shadows HMR and serves stale chunks.
  disable: process.env.NODE_ENV === "development",
  buildExcludes: [/middleware-manifest\.json$/],
  runtimeCaching: [
    {
      // App shell / navigations: prefer network so auth redirects stay correct,
      // fall back to cache so the PWA still opens offline.
      urlPattern: ({ request }) => request.mode === "navigate",
      handler: "NetworkFirst",
      options: {
        cacheName: "nofikar-pages",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    {
      urlPattern: /\.(?:js|css|woff2?)$/i,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "nofikar-static" },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: "CacheFirst",
      options: {
        cacheName: "nofikar-images",
        expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      // OpenStreetMap tiles: cache so a previously viewed area still renders
      // offline instead of showing blank grey squares.
      urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "osm-tiles",
        expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
      },
    },
    {
      // Never cache Supabase auth or data calls — stale location data would be
      // actively misleading in a safety product.
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
      handler: "NetworkOnly",
    },
  ],
});

const nextConfig = {
  reactStrictMode: true,
};

module.exports = withPWA(nextConfig);
