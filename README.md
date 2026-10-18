# BROwOS

Browser-based, Windows 10-inspired desktop operating environment.

## Development status

The repository now contains a runnable React/Vite bootstrap. The bootstrap opens a desktop, a welcome window and the Start menu. Filesystem packages, full window management, applications and Connected Chromium are being integrated in the current development session; they are not yet claimed as delivered features of this bootstrap.

## Run locally

Node.js 22.12+ and pnpm 10.34.7 are required.

```sh
corepack enable
corepack prepare pnpm@10.34.7 --activate
pnpm install
pnpm dev
```

Open http://localhost:5173.

```sh
pnpm build
pnpm preview
```

## Verification

The bootstrap frontend production build was executed successfully with Vite 8.3.4. Browser E2E checks and GitHub Actions have not yet been completed for this bootstrap. No live deployment is claimed.

## Project tracking

See [open issues](https://github.com/romantic52/BROwOS/issues) for subsystem acceptance criteria. Development continues in this repository only.

## Ownership and licensing

BROwOS is independent of Microsoft. Windows 10 is a visual reference. No open-source license has been granted; the owner will decide licensing.
