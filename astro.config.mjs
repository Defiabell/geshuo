// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { lastmodOf } from './src/lib/git-dates.mjs';
import { sourcesForPath } from './src/lib/seo.ts';

// The sitemap library rewrites every lastmod as a full ISO timestamp
// (2026-09-07T00:00:00.000Z). Ours are commit *dates*, so the midnight-UTC
// time is noise; trim it back to YYYY-MM-DD after the files are written.
// Must come after sitemap() in `integrations` so its build:done runs later.
/** @returns {import('astro').AstroIntegration} */
const dateOnlyLastmod = () => ({
  name: 'sitemap-lastmod-date-only',
  hooks: {
    'astro:build:done'({ dir }) {
      const out = fileURLToPath(dir);
      for (const name of readdirSync(out)) {
        if (!/^sitemap-\d+\.xml$/.test(name)) continue;
        const file = resolve(out, name);
        writeFileSync(file, readFileSync(file, 'utf8')
          .replace(/(<lastmod>\d{4}-\d{2}-\d{2})T00:00:00\.000Z(<\/lastmod>)/g, '$1$2'));
      }
    },
  },
});

// 正式地址。geshuo.pages.dev 仍在服务，但 canonical / sitemap 一律指向这里。
// https://astro.build/config
export default defineConfig({
  site: 'https://geshuo.defiabell.com',
  integrations: [
    // /review/ 是本地审核台（页面本身已 noindex），不进 sitemap
    sitemap({
      filter: (page) => !page.endsWith('/review/'),
      // <lastmod> = last git commit touching the page's own sources (the
      // take yaml, the scene yaml, the .astro file). Never the build time.
      serialize(item) {
        const lastmod = lastmodOf(sourcesForPath(new URL(item.url).pathname));
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
    dateOnlyLastmod(),
  ],
});
