// JSON-LD identity shared by every page, plus the sitemap page→source map.
//
// The Person block is copied verbatim from the owner's site-wide spec rather
// than referenced by @id alone, so a crawler that never fetches defiabell.com
// still gets a complete author node.
export const SITE_URL = 'https://geshuo.defiabell.com/';
export const SITE_NAME = '各说各话';
/** Same sentence as the default <meta name="description"> in Base.astro. */
export const SITE_DESCRIPTION = '同一出戏，各地各演一遍。';
export const WEBSITE_ID = `${SITE_URL}#website`;

export const PERSON = {
  '@type': 'Person',
  '@id': 'https://defiabell.com/#person',
  name: 'Jinkun Sun',
  alternateName: 'Defiabell',
  url: 'https://defiabell.com/',
  sameAs: [
    'https://github.com/Defiabell',
    'https://defiabell.github.io/',
    'https://defiabell.pages.dev/',
  ],
} as const;

/**
 * Serialize for `<script type="application/ld+json">`. `<`, `>` and `&` go
 * out as \u escapes so a `</script>` inside a line of dialogue cannot end the
 * element. Dialogue here is user-contributed, so this is not theoretical.
 */
export function jsonLdString(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Source files a page is built from, for sitemap <lastmod> (see
 * git-dates.mjs for the '/' and '*' prefix forms). Unknown paths → no date.
 */
export function sourcesForPath(pathname: string): string[] {
  const p = pathname.replace(/\/+$/, '') || '/';
  const SCENES = 'src/data/scenes/';
  const TAKES = 'src/data/takes/';
  if (p === '/') return ['src/pages/index.astro', SCENES, TAKES];
  if (p === '/weekly') return ['src/pages/weekly.astro', SCENES, TAKES];
  if (p === '/guess') return ['src/pages/guess.astro', TAKES];
  if (p === '/map') return ['src/pages/map.astro', 'src/data/places.yaml', 'src/data/dialects.yaml', TAKES];
  if (p === '/record') return ['src/pages/record/index.astro', SCENES];
  if (p === '/swearing' || p === '/contribute' || p === '/propose') return [`src/pages${p}.astro`];
  const record = p.match(/^\/record\/([^/]+)$/);
  if (record) return ['src/pages/record/[scene].astro', `${SCENES}${record[1]}.yaml`];
  const compare = p.match(/^\/s\/([^/]+)\/compare\/([^/]+)$/);
  if (compare) return [`${SCENES}${compare[1]}.yaml`, `${TAKES}${compare[1]}.*`];
  const take = p.match(/^\/s\/([^/]+)\/([^/]+)$/);
  if (take) return [`${SCENES}${take[1]}.yaml`, `${TAKES}${take[1]}.${take[2]}.yaml`];
  return [];
}
