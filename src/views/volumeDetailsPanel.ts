import * as vscode from "vscode";
import { DockerClient, DockerVolume, DockerVolumeDetails } from "../lib/dockerClient";

export class VolumeDetailsPanel {
  private static readonly viewType = "docklite.volumeDetails";
  private static readonly panels = new Map<string, vscode.WebviewPanel>();

  static async open(
    docker: DockerClient,
    volume: DockerVolume,
    onOpenContainer?: (containerId: string) => Promise<void>,
    onVolumeChanged?: () => void,
    showDeleteDialog = false
  ): Promise<void> {
    const panel = this.getOrCreatePanel(volume);
    let currentPath = "";
    let preview: VolumePreview | undefined;
    panel.webview.html = renderLoading(volume);
    panel.reveal(vscode.ViewColumn.One);

    try {
      const details = await docker.volumeDetails(volume, currentPath);
      panel.title = volume.name;
      panel.webview.html = renderDetails(details, showDeleteDialog, preview);
    } catch (error) {
      panel.webview.html = renderError(volume.name, formatError(error));
    }

    panel.webview.onDidReceiveMessage(async (message: {
      command?: string;
      containerId?: string;
      path?: string;
    }) => {
      if (message.command === "openContainer" && message.containerId) {
        await onOpenContainer?.(message.containerId);
      }
      if (message.command === "navigateVolumePath") {
        currentPath = normalizeWebviewPath(message.path ?? "");
        preview = undefined;
        const details = await docker.volumeDetails(volume, currentPath);
        panel.webview.html = renderDetails(details);
      }
      if (message.command === "previewVolumeFile" && message.path !== undefined) {
        const previewPath = normalizeWebviewPath(message.path);
        const content = await docker.readVolumeTextFile(volume, previewPath);
        currentPath = parentPath(previewPath);
        preview = {
          content,
          path: previewPath
        };
        const details = await docker.volumeDetails(volume, currentPath);
        panel.webview.html = renderDetails(details, false, preview);
      }
      if (message.command === "deleteVolume") {
        try {
          await docker.removeVolume(volume.name);
          onVolumeChanged?.();
          panel.dispose();
        } catch (error) {
          vscode.window.showErrorMessage(formatError(error));
        }
      }
    });
  }

