import { ogOrigin } from '@/lib/og-image';
import { robotsTxt } from '@/lib/seo';

/** `robots.txt` (landing-seo): правила — `lib/seo.ts`; `Sitemap` — от `WEB_ORIGIN`. */
export function GET(): Response {
  return new Response(robotsTxt(ogOrigin()), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
