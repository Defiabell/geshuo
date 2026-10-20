// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 正式地址。geshuo.pages.dev 仍在服务，但 canonical / sitemap 一律指向这里。
// https://astro.build/config
export default defineConfig({
  site: 'https://geshuo.defiabell.com',
  integrations: [
    // /review/ 是本地审核台（页面本身已 noindex），不进 sitemap
    sitemap({ filter: (page) => !page.endsWith('/review/') }),
  ],
});
