<div align="center">
  <img src="src/assets/icons/firv-logo.png" alt="firv logo" width="128" />

  <h1>firv</h1>

  <p>
    A cross-platform desktop application for building, organizing, and executing HTTP requests.
  </p>

  <p>
    <a href="#features">Features</a> •
    <a href="#installation">Installation</a> •
    <a href="#development">Development</a> •
    <a href="#building">Building</a> •
    <a href="#license">License</a>
  </p>
</div>

---

## Features

- **Request editor** — compose HTTP requests with methods, headers, query parameters, and body payloads.
- **Workspace-based projects** — organize requests into folders and projects stored on the local filesystem.
- **Environments** — switch between environment variables per workspace.
- **Response viewer** — inspect response status, headers, and body.
- **Transforms** — reshape response bodies using Liquid templates before display. A custom `uuid` filter is included.
- **Request chaining** — run sequential request steps with extraction rules and conditional logic.
- **File-driven storage** — projects are plain files, making them easy to version control and share.
- **MCP server** — control firv headlessly via an MCP (Model Context Protocol) server over stdio for agent automation.
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

## MCP server (headless agent control)

firv can run as a headless MCP server so external agents can load workspaces, execute requests, manage scratchpad requests, and inspect resources.

### Start the MCP server

```bash
# Windows example
firv.exe mcp --workspace C:\path\to\my-workspace

# Linux / macOS example
./firv mcp --workspace /path/to/my-workspace
```

The server communicates over stdio using JSON-RPC (MCP protocol).

### Open a workspace in the GUI from the CLI

```bash
firv.exe --workspace C:\path\to\my-workspace
```

### Available MCP tools

- `load_workspace` — load or reload a workspace directory.
- `list_requests` — list persisted workspace requests.
- `get_request` — read a persisted request definition.
- `execute_request` — run a persisted workspace request.
- `execute_request_by_payload` — run an ad-hoc request payload.
- `list_environments` / `set_active_environment` — manage the active environment (session-memory only).
- `list_ws_requests` — list WebSocket requests in the workspace.
- `create_scratchpad_request`, `update_scratchpad_request`, `delete_scratchpad_request`, `list_scratchpad_requests`, `get_scratchpad_request` — manage an in-memory session scratchpad.
- `execute_scratchpad_request` — run a scratchpad request.
- `promote_scratchpad_request` — persist a scratchpad request to the workspace.

### Available MCP resources

- `manifest://firv.yaml` — the loaded workspace manifest.
- `request://<id>` — individual request files.
- `scratchpad://requests` — current session scratchpad requests.

### Example MCP client configuration (Claude Desktop / Cline)

```json
{
  "mcpServers": {
    "firv": {
      "command": "C:\\\\path\\\\to\\\\firv.exe",
      "args": [
        "mcp",
        "--workspace",
        "C:\\\\path\\\\to\\\\my-workspace"
      ]
    }
  }
}
```

Replace `C:\\\\path\\\\to\\\\firv.exe` and `C:\\\\path\\\\to\\\\my-workspace` with the actual paths to the firv binary and workspace directory. On Linux/macOS, adjust the command path and use forward slashes.

## Contributing

Contributions are welcome. Please open an issue or pull request on GitHub.

## License

firv is licensed under the [Apache License 2.0](LICENSE).
