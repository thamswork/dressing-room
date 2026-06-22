# Dressing Room — by Basil Metric

A mobile-first PWA daily style ritual guide for the Thailand market. Reads a
person's exact birth coordinates against today's planetary transits and
returns three directives: a vibe, a lucky outfit colour, a hairstyle call.

## Structure

```
app/                  Next.js App Router frontend
  layout.tsx          Root layout — PWA meta tags, fonts, viewport
  page.tsx            Registration form + dashboard (single page, two stages)
  vector-glyphs.tsx    Monochrome SVG components (garment tag, swatch, hair glyph, compass)
  globals.css          Design tokens, dark theme base styles

public/
  manifest.json        PWA manifest (icons, theme colour, install behaviour)
  icons/                Add icon-192.png, icon-512.png, icon-maskable-*.png,
                        apple-touch-icon.png here (not included — drop in your own)

backend/
  index.ts             Cloudflare Worker (Hono) — registration + daily directive API
  package.json          Worker dependencies
  tsconfig.json         Worker-specific TS config (Workers types, not DOM)

db/
  schema.sql            D1 schema: users + daily_states cache table

wrangler.toml           Worker + D1 binding config
.env.example             Required environment variables
```

## Setup

### 1. Frontend

```bash
npm install
cp .env.example .env.local
# edit .env.local:
#   NEXT_PUBLIC_WORKER_API_BASE=https://your-worker.workers.dev
#   NEXT_PUBLIC_GEONAMES_USERNAME=your_geonames_username
npm run dev
```

Geonames requires a free account at geonames.org — activate "free web services"
under your account settings, then use that username as
`NEXT_PUBLIC_GEONAMES_USERNAME`. The city search is scoped to Thailand
(`country=TH`) and ordered by population so major provinces surface first.

Add real PNG icons to `public/icons/` matching the filenames referenced in
`manifest.json` and `layout.tsx` — 192px, 512px, maskable variants, and a
180px Apple touch icon. The manifest and layout are already wired to them.

### 2. Backend (Cloudflare Worker)

```bash
cd backend
npm install
npx wrangler login

# create the D1 database, then paste its id into wrangler.toml
npx wrangler d1 create dressing-room-db

# run the schema against it
npm run db:migrate:local     # for local dev
npm run db:migrate:remote    # once deployed

# set the astrology API key as a secret — never commit it
npx wrangler secret put ASTROLOGY_API_KEY

npm run dev        # local worker dev server
npm run deploy      # deploy to Cloudflare
```

`ASTROLOGY_API_BASE` defaults to the Free Astrology API base URL in
`wrangler.toml`. Swap it for Astrology-API.io's base if you prefer that
provider — `fetchTransitPlacements` in `backend/index.ts` already reads
several common response shapes defensively, but check the exact field names
of whichever provider you sign up with and adjust the mapping if needed.

## How the logic works

1. Person registers with name, birth date/time, and a Thailand city
   (resolved to lat/lon/timezone via Geonames).
2. The worker checks `daily_states` for a cached row matching today's date
   in the person's local timezone. If found, it's returned immediately —
   no upstream API call.
3. If no cache exists, the worker calls the astrology feed for today's
   planetary positions at the person's coordinates, reduces them to a
   Fire/Air/Earth/Water balance (weighted toward fast-moving bodies:
   Moon, Sun, Mercury, Venus), and derives:
   - **Vibe of the day** — one of several dry editorial lines per dominant element
   - **Lucky outfit colour** — a named hex from a small monochrome-leaning palette per element
   - **Hairstyle directive** — Hair Up if Fire+Air outweighs Earth+Water, else Hair Down
4. The result is cached in `daily_states` so the same day never re-triggers
   the upstream call for that person.

## Design system

Dark, editorial, no emojis, no gradients, no card glow. Three type roles:
a serif display face (Fraunces) for headlines and the vibe text, a neutral
grotesk (Inter) for UI copy, and a monospace (IBM Plex Mono) for data —
coordinates, hex codes, labels — styled like a spec sheet. The signature
visual is a single line-art garment tag that rotates to point up or down
with the day's hair directive.
