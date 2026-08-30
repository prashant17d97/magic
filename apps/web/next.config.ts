import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Next reads `.env` relative to the app, but in this monorepo one file at the root configures
 * every service. Loading it here keeps a developer from maintaining four copies that drift.
 * Anything already set in the real environment wins, so a deployment is never overridden.
 */
function loadRootEnv(): void {
  const path = join(process.cwd(), '..', '..', '.env');
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    if (key && process.env[key] === undefined) process.env[key] = value?.replace(/^["']|["']$/g, '') ?? '';
  }
}

loadRootEnv();

/**
 * Security headers are set here rather than at the edge so a local run and a production run
 * behave identically. The content security policy is strict: no external script origins, no
 * framing, and no base-uri rewriting, because the console has no need for any of them.
 *
 * `unsafe-eval` is added under `next dev` only. React's development build uses `eval` to rebuild
 * stack traces across environments, and without it every page load reports a policy violation
 * that masks real ones. The production policy never carries it.
 */
const scriptSrc =
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const CSP = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  experimental: { optimizePackageImports: ['@fortawesome/react-fontawesome'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
