const fs = require('fs');
const crypto = require('crypto');

// Content-hash the offline fallback page so a changed offline.html automatically
// gets a NEW precache revision. A fixed revision string would serve the stale
// copy to existing installs forever — this way the service worker refresh picks
// it up on the next build.
const offlineHtmlPath = 'public/offline.html';
const offlineRevision = fs.existsSync(offlineHtmlPath)
  ? crypto.createHash('sha256').update(fs.readFileSync(offlineHtmlPath)).digest('hex').slice(0, 8)
  : 'offline';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // -------------------------------------------------------------------------
  // Security headers (audit 4.1–4.6) — applied to every response.
  //
  // CSP notes:
  //  - script-src 'unsafe-inline' is required by the inline theme-bootstrap
  //    script in src/app/layout.tsx (and by Next.js hydration inlines).
  //    A nonce-based CSP is a tracked follow-up in progress.md (fix 2.3).
  //  - style-src 'unsafe-inline' is required because the UI uses inline
  //    style="" attributes throughout (neo-brutalist design system).
  //  - Google Fonts (layout.tsx <link>) needs fonts.googleapis.com (style)
  //    and fonts.gstatic.com (font).
  //  - dev mode needs 'unsafe-eval' for webpack HMR.
  // -------------------------------------------------------------------------
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';

    const csp = [
      "default-src 'self'",
      isProd ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // Clickjacking (audit 4.2) — belt-and-suspenders with frame-ancestors.
          { key: 'X-Frame-Options', value: 'DENY' },
          // MIME sniffing (audit 4.3).
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // HSTS (audit 4.4) — explicit so the app is correct independent of host.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          // Referrer policy (audit 4.5) — tokens must never leak via Referer.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Permissions policy (audit 4.6) — deny features the product doesn't use.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        ],
      },
    ];
  },
};

const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  // Offline support (Part 2): serve the self-contained fallback page ONLY when
  // a navigation actually fails (offline + nothing cached). Uses next-pwa's
  // `fallbacks` option, which attaches a handlerDidError fallback to the
  // caching strategies instead of a blanket navigation route. The key must be
  // `document` — the fallback worker dispatches on request.destination, and
  // page navigations arrive as destination "document" (v10 has no `navigate`
  // key; `fallbacks: { navigate: ... }` is silently ignored).
  //
  // NOTE: workbox's `navigateFallback` was deliberately removed — it generates
  // a NavigationRoute(createHandlerBoundToURL('/offline.html')) that shadows
  // EVERY navigation with offline.html even while online, because App Router
  // HTML routes are never precached (only _next/static hashes are). Verified
  // live on the deployed site: every reload/deep-link showed the offline page.
  fallbacks: { document: '/offline.html' },
  workboxOptions: {
    // Precache the self-contained fallback page so it's available offline.
    additionalManifestEntries: [{ url: '/offline.html', revision: offlineRevision }],
  },
});

module.exports = withPWA(nextConfig);
