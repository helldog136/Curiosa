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

## nginx settings

### What the installer writes (new sites only)

`scripts/install.sh` writes these lines into the nginx site it creates (`--dry-run` announces them):

- **Compression**: `gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 5; gzip_min_length 1024;` and `gzip_types` for css, plain text, xml, javascript, json, rss and svg. `text/html` is always compressed by nginx and is not listed (listing it only produces a warning). Brotli is not used: it needs a module that many servers do not have.
- **A kept-open connection to the site**: an `upstream curiosa_<site>` block with `keepalive 16;` and `keepalive_timeout 4s;`, and `proxy_pass` pointing at it. The location already had `proxy_http_version 1.1;`, `proxy_set_header Connection "";` and `proxy_buffering off;`, so streamed responses (server-sent events) behave as before. `keepalive_timeout 4s` is shorter than the 5 s of Node's HTTP server on purpose: nginx must never reuse a connection that Node is about to close, which would show up as a rare 502. That directive exists in an `upstream` block from nginx 1.15.3; with an older or unreadable version the installer writes the compression but no `upstream` block.
- **No `http2`**: the file the installer writes only listens on port 80; the TLS listener is added later by `certbot --nginx`. See below for the line to use once it exists.

Re-running the installer never duplicates these lines: the file is either identical (nothing happens), or recognised as written by an earlier installer and left exactly as it is, or rewritten whole with a backup (as before, for example when the port changed).

### Existing sites: apply the same lines by hand

Nothing is changed on an existing site. If you want the same effect, edit your site file (for example `/etc/nginx/sites-available/<site>.conf`), keep a copy, then run `sudo nginx -t && sudo systemctl reload nginx`.

```nginx
# above the server { } block (nginx 1.15.3 or newer; skip it on older versions):
upstream curiosa_mysite {
    server 127.0.0.1:3000;          # the port of your site
    keepalive 16;
    keepalive_timeout 4s;
}

# inside server { }:
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/css text/plain text/xml text/javascript application/javascript application/json application/xml application/rss+xml image/svg+xml;

# in location / { }: replace the address with the upstream name
proxy_pass http://curiosa_mysite;    # was: http://127.0.0.1:3000
```

If `gzip on;` is already set in `nginx.conf` or in your site, do not add it twice in the same block (nginx refuses a duplicate in one block with `nginx -t`).

HTTP/2 on the TLS listener depends on the nginx version (`nginx -v`):

| nginx | Line |
|---|---|
| before 1.25.1 (Ubuntu 20.04 and 22.04 ship 1.18; 24.04 ships 1.24) | `listen 443 ssl http2;` |
| 1.25.1 or newer | `listen 443 ssl;` and, next to it, `http2 on;` (the old form still works but prints a deprecation warning) |

Certbot may already have written a `listen 443 ssl` line: edit that one, do not add a second listener.

### Optional recipe: cache the two crawler files (not applied, not installed)

Off by default and not recommended unless crawlers load the site noticeably. `/sitemap.xml` and `/feed.xml` are rebuilt in about 40 ms, so the gain is small. If you still want it, in `http { }` (a file under `conf.d`):

```nginx
proxy_cache_path /var/cache/nginx/curiosa keys_zone=curiosa:5m max_size=50m inactive=10m;
```

and in the server block, before `location /`:

```nginx
location = /sitemap.xml { proxy_pass http://curiosa_mysite; proxy_cache curiosa; proxy_cache_valid 200 5m; proxy_cache_methods GET; }
location = /feed.xml    { proxy_pass http://curiosa_mysite; proxy_cache curiosa; proxy_cache_valid 200 5m; proxy_cache_methods GET; }
```

Caveats, all of them matter:

- Only anonymous `GET` of these two addresses. Never cache HTML pages, `/admin`, `/api`, `/m`, or anything that depends on a cookie or a preview.
- Keep nginx's default behaviour for `Cache-Control: no-store`, `private` and `Set-Cookie`: do not add `proxy_ignore_headers` or `proxy_hide_header` for them. If the site sends `no-store` on these files, nginx will not store them and the recipe does nothing; that is the safe outcome.
- A published change shows up in these two files after up to 5 minutes.
- Remove the two `location` blocks and the `proxy_cache_path` line to undo it.
