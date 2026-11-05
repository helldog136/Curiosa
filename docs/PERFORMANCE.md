# Performance notes

Measured on a seeded demo site (74 modules, 82 instances), production build, `next start`, Chromium via `scripts/visual`. Numbers say how they were obtained; re-run them before relying on them.

## What public pages send

| Page type | First-load JavaScript, before | after |
|---|---|---|
| Home, pages, blog, entries, privacy, search | 593 781 bytes (180.7 KB gzip) | 497 064 bytes (148.4 KB gzip) |
| Framework floor (`/_not-found`) | 458 123 bytes | 458 123 bytes |

Cause: `components/site/Blocks.tsx` is shared by public and admin pages and statically imported the admin form kit (live search, crop, operation bar, grid editor, edit dialogs). Next puts every client component reachable from the server code of a route (also through a dynamic `import()`) into that route's first load, so visitors downloaded ~96 KB of admin code. Now only admin pages import `components/site/adminKit.ts` and pass it to `Blocks` as `kit`; public pages render enhanced tables with `TableView` alone. `tests/core/public-js-weight.test.mjs` guards it (static rules, plus a size check when a build is present).

Visual proof: 374 screenshots (every page of the demo site, FR and EN, 390 and 1280 px, dark and light) before/after: 0 different pixel; `scripts/visual/dom-check.mjs` (skin parts and regions): 1094 checks, 0 deviation.

What is left above the framework floor is about 39 KB: the ten small client components of the public site (menu, cookie tray, copy buttons, form, tabs, visit beacon, hero video, table view).

## Already fine (measured, nothing changed)

| Item | Finding |
|---|---|
| `/uploads/<name>` and cropped variants `?c=...` | `public, max-age=31536000, immutable`; variants are WebP (a 2 KB cover) |
| `/m/<module>/<file>?v=<hash>` | `immutable` (the address carries the hash) |
| `/_next/static/*` | immutable |
| Fonts (`/fonts/<file>`, uploaded fonts) | same origin, `immutable`, `font-display: swap`; the default site uses system fonts (no font request) |
| Third-party requests | none |
| Images in covers | `width`/`height` are set whenever the crop ratio is known (`CoverImage`); logos have a fixed height |
| HTML | `private, no-store` on purpose (per-visitor cookies, previews); size is dominated by the Next flight payload (about half of a 75 KB page) |

Not done, and why: `ETag` on uploads (the name is a random id and never changes: `immutable` is stronger); width/height for images without a crop (the dimensions are not stored; would need a schema change); preload of a chosen web font (several `unicode-range` files, benefit only for sites that pick a web font); WebP/AVIF pipeline changes (decided later).

## Proposal: reverse proxy settings (not applied, the install template is unchanged)

For the nginx server block that proxies to `next start`:

```nginx
gzip on;
gzip_comp_level 5;
gzip_min_length 512;
gzip_types text/css application/javascript application/json application/xml image/svg+xml text/plain;
# brotli (needs the module): brotli on; brotli_comp_level 5; brotli_types <same list>;
listen 443 ssl http2;
upstream curiosa { server 127.0.0.1:3000; keepalive 16; }
# in the proxy location: proxy_http_version 1.1; proxy_set_header Connection "";

# Anonymous GET of the two crawler files (rebuilt in ~40 ms, but there is no reason to rebuild them for every crawler):
proxy_cache_path /var/cache/nginx/curiosa keys_zone=curiosa:5m max_size=50m inactive=10m;
location = /sitemap.xml { proxy_pass http://curiosa; proxy_cache curiosa; proxy_cache_valid 200 5m; proxy_cache_key $scheme$host$uri; proxy_ignore_headers Set-Cookie; proxy_hide_header Set-Cookie; }
location = /feed.xml    { proxy_pass http://curiosa; proxy_cache curiosa; proxy_cache_valid 200 5m; proxy_cache_key $scheme$host$uri; }
```

Do not cache HTML pages or anything under `/admin`, `/api`, `/m` (cookies and previews). `next start` already compresses responses when the proxy does not.
