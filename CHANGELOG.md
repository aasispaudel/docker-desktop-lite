# Changelog

All notable changes to Docklite will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning as the release process matures.

## [0.0.1] - 2026-06-09

### Added

- Initial Docklite sidebar for local Docker resources inside VS Code
- Docker daemon status and top-level CPU and memory summary
- Container tree grouped by Docker Compose project labels
- Container actions for start, stop, restart, logs, and delete
- Container details pages with Info, Logs, Exec, and Inspect tabs
- Fixed logs viewer with search, clear, and tail-style scrolling behavior
- Interactive shell entry that opens a VS Code terminal with `docker exec -it`
- Image details pages with usage, layers, run, stop, and delete actions
- Image run dialog with optional name, command, ports, volumes, and environment variables
- Volume details pages with file browsing, text preview, container usage, and delete
- Runtime picker for Docker-compatible engines across macOS, Linux, and Windows
- Runtime settings page for Colima resource limits and startup timeouts
- Runtime setup and reset scripts under `scripts/runtimes/`
- Demo Docker Compose stack under `examples/docklite-demo/` for screenshots and local testing

### Changed

- Renamed the extension branding to Docklite throughout the UI and settings namespace
- Improved user-facing Docker error messages for common command failures
- Standardized runtime setup scripts with clearer logging, validation, and timeout handling

### Notes

- Docklite is currently focused on local Docker workflows and intentionally stays smaller than Docker Desktop.
- Docker Compose metadata is displayed from container labels, but full Compose project tracking and controls are not implemented yet.