  private static getOrCreatePanel(volume: DockerVolume): vscode.WebviewPanel {
    const existing = this.panels.get(volume.name);
    if (existing) {
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      this.viewType,
      volume.name,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.onDidDispose(() => this.panels.delete(volume.name));
    this.panels.set(volume.name, panel);
    return panel;
  }
}

function renderLoading(volume: DockerVolume): string {
  return htmlPage(`<main class="page"><h1>${escapeHtml(volume.name)}</h1><p>Loading volume details...</p></main>`);
}

function renderError(title: string, message: string): string {
  return htmlPage(`
    <main class="page">
      <section class="empty-state">
        <h1>${escapeHtml(title)}</h1>
        <p>Unable to load volume details.</p>
        <pre>${escapeHtml(message)}</pre>
      </section>
    </main>
  `);
}

interface VolumePreview {
  content: string;
  path: string;
}

function renderDetails(
  details: DockerVolumeDetails,
  showDeleteDialog = false,
  preview?: VolumePreview
): string {
  const { inspect, mounts, usedByContainers, volume } = details;
  const inspectRecord = asRecord(inspect);
  const createdAt = String(inspectRecord.CreatedAt ?? "-");

  return htmlPage(`
    <main class="page">
      <header class="header">
        <div>
          <p class="eyebrow">Volume</p>
          <h1>${escapeHtml(volume.name)}</h1>
        </div>
        <button class="delete-volume-button" id="open-delete-dialog" title="Delete volume" aria-label="Delete volume">
          ${trashIcon()}
        </button>
      </header>

      <section class="grid">
        ${infoRow("Name", volume.name)}
        ${infoRow("Driver", volume.driver)}
        ${infoRow("Scope", volume.scope)}
        ${infoRow("Mountpoint", volume.mountpoint)}
        ${infoRow("Created", createdAt)}
        ${infoRow("Used by containers", String(usedByContainers.length))}
        ${infoRow("Mounts", String(mounts.length))}
      </section>

      <nav class="tabs" aria-label="Volume details">
        <button class="tab active" data-tab="stored-data">Stored data</button>
        <button class="tab" data-tab="container-use">Container in-use</button>
      </nav>

      <section class="panel active" id="stored-data">
        ${renderStoredData(details, preview)}
      </section>

      <section class="panel" id="container-use">
        ${renderMounts(mounts)}
      </section>
    </main>
    ${renderDeleteDialog(volume, showDeleteDialog)}
  `);
}

function renderDeleteDialog(volume: DockerVolume, isOpen: boolean): string {
  return `
    <div class="modal-backdrop ${isOpen ? "active" : ""}" id="delete-modal" aria-hidden="${isOpen ? "false" : "true"}">
      <div class="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">Delete volume?</h2>
        <p class="dialog-copy">The following volume is selected for deletion:</p>
        <ul>
          <li>${escapeHtml(volume.name)} (volume)</li>
        </ul>
        <p class="dialog-copy">Stored data in this volume will be deleted permanently.</p>
        <div class="dialog-actions">
          <button class="dialog-button secondary" id="delete-cancel">Cancel</button>
          <button class="dialog-button danger" id="delete-confirm">Delete forever</button>
        </div>
      </div>
    </div>
  `;
}

function renderStoredData(details: DockerVolumeDetails, preview?: VolumePreview): string {
  if (details.storedDataUnavailable) {
    return `<p class="muted">${escapeHtml(details.storedDataUnavailable)}</p>`;
  }

  if (details.files.length === 0) {
    return `<p class="muted">No files returned for this volume.</p>`;
  }

  return `
    <div class="path-bar">
      <span class="muted">/${escapeHtml(details.currentPath)}</span>
    </div>
    <div class="stored-data">
      <div class="file-row header-row">
        <span>Name</span>
        <span>Type</span>
        <span>Size</span>
        <span>Last modified</span>
        <span>Mode</span>
      </div>
      ${details.currentPath ? parentRow(details.currentPath) : ""}
      ${details.files
        .map((file) => `
          <div class="file-row">
            <button class="file-name file-action" data-path="${escapeAttribute(joinWebviewPath(details.currentPath, file.name))}" data-kind="${file.isDirectory ? "directory" : "file"}">
              <span class="file-icon" aria-hidden="true">${file.isDirectory ? folderIcon() : fileIcon()}</span>
              ${escapeHtml(file.name)}
            </button>
            <span>${escapeHtml(file.type)}</span>
            <span>${escapeHtml(formatBytes(file.sizeBytes))}</span>
            <span>${escapeHtml(formatRelativeTime(file.modifiedEpoch))}</span>
            <span>${escapeHtml(file.mode || "-")}</span>
          </div>
        `)
        .join("")}
    </div>
    ${preview ? renderPreview(preview) : ""}
  `;
}

function parentRow(currentPath: string): string {
  return `
    <div class="file-row">
      <button class="file-name file-action" data-path="${escapeAttribute(parentPath(currentPath))}" data-kind="directory">
        <span class="file-icon" aria-hidden="true">${folderIcon()}</span>
        ..
      </button>
      <span>Directory</span>
      <span>-</span>
      <span>-</span>
      <span>-</span>
    </div>
  `;
}

function renderPreview(preview: VolumePreview): string {
  return `
    <section class="preview">
      <div class="preview-heading">
        <h2>${escapeHtml(preview.path)}</h2>
        <span class="muted">${escapeHtml(formatBytes(preview.content.length))}</span>
      </div>
      <pre>${escapeHtml(preview.content || "No preview returned.")}</pre>
    </section>
  `;
}

function renderMounts(mounts: DockerVolumeDetails["mounts"]): string {
  if (mounts.length === 0) {
    return `<p class="muted">No containers currently mount this volume.</p>`;
  }

  return `
    <div class="mounts">
      <div class="mount header-row">
        <span>Container</span>
        <span>Destination</span>
        <span>Mode</span>
      </div>
      ${mounts
        .map((mount) => `
          <div class="mount">
            <button class="container-link" data-container-id="${escapeAttribute(mount.containerId)}">
              ${escapeHtml(mount.containerName)}
            </button>
            <span>${escapeHtml(mount.destination || "-")}</span>
            <span>${escapeHtml(mount.mode || (mount.rw ? "rw" : "ro"))}</span>
          </div>
        `)
        .join("")}
    </div>
  `;
}

function folderIcon(): string {
  return `
    <svg width="18" height="18" viewBox="0 0 16 16">
      <path fill="currentColor" d="M1.75 2.5h4.1c.46 0 .9.18 1.24.5l.88.84h6.28c.97 0 1.75.78 1.75 1.75v6.16c0 .97-.78 1.75-1.75 1.75H1.75A1.75 1.75 0 0 1 0 11.75v-7.5C0 3.28.78 2.5 1.75 2.5Zm0 1.5a.25.25 0 0 0-.25.25v7.5c0 .14.11.25.25.25h12.5c.14 0 .25-.11.25-.25V5.59a.25.25 0 0 0-.25-.25H7.38L6.06 4.08A.25.25 0 0 0 5.85 4h-4.1Z"/>
    </svg>
  `;
}

function fileIcon(): string {
  return `
    <svg width="18" height="18" viewBox="0 0 16 16">
      <path fill="currentColor" d="M3.75 1h5.5c.46 0 .9.18 1.24.51l2 2c.33.32.51.77.51 1.24v9.5c0 .97-.78 1.75-1.75 1.75h-7.5A1.75 1.75 0 0 1 2 14.25V2.75C2 1.78 2.78 1 3.75 1Zm5.5 1.5h-5.5a.25.25 0 0 0-.25.25v11.5c0 .14.11.25.25.25h7.5c.14 0 .25-.11.25-.25v-9.5a.25.25 0 0 0-.07-.18l-2-2a.25.25 0 0 0-.18-.07ZM5 6.75C5 6.34 5.34 6 5.75 6h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 6.75Zm0 3C5 9.34 5.34 9 5.75 9h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 9.75Z"/>
    </svg>
  `;
}

function trashIcon(): string {
  return `
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M6.5 1.75A.75.75 0 0 1 7.25 1h1.5a.75.75 0 0 1 .75.75V2h3.25a.75.75 0 0 1 0 1.5h-.34l-.68 9.55A2.75 2.75 0 0 1 8.99 15H7.01a2.75 2.75 0 0 1-2.74-1.95L3.59 3.5h-.34a.75.75 0 0 1 0-1.5H6.5v-.25Zm-1.4 1.75.67 9.44c.05.33.59.56 1.24.56h1.98c.65 0 1.19-.23 1.24-.56l.67-9.44H5.1ZM6.75 5.5c.41 0 .75.34.75.75v5a.75.75 0 0 1-1.5 0v-5c0-.41.34-.75.75-.75Zm2.5 0c.41 0 .75.34.75.75v5a.75.75 0 0 1-1.5 0v-5c0-.41.34-.75.75-.75Z"/>
    </svg>
  `;
}

function infoRow(label: string, value: string): string {
  return `
    <div class="info-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

function htmlPage(body: string): string {
  const nonce = getNonce();
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          :root {
            color-scheme: dark light;
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --muted: var(--vscode-descriptionForeground);
            --border: var(--vscode-panel-border);
          }

          body {
            margin: 0;
            background: var(--bg);
            color: var(--fg);
            font-family: var(--vscode-font-family);
          }

          .page {
            box-sizing: border-box;
            width: min(1280px, 100%);
            padding: 28px 24px;
          }

          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 18px;
            margin-bottom: 22px;
          }

          .eyebrow {
            margin: 0 0 4px;
            color: var(--muted);
            font-size: 12px;
            text-transform: uppercase;
          }

          h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 650;
          }

          h2 {
            margin: 0 0 12px;
            font-size: 15px;
          }

          .delete-volume-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 42px;
            height: 32px;
            border: 0;
            border-radius: 6px;
            background: #dc354f;
            color: white;
            cursor: pointer;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 10px;
          }

          .info-row,
          .mounts,
          .empty-state {
            border: 1px solid var(--border);
            border-radius: 6px;
          }

          .info-row,
          .empty-state {
            padding: 12px;
          }

          .info-row span,
          .muted,
          .empty-state p {
            color: var(--muted);
          }

          .info-row strong {
            display: block;
            margin-top: 6px;
            overflow-wrap: anywhere;
            font-weight: 500;
          }

          .section {
            margin-top: 28px;
          }

          .tabs {
            display: flex;
            gap: 18px;
            border-bottom: 1px solid var(--border);
            margin-top: 24px;
          }

          .tab {
            border: 0;
            border-bottom: 2px solid transparent;
            background: transparent;
            color: var(--muted);
            cursor: pointer;
            font: inherit;
            padding: 10px 0 9px;
          }

          .tab.active {
            border-bottom-color: var(--vscode-textLink-foreground);
            color: var(--fg);
            font-weight: 600;
          }

          .panel {
            display: none;
            padding-top: 22px;
          }

          .panel.active {
            display: block;
          }

          .mounts {
            overflow: hidden;
          }

          .stored-data {
            overflow: hidden;
            border: 1px solid var(--border);
            border-radius: 6px;
          }

          .path-bar {
            margin-bottom: 10px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
          }

          .file-row {
            display: grid;
            grid-template-columns: minmax(220px, 1.4fr) 120px 110px 150px 110px;
            gap: 12px;
            align-items: center;
            border-top: 1px solid var(--border);
            padding: 10px 12px;
          }

          .file-row:first-child {
            border-top: 0;
          }

          .file-name {
            display: flex;
            align-items: center;
            gap: 9px;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .file-action {
            border: 0;
            background: transparent;
            color: var(--fg);
            cursor: pointer;
            font: inherit;
            padding: 0;
            text-align: left;
          }

          .file-action:hover {
            color: var(--vscode-textLink-foreground);
            text-decoration: underline;
          }

          .file-icon {
            display: inline-flex;
            color: var(--fg);
            flex: 0 0 auto;
          }

          .mount {
            display: grid;
            grid-template-columns: minmax(160px, .8fr) minmax(220px, 1.4fr) 90px;
            gap: 12px;
            align-items: center;
            border-top: 1px solid var(--border);
            padding: 10px 12px;
          }

          .mount:first-child {
            border-top: 0;
          }

          .header-row {
            color: var(--muted);
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
          }

          .container-link {
            border: 0;
            background: transparent;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            font: inherit;
            overflow: hidden;
            padding: 0;
            text-align: left;
            text-decoration: underline;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          pre {
            overflow: auto;
          }

          .preview {
            margin-top: 18px;
          }

          .preview-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .preview pre {
            box-sizing: border-box;
            max-height: 360px;
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px;
            white-space: pre-wrap;
          }

          .modal-backdrop {
            position: fixed;
            inset: 0;
            z-index: 20;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgb(0 0 0 / .58);
            padding: 24px;
          }

          .modal-backdrop.active {
            display: flex;
          }

          .delete-dialog {
            box-sizing: border-box;
            width: min(560px, 100%);
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--vscode-editor-background);
            box-shadow: 0 18px 46px rgb(0 0 0 / .42);
            padding: 22px 26px;
          }

          .delete-dialog h2 {
            margin: 0 0 16px;
            color: var(--fg);
            font-size: 22px;
          }

          .delete-dialog ul {
            margin: 14px 0 20px;
            font-size: 15px;
            line-height: 1.5;
          }

          .dialog-copy {
            margin: 0;
            color: #8fb0cc;
            font-size: 15px;
            line-height: 1.45;
          }

          .dialog-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 22px;
          }

          .dialog-button {
            border-radius: 6px;
            cursor: pointer;
            font: inherit;
            font-weight: 700;
            padding: 10px 18px;
          }

          .dialog-button.secondary {
            border: 2px solid var(--vscode-textLink-foreground);
            background: transparent;
            color: var(--vscode-textLink-foreground);
          }

          .dialog-button.danger {
            border: 2px solid #dc354f;
            background: #dc354f;
            color: white;
          }

          @media (max-width: 760px) {
            .header {
              align-items: flex-start;
            }

            .file-row {
              grid-template-columns: minmax(180px, 1fr) 90px 90px;
            }

            .file-row span:nth-child(4),
            .file-row span:nth-child(5) {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        ${body}
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          document.querySelectorAll(".container-link").forEach((button) => {
            button.addEventListener("click", () => {
              vscode.postMessage({ command: "openContainer", containerId: button.dataset.containerId });
            });
          });

          document.querySelectorAll(".file-action").forEach((button) => {
            button.addEventListener("click", () => {
              if (button.dataset.kind === "directory") {
                vscode.postMessage({ command: "navigateVolumePath", path: button.dataset.path || "" });
                return;
              }

              vscode.postMessage({ command: "previewVolumeFile", path: button.dataset.path || "" });
            });
          });

          document.querySelectorAll(".tab").forEach((tab) => {
            tab.addEventListener("click", () => {
              document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
              document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
              tab.classList.add("active");
              document.getElementById(tab.dataset.tab)?.classList.add("active");
            });
          });

          const deleteModal = document.getElementById("delete-modal");
          const openDeleteDialog = document.getElementById("open-delete-dialog");
          const deleteCancel = document.getElementById("delete-cancel");
          const deleteConfirm = document.getElementById("delete-confirm");

          openDeleteDialog?.addEventListener("click", () => {
            deleteModal?.classList.add("active");
            deleteModal?.setAttribute("aria-hidden", "false");
            deleteCancel?.focus();
          });

          deleteCancel?.addEventListener("click", () => {
            deleteModal?.classList.remove("active");
            deleteModal?.setAttribute("aria-hidden", "true");
          });

          deleteConfirm?.addEventListener("click", () => {
            vscode.postMessage({ command: "deleteVolume" });
          });

          deleteModal?.addEventListener("click", (event) => {
            if (event.target === deleteModal) {
              deleteModal.classList.remove("active");
              deleteModal.setAttribute("aria-hidden", "true");
            }
          });

          document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && deleteModal?.classList.contains("active")) {
              deleteModal.classList.remove("active");
              deleteModal.setAttribute("aria-hidden", "true");
            }
          });
        </script>
      </body>
    </html>
  `;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeWebviewPath(value: string): string {
  return value
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function joinWebviewPath(currentPath: string, name: string): string {
  return normalizeWebviewPath([currentPath, name].filter(Boolean).join("/"));
}

function parentPath(value: string): string {
  const parts = normalizeWebviewPath(value).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function formatBytes(value: number): string {
  if (value <= 0) {
    return "0B";
  }

  if (value >= 1024 ** 3) {
    return `${(value / 1024 ** 3).toFixed(2)}GiB`;
  }
  if (value >= 1024 ** 2) {
    return `${(value / 1024 ** 2).toFixed(2)}MiB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)}KiB`;
  }

  return `${value} Bytes`;
}

function formatRelativeTime(epochSeconds: number): string {
  if (!epochSeconds) {
    return "-";
  }

  const elapsedMs = Date.now() - epochSeconds * 1000;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const units: Array<[string, number]> = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1]
  ];

  for (const [unit, seconds] of units) {
    const count = Math.floor(elapsedSeconds / seconds);
    if (count >= 1) {
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => possible[Math.floor(Math.random() * possible.length)]).join("");
}
