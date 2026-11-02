# Rutta website

The marketing site for Rutta, fleet and delivery management for distributors in Kosovo and the Balkans.

**Live:** https://viganm.github.io/rutta-website/ (Albanian) · https://viganm.github.io/rutta-website/en/ (English)

The page tells one delivery day on a live map of Kosovo: real terrain contours, rivers, roads and Prishtinë's streets drawn on canvas, with vans driving demo routes along real roads. Below it, the driver app, offline sync, pin correction, the Today board, reports and plans are rebuilt in HTML from the Rutta apps. Names, shops and numbers are demo data.

Built with [Astro](https://astro.build) (static), [GSAP](https://gsap.com) and [Lenis](https://lenis.darkroom.engineering).

## Run it

Needs Node 24 (`.nvmrc`) and pnpm 10.

```bash
nvm use
pnpm install
pnpm dev
```

Then open http://localhost:4321/rutta-website/.

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | Dev server on port 4321                          |
| `pnpm build`     | Static build into `dist/`                        |
| `pnpm preview`   | Serves the build                                 |
| `pnpm typecheck` | `astro check`                                    |
| `pnpm lint`      | ESLint                                           |
| `pnpm format`    | Prettier                                         |
| `pnpm map:data`  | Rebuilds the map data in `src/data/` (see below) |

## Where things are

- `src/components/`: one component per section; `Stage.astro` is the sticky map that carries the hero and the day.
- `src/scripts/`: the animations. `map/view.ts` is the canvas map renderer, `sim.ts` the demo day's clock and route states.
- `src/i18n/`: all copy, Albanian (`sq.ts`, the default) and English (`en.ts`).
- `src/brand/`: the Hartë colour tokens, copied from the Rutta apps.
- `src/site.config.ts`: the demo-request email address and the canonical origin.

## Map data

`src/data/` is generated and committed, so builds never touch the network. `pnpm map:data` rebuilds it from public sources: AWS Terrain Tiles (contours), OpenStreetMap via Nominatim and Overpass (border, roads, rivers, streets) and the OSRM demo server (route geometry). Downloads are cached in `.cache/`.

Map data © OpenStreetMap contributors (ODbL).

## Deploying

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). The site lives under `/rutta-website/` (`base` in `astro.config.mjs`); if it moves to its own domain, set `site` and `base` there and `SITE_ORIGIN` in `src/site.config.ts`.
