// Last-commit dates for source files, used as sitemap <lastmod> and JSON-LD
// dateModified. One `git log --name-only` pass over the tree, cached for the
// build; the first time a path appears (newest commit first) is its last
// change. A file with no history (uncommitted, or a shallow clone that lost
// it) yields undefined and the caller omits the date — never a made-up one.
//
// CI must check out with fetch-depth: 0, or every file carries the same date.
import { execFileSync } from 'node:child_process';

const MARK = '@@';
/** @type {Map<string, string> | undefined} */
let cache;

/** @returns {Map<string, string>} repo-relative path → YYYY-MM-DD of last commit */
export function gitDates(root = process.cwd()) {
  if (cache) return cache;
  cache = new Map();
  let out = '';
  try {
    out = execFileSync('git', ['log', `--format=${MARK}%cs`, '--name-only', '--', 'src', 'public'], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return cache;
  }
  let date = '';
  for (const line of out.split('\n')) {
    if (line.startsWith(MARK)) { date = line.slice(MARK.length); continue; }
    if (!line || !date || cache.has(line)) continue;
    cache.set(line, date);
  }
  return cache;
}

/**
 * Newest last-commit date among the given sources. An entry ending in '/'
 * matches every file under that directory; one ending in '*' matches every
 * file whose path starts with the rest (e.g. 'src/data/takes/debt.*').
 * @param {string[]} sources
 * @returns {string | undefined}
 */
export function lastmodOf(sources, root = process.cwd()) {
  const dates = gitDates(root);
  let best;
  for (const src of sources) {
    if (src.endsWith('/') || src.endsWith('*')) {
      const prefix = src.endsWith('*') ? src.slice(0, -1) : src;
      for (const [file, date] of dates) {
        if (file.startsWith(prefix) && (!best || date > best)) best = date;
      }
    } else {
      const date = dates.get(src);
      if (date && (!best || date > best)) best = date;
    }
  }
  return best;
}
