# Al-Nokhba Anime.js and SVG update

## Implemented

The frontend now includes Anime.js v4 as a lightweight interaction layer. The Landing Page uses a scoped entrance sequence for the hero copy, hero workspace preview, feature cards, and workflow cards. The authenticated dashboard animates section changes, metric cards, and report-queue action cards without animating the complete student list. QR scanning uses a single success pulse or failure shake alongside the existing sound effects. Analytics uses one-time metric and panel reveals. The notification bell uses a single unread-badge pulse.

All motion is disabled when the browser requests reduced motion. Animations are scoped and reverted when React components unmount. Existing data loading, attendance, QR, reporting, and notification logic was not replaced by animation code.

## Logo assets

`public/nokhba-official.svg` is a standalone color SVG generated from the supplied official logo. `public/nokhba-mark.svg` is the compact vector mark used for small headers, favicons, and notification surfaces. `public/logo.svg` and `public/nokhba-logo.svg` now point to the standalone official vector artwork. Existing PNG assets remain available for manifest or compatibility fallbacks.

## Validation

`npm run build` completed successfully after the Anime.js and SVG changes. The current source was smoke-tested on port 4173 at the landing and login routes. The browser console showed no Anime.js, SVG, or runtime errors. Vector checks confirmed that the official SVG and compact mark contain path data and no raster `<image>` element.

The build still reports the project’s previous chunk-size and ineffective dynamic-import warnings. They are warnings, not build failures, and Anime.js added only a small dependency footprint relative to the existing application bundle.

## Run and deploy

```bat
npm install
npm run build
npm start
```

For Vercel:

```bat
npm run build
npx vercel --prod
```

The short logo animation video is intentionally a separate next step after this frontend package is approved.
