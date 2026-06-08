# Docklite

Docklite is a local-first VS Code extension for inspecting and managing Docker containers, images, and volumes without leaving the editor.

It is intentionally small: it wraps the Docker CLI, keeps the UI close to Docker Desktop where it helps, and avoids cloud accounts, background indexing, or heavyweight project tracking.

## Features

- Activity Bar view for local Docker resources
- Container groups based on Docker Compose project labels
- Running/stopped status indicators for containers and images
- Container start, stop, restart, and delete actions
- Container detail pages with Info, Logs, Exec, and Inspect tabs
- Live-ish container stats for CPU, memory, disk read/write, and network I/O
- Fixed logs viewer with search, clear, and tail-to-latest behavior
- Interactive shell entry with `docker exec -it <container> sh`
- Image detail pages with layers, usage, run, stop, and delete actions
- Image run dialog with optional name, command, ports, volumes, and environment variables
- Volume detail pages with stored data browsing, text preview, container usage, and delete
- Friendlier Docker error messages for common failures
- Runtime picker for Docker-compatible engines
- Platform-aware runtime settings for Colima/resources and startup timeouts

## Screenshots

Recommended screenshots to add before sharing:

- `docs/screenshots/sidebar.png`: containers, images, and volumes in the Activity Bar view
- `docs/screenshots/container-info.png`: container Info page with stats and ports
- `docs/screenshots/logs.png`: fixed logs viewer with toolbar
- `docs/screenshots/image-run.png`: image run dialog
- `docs/screenshots/volume-files.png`: volume stored data browser

After adding those files, link them here with normal Markdown image tags.

## Demo GIF

Recommended demo path:

```text
docs/demo.gif
```

A good 20-30 second demo should show:

1. Open the Docklite Activity Bar view.
2. Expand Containers, Images, and Volumes.
3. Open a container detail page.
4. Switch from Info to Logs.
5. Open the Exec tab or shell action.
6. Open an image and show the Run dialog.
7. Open a volume and drill into stored data.

Suggested tools:

- macOS: record with QuickTime or CleanShot, then convert/compress with `ffmpeg` or `gifski`
- Cross-platform: ScreenToGif
- CLI conversion: `ffmpeg`

Example conversion:

```sh
ffmpeg -i demo.mov -vf "fps=12,scale=1200:-1:flags=lanczos" -loop 0 docs/demo.gif
```

Keep the GIF short. A focused demo is better than a huge file that takes forever to load.

## Requirements

- VS Code 1.90 or newer
- Docker CLI available on your PATH
- A Docker-compatible daemon running locally
- Local Docker permissions for the current user

This extension shells out to `docker`, so it behaves like your terminal Docker setup.

## Runtime Setup

Docklite can help start or configure a local Docker-compatible runtime from the sidebar:

1. Open the Docklite Activity Bar view.
2. Expand `Settings`.
3. Choose `Change Docker Engine`.
4. Pick the runtime for your platform.

Docklite marks the detected active runtime as `Current` in the picker when it can infer it from `docker context show`.

### Runtime Options

macOS:

- Colima, recommended
- Docker Desktop

Linux:

- Docker Engine, recommended
- Colima

Windows:

- Docker Engine in WSL2, recommended
- Docker Desktop

The setup scripts live in `scripts/runtimes/`. They are intentionally plain shell or PowerShell scripts so they can be inspected and run manually during testing.

### Runtime Settings

Open `Settings` -> `Runtime Settings` from the Docklite sidebar.

The settings page only shows options that make sense for the current operating system:

- macOS: Colima CPU, memory, disk, VM backend, Colima timeout, Docker Desktop timeout
- Linux: Docker Engine timeout, Colima CPU, memory, disk, VM backend, Colima timeout
- Windows: WSL2 Docker timeout and Docker Desktop timeout

Colima resource settings are applied only when Docklite creates or starts a Colima runtime. They do not change Docker Desktop or native Linux Docker Engine resources.

Saved settings are stored as VS Code configuration under `docklite.runtime.*` and passed into setup scripts through `DOCKLITE_*` environment variables.

Useful keys:

- `docklite.runtime.colimaCpu`
- `docklite.runtime.colimaMemoryGiB`
- `docklite.runtime.colimaDiskGiB`
- `docklite.runtime.colimaVmType`
- `docklite.runtime.colimaSetupTimeoutSeconds`
- `docklite.runtime.dockerDesktopTimeoutSeconds`
- `docklite.runtime.dockerEngineTimeoutSeconds`
- `docklite.runtime.wslDockerTimeoutSeconds`

## Local Development

Install dependencies:

```sh
npm install
```

Compile once:

```sh
npm run compile
```

Or compile in watch mode:

```sh
npm run watch
```

Run the extension locally:

1. Open this folder in VS Code.
2. Press `F5`.
3. In the Extension Development Host window, open the Docklite Activity Bar view.
4. If Docker is not running, use `Configure Runtime`.
5. Use the sidebar to inspect containers, images, and volumes.

Package locally:

```sh
npm run package
```

## Local Testing

You can test against any local Docker project. For a tiny fixture:

```yaml
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"

  redis:
    image: redis:alpine
```

Run it from a separate folder:

```sh
docker compose up -d
```

Then refresh Docklite in VS Code.

Useful manual checks:

- Stop and start a container from the sidebar.
- Open a container and verify Info, Logs, Exec, and Inspect tabs.
- Run an image with a custom container name and port mapping.
- Try deleting an image used by a running container and confirm the friendly error.
- Open a named volume and browse stored files.
- Stop Docker and confirm the empty/error state is understandable.
- Open `Runtime Settings`, change Colima resources, and confirm Configure Runtime passes those values into the setup terminal.

Runtime setup scripts can also be tested manually:

```sh
bash scripts/runtimes/setup-macos-colima-runtime.sh
```

Reset scripts are provided for repeated setup testing, but they are intentionally manual:

```sh
bash scripts/runtimes/reset-macos-colima-runtime.sh
```

## Limitations

- This is a local Docker CLI wrapper, not a complete Docker Desktop replacement.
- Logs are refreshed by polling, not true streaming.
- Exec opens an interactive terminal, but it assumes `sh` exists in the container.
- Image run options are intentionally basic and do not cover every `docker run` flag.
- Volume browsing uses a mounted running container when possible, or a temporary BusyBox helper container.
- Docker Compose metadata is displayed from container labels, but Compose file tracking/up/down is not implemented.
- Runtime setup is best-effort and platform-specific. Some installs still require system permissions or first-run prompts.
- No Kubernetes, registries, Docker Hub auth, vulnerability scanning, or remote Docker contexts yet.

## Project Structure

```text
src/lib/dockerClient.ts            Docker CLI wrapper and data parsing
src/views/containerTree.ts         Activity Bar tree view
src/views/containerDetailsPanel.ts Container detail webview
src/views/imageDetailsPanel.ts     Image detail webview
src/views/volumeDetailsPanel.ts    Volume detail webview
src/views/runtimeSettingsPanel.ts  Runtime settings webview
resources/                         Icons and visual assets
scripts/runtimes/                  Runtime setup and reset scripts
```

## Name

Docklite is an unofficial local development tool. It is not affiliated with or endorsed by Docker, Inc.
