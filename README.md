<p align="center">
  <img src="brand/vortex-simbolo-cor.svg" alt="Vortex" width="96" />
</p>

<h1 align="center">Vortex</h1>

<p align="center">
  Self-hosted chat. Voice and screen in the middle, everything else around it.
</p>

<p align="center">
  <a href="LICENSE"><img alt="AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-5EE6D0?style=flat-square" /></a>
  <a href="https://github.com/axiumhq/vortex/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/axiumhq/vortex/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/axiumhq/vortex/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/axiumhq/vortex?style=flat-square&color=A99BFF" /></a>
  <a href="https://github.com/stoatchat"><img alt="Protocol" src="https://img.shields.io/badge/protocol-Stoat-F2F4FA?style=flat-square&labelColor=0A0C14" /></a>
  <img alt="Platforms" src="https://img.shields.io/badge/web%20%2B%20desktop-Electron-0A0C14?style=flat-square" />
</p>

<p align="center">
  <a href="https://github.com/axiumhq/vortex/releases/latest">Download</a>
  ·
  <a href="VORTEX.md">Fork notes</a>
  ·
  <a href="CLAUDE.md">Architecture</a>
  ·
  <a href="brand/README.md">Brand</a>
</p>

<p align="center">
  <img src="brand/vortex-logotipo.svg" alt="Vortex wordmark" width="280" />
</p>

Vortex is a chat client and server you run yourself. It speaks the [Stoat](https://github.com/stoatchat) protocol and is not affiliated with or endorsed by the Stoat project.

The web app and the Electron shell share one interface. The shell does not bundle the client: it loads your instance over HTTPS.

## Features

- Servers, channels, and direct messages
- Voice rooms, with screen share
- A desktop installer, updated from GitHub Releases
- Your own API and event server (`delta` and `bonfire`)

## Repository layout

| | |
| --- | --- |
| [`client/`](client/) | React app. Image: `ghcr.io/enzolaops/vortex-client` |
| [`server/`](server/) | Rust backend. Image: `ghcr.io/enzolaops/vortex-server` |
| [`desktop/`](desktop/) | Electron shell. Installers ship on each `v*` release |
| [`brand/`](brand/) | Mark, wordmark, and the icon generator |
| [`vendor/`](vendor/) | Upstream Stoat web tree. Reference only. Never built |

`client/`, `server/`, and `desktop/` each have their own toolchain. Run commands from inside the directory. `vendor/` is not a product build. A check in CI fails if a workflow starts packaging it.

## Run locally

```bash
cd client
pnpm install
pnpm --filter stoat.js build
pnpm --filter app dev
```

The desktop shell needs `VORTEX_APP_URL` at build time. Copy `desktop/.env.example` to `desktop/.env` and set it. The build fails on purpose if the URL is missing.

Publish a GitHub Release tagged `vX.Y.Z` to build whatever changed since the previous tag. Notes come from conventional commit subjects. Leave the release body empty.

## License

[GNU AGPL-3.0](LICENSE). Anyone who uses a Vortex instance over the network is entitled to the source of that modified version. This repository is that source for the client, the server, and the desktop shell.

Upstream Stoat code remains under its own license. Do not present this project as Stoat.
