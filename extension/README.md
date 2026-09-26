# Soroban Explorer Browser Extension

This minimal browser extension lets a user paste or select a Stellar address or contract ID and jump to the explorer page for that entity.

## Build

1. Ensure Node.js 20+ is installed.
2. From the repo root:

```bash
cd extension
npm install
npm run build
```

The build emits the unpacked extension in `dist/`.

## Load in Chrome or Firefox

- Chrome: open `chrome://extensions`, enable "Developer mode", then select the `dist` directory.
- Firefox: open `about:addons`, click "Debug Add-ons", then "Load Temporary Add-on" and select `dist/manifest.json`.

## Supported IDs

- G... wallet addresses
- M... muxed addresses
- C... contract IDs

The extension automatically routes to:

- wallet page for G/M addresses
- contract page for C addresses

## Notes

The extension uses the browser's current local explorer origin and falls back to `http://localhost:5173` when no explicit `EXPLORER_ORIGIN` is set.
