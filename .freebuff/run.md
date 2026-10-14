# GreenWave Preview

## How to reproduce artifacts
- `npm install` (already done)
- `npm run build` to produce `dist/standalone.html`
- `node scripts/inline-standalone.mjs` to inline the build into `dist/standalone.html`

## How to run the server
The `dist/standalone.html` file is a self-contained single-page app.
For the preview, we serve it via `npx vite preview --port 4173 --strictPort`.
Alternatively, use the built `standalone.html` directly via `register_preview` with its `htmlPath`.
