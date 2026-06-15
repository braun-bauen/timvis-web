# Twitter Timeout
A simple Chromium extension that blocks Twitter after a specified amount of usage per hour.

Currently only blocks Twitter visually via a scrim, but might extend it to block network requests.

## Setup

This project uses `pnpm` and Vite.

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Optional: create a local environment file from the template:

   ```sh
   cp .env.template .env
   ```

   Set `VITE_DEBUG=true` in `.env` if you want debug behavior enabled locally.

## Build

Build the unpacked Chrome extension into `dist/`:

```sh
pnpm build
```

The build includes the extension manifest, background script, content script, popup, and static assets.

## Load in Chrome

1. Build the extension with `pnpm build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the generated `dist/` directory.

After loading, visit `https://x.com/` to test the extension.

## Rebuild After Changes

After changing source files, run `pnpm build` again, then click the reload button for the extension on `chrome://extensions`.
