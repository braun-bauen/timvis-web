# Timvis

A simple Chromium extension that blocks domains with a scrim after a specified amount of usage per hour.

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

### HTML page development

Some parts of the extension use HTML pages (popup, options). For basic development on these pages, the respective dev server commands can be used to open the pages with HMR:

```sh
pnpm dev:popup
pnpm dev:options
```

`dev:options` uses an in-memory mock of the Chrome extension APIs and starts
with sample domains covering the available options UI. Changes last until the
page is refreshed.

### Build

Build the unpacked Chrome extension into `dist/`:

```sh
pnpm build
```

The build includes the extension manifest, background script, content script, popup, and static assets.

### Load in Chrome

1. Build the extension with `pnpm build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the generated `dist/` directory.

After loading, visit `https://x.com/` to test the extension.

### Rebuild After Changes

After changing source files, run `pnpm build` again, then click the reload button for the extension on `chrome://extensions`.

## Releasing

To release a new version of Timvis, follow these steps:

1. Update the version number in [package.json](package.json) and the [manifest.json](public/manifest.json) file according to semantic versioning
2. Push the changes to the main branch via PR
3. Create a new tag with the new version number: `git tag vX.X.X`
4. Push the tag: `git push origin vX.X.X`
5. The [release.yml](.github/workflows/release.yml) workflow will automatically build the extension and create a new release on GitHub with the built extension as an asset.
