# Docker Desktop Lite

Docker Desktop Lite is a local-first VS Code extension for inspecting and managing Docker containers, images, and volumes without leaving the editor.

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

1. Open the Docker Lite Activity Bar view.
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
- Docker daemon running locally
- Local Docker permissions for the current user

This extension shells out to `docker`, so it behaves like your terminal Docker setup.

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
3. In the Extension Development Host window, open the Docker Lite Activity Bar view.
4. Make sure Docker is running.
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

Then refresh Docker Desktop Lite in VS Code.

Useful manual checks:

- Stop and start a container from the sidebar.
- Open a container and verify Info, Logs, Exec, and Inspect tabs.
- Run an image with a custom container name and port mapping.
- Try deleting an image used by a running container and confirm the friendly error.
- Open a named volume and browse stored files.
- Stop Docker and confirm the empty/error state is understandable.

## Limitations

- This is a local Docker CLI wrapper, not a Docker Desktop replacement.
- Logs are refreshed by polling, not true streaming.
- Exec opens an interactive terminal, but it assumes `sh` exists in the container.
- Image run options are intentionally basic and do not cover every `docker run` flag.
- Volume browsing uses a mounted running container when possible, or a temporary BusyBox helper container.
- Docker Compose metadata is displayed from container labels, but Compose file tracking/up/down is not implemented.
- No Kubernetes, registries, Docker Hub auth, vulnerability scanning, or remote Docker contexts yet.

## Project Structure

```text
src/lib/dockerClient.ts            Docker CLI wrapper and data parsing
src/views/containerTree.ts         Activity Bar tree view
src/views/containerDetailsPanel.ts Container detail webview
src/views/imageDetailsPanel.ts     Image detail webview
src/views/volumeDetailsPanel.ts    Volume detail webview
resources/                         Icons and visual assets
```

## Name

Docker Desktop Lite is an unofficial local development tool. It is not affiliated with or endorsed by Docker, Inc.
