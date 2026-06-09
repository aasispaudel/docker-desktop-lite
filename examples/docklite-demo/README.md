# Docklite Demo Compose

This fixture is safe to use for screenshots, demo GIFs, and future regression testing. It uses public images and generic service names, so it will not expose any real project containers.

## Start

```sh
cd examples/docklite-demo
docker compose up -d
```

Then refresh Docklite in the Extension Development Host.

## What It Shows

- `web`: nginx frontend on <http://localhost:8088>
- `api`: tiny whoami HTTP service on <http://localhost:8089>
- `postgres`: database with a named volume on `localhost:55432`
- `redis`: cache with a named volume on `localhost:56379`
- `adminer`: database UI on <http://localhost:8090>
- `grafana`: dashboard UI on <http://localhost:3001>
- `minio`: object storage API on <http://localhost:9002> and console on <http://localhost:9003>
- `worker`: steady log output for the Logs tab
- `seed`: short-lived container that exits on purpose

The Compose project name is `docklite-demo`, so containers show up with clean names like `web-1`, `postgres-1`, and `worker-1` inside Docklite.

## Stop

```sh
docker compose down
```

Remove demo volumes too:

```sh
docker compose down -v
```

## Suggested GIF Flow

1. Start the stack with `docker compose up -d`.
2. Refresh Docklite.
3. Expand `Containers`, `Images`, and `Volumes`.
4. Open `worker-1` and show the Logs tab.
5. Open `postgres-1` and show port mapping and stats.
6. Open `postgres_data` and show stored data.
7. Open `nginx:alpine` or `busybox:1.36` image details.
