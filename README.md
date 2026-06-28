<p align="center">
  <img src="src/assets/icons/firv-logo.png" alt="firv logo" width="128" />
</p>

<h1 align="center">firv</h1>

<p align="center">
  A cross-platform desktop application for building, organizing, and executing HTTP requests.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#development">Development</a> •
  <a href="#building">Building</a> •
  <a href="#license">License</a>
</p>

---

## Features

- **Request editor** — compose HTTP requests with methods, headers, query parameters, and body payloads.
- **Workspace-based projects** — organize requests into folders and projects stored on the local filesystem.
- **Environments** — switch between environment variables per workspace.
- **Response viewer** — inspect response status, headers, and body.
- **Transforms** — reshape response bodies using Liquid templates before display. A custom `uuid` filter is included.
- **Request chaining** — run sequential request steps with extraction rules and conditional logic.
- **File-driven storage** — projects are plain files, making them easy to version control and share.
- **Cross-platform** — runs on Windows and Linux.
- **Automatic updates** — built-in updater checks for new releases.

## Installation

Pre-built installers are available on the [Releases](https://github.com/pelism/firv/releases) page.

### Supported platforms

- Windows — `.msi`
- Linux — `.deb` and AppImage

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (see `package.json` for the version used by the project)
- [Rust](https://www.rust-lang.org/tools/install) (required by Tauri)
- System dependencies for Tauri as described in the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Install dependencies

```bash
npm install
```

### Run the development build

```bash
npm run tauri dev
```

This starts the Vite frontend and the Tauri backend in development mode.

### Run tests

```bash
# Frontend tests
npm run test

# Rust tests
npm run cargo:test
```

## Building

### Build the production desktop app

```bash
npm run tauri build
```

The bundled installers will be produced in `src-tauri/target/release/bundle/`.

### Build only the frontend

```bash
npm run build
```

## Project structure

```
src/            # React + TypeScript frontend
src-tauri/      # Rust backend and Tauri configuration
public/         # Static assets
scripts/        # Build helper scripts
```

## Contributing

Contributions are welcome. Please open an issue or pull request on GitHub.

## License

firv is licensed under the [Apache License 2.0](LICENSE).
