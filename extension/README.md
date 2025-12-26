# Loadboard Helper

A Manifest V3 Chrome extension that overlays a SmartBoard UI on DAT and Truckstop load boards. Features include configurable columns, persistent filters, click-to-email templates, Telegram/web notifications, a mock route map, profit calculator, factoring ratings, and broker reviews stored locally.

## Installation
1. From the repository root, run `node scripts/generate-icons.js` to create the required PNG icons (icons are generated locally to avoid committing binaries).
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension/` directory from this repository.
5. Pin the extension to the toolbar to access the popup and options pages quickly.

## Usage
- Navigate to DAT or Truckstop load boards. The SmartBoard toolbar will appear at the top of the page.
- Adjust filters, columns, and dark mode from the toolbar controls. Settings persist via `chrome.storage.local`.
- Click **Email broker** to open a templated mail draft. Update templates and accounts in the **Options** page.
- Enable Telegram webhook in options to receive remote notifications for matching loads. Replace the mock map implementation with Google Maps or another provider by updating `renderMap` in `content.js` and supplying an API key.
- Factoring ratings are mocked via `fetchFactoringRating`; integrate a real API call there as needed.

## Development notes
- All scripts are ES modules and run without a build step.
- External network calls should be added to `host_permissions` in `manifest.json` when integrating real services.
- Use `chrome.storage.local` for persisting user data; avoid storing sensitive credentials.
- Regenerate icons at any time with `node scripts/generate-icons.js`.

## Testing
There is no automated test suite. Use manual verification by loading the unpacked extension and exercising SmartBoard interactions on target domains.
