import * as vscode from "vscode";
import { DockerClient, DockerImage, DockerImageDetails, DockerRunImageOptions } from "../lib/dockerClient";

export class ImageDetailsPanel {
  private static readonly viewType = "dockerDesktopLite.imageDetails";
  private static readonly panels = new Map<string, vscode.WebviewPanel>();

  static async open(
    docker: DockerClient,
    image: DockerImage,
    onImageChanged?: () => void,
    showDeleteDialog = false,
    showRunDialog = false
  ): Promise<void> {
    const panel = this.getOrCreatePanel(image);
    panel.webview.html = renderLoading(image);
    panel.reveal(vscode.ViewColumn.One);

    try {
      const details = await docker.imageDetails(image);
      panel.title = imageLabel(image);
      panel.webview.html = renderDetails(details, showDeleteDialog, showRunDialog);
    } catch (error) {
      panel.webview.html = renderError(imageLabel(image), formatError(error));
    }

    panel.webview.onDidReceiveMessage(async (message: {
      action?: "run" | "stop" | "remove";
      command?: string;
      options?: DockerRunImageOptions;
      text?: string;
    }) => {
      if (message.command === "copyText" && message.text) {
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage("Copied image ID.");
      }
      if (message.command === "imageAction" && message.action) {
        if (message.action === "remove") {
          showDeleteDialog = true;
          panel.webview.html = renderDetails(await docker.imageDetails(image), true);
          return;
        }

        if (message.action === "run") {
          showRunDialog = true;
          panel.webview.html = renderDetails(await docker.imageDetails(image), false, true);
          return;
        }
        if (message.action === "stop") {
          await docker.stopImageContainers(image);
        }

        onImageChanged?.();
        panel.webview.html = renderLoading(image);
        const details = await docker.imageDetails(image);
        panel.title = imageLabel(image);
        panel.webview.html = renderDetails(details);
      }
      if (message.command === "runImage") {
        try {
          await docker.runImage(image, message.options ?? {});
          onImageChanged?.();
          showRunDialog = false;
          panel.webview.html = renderLoading(image);
          const details = await docker.imageDetails(image);
          panel.title = imageLabel(image);
          panel.webview.html = renderDetails(details);
        } catch (error) {
          vscode.window.showErrorMessage(formatError(error));
        }
      }
      if (message.command === "deleteImage") {
        try {
          await docker.removeImage(image);
          onImageChanged?.();
          panel.dispose();
        } catch (error) {
          vscode.window.showErrorMessage(formatError(error));
        }
      }
    });
  }

  private static getOrCreatePanel(image: DockerImage): vscode.WebviewPanel {
    const panelId = image.id || imageLabel(image);
    const existing = this.panels.get(panelId);
    if (existing) {
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      this.viewType,
      imageLabel(image),
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.onDidDispose(() => this.panels.delete(panelId));
    this.panels.set(panelId, panel);
    return panel;
  }
}

function renderLoading(image: DockerImage): string {
  return htmlPage(`<main class="page"><h1>${escapeHtml(imageLabel(image))}</h1><p>Loading image details...</p></main>`, "");
}

function renderError(title: string, message: string): string {
  return htmlPage(
    `
      <main class="page">
        <section class="empty-state">
          <h1>${escapeHtml(title)}</h1>
          <p>Unable to load image details.</p>
          <pre>${escapeHtml(message)}</pre>
        </section>
      </main>
    `,
    ""
  );
}

function renderDetails(
  details: DockerImageDetails,
  showDeleteDialog = false,
  showRunDialog = false
): string {
  const { image, inspect, layers, usedByContainers } = details;
  const inspectRecord = asRecord(inspect);
  const imageId = String(inspectRecord.Id ?? image.id);
  const created = String(inspectRecord.Created ?? image.createdSince);
  const architecture = String(inspectRecord.Architecture ?? "-");
  const os = String(inspectRecord.Os ?? "-");
  const runningCount = usedByContainers.filter((container) => container.state === "running").length;
  const status = runningCount > 0 ? `Running (${runningCount} ${runningCount === 1 ? "container" : "containers"})` : "Not in use";

  return htmlPage(
    `
      <main class="page">
        <header class="header">
          <div>
            <p class="eyebrow">Image</p>
            <h1>${escapeHtml(imageLabel(image))}</h1>
          </div>
          <div class="status-actions">
            <div>
              <p class="status-title">Status</p>
              <p class="status-copy">${escapeHtml(status)}</p>
            </div>
            ${renderActionToolbar(runningCount > 0)}
          </div>
        </header>

        <section class="grid">
          ${infoRow("Repository", image.repository)}
          ${infoRow("Tag", image.tag)}
          ${copyableInfoRow("Image ID", imageId)}
          ${infoRow("Size", image.size)}
          ${infoRow("Created", created)}
          ${infoRow("Created since", image.createdSince)}
          ${infoRow("OS / architecture", `${os} / ${architecture}`)}
          ${infoRow("Used by containers", String(usedByContainers.length))}
        </section>

        <section class="section">
          <h2>Layers (${layers.length})</h2>
          ${renderLayers(layers)}
        </section>
      </main>
      ${renderDeleteDialog(image, showDeleteDialog)}
      ${renderRunDialog(image, showRunDialog)}
    `,
    script()
  );
}

function renderDeleteDialog(image: DockerImage, isOpen: boolean): string {
  return `
    <div class="modal-backdrop ${isOpen ? "active" : ""}" id="delete-modal" aria-hidden="${isOpen ? "false" : "true"}">
      <div class="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">Delete image?</h2>
        <p class="dialog-copy">The following image is selected for deletion:</p>
        <ul>
          <li>${escapeHtml(imageLabel(image))} (image)</li>
        </ul>
        <p class="dialog-copy">Images used by running containers cannot be deleted.</p>
        <div class="dialog-actions">
          <button class="dialog-button secondary" id="delete-cancel">Cancel</button>
          <button class="dialog-button danger" id="delete-confirm">Delete forever</button>
        </div>
      </div>
    </div>
  `;
}

function renderRunDialog(image: DockerImage, isOpen: boolean): string {
  return `
    <div class="modal-backdrop ${isOpen ? "active" : ""}" id="run-modal" aria-hidden="${isOpen ? "false" : "true"}">
      <div class="run-dialog" role="dialog" aria-modal="true" aria-labelledby="run-title">
        <div class="run-heading">
          <div class="run-icon" aria-hidden="true">${cubeIcon()}</div>
          <div>
            <h2 id="run-title">Run a new container</h2>
            <p>${escapeHtml(imageLabel(image))}</p>
          </div>
        </div>

        <div class="settings-toggle-row">
          <button class="settings-toggle" id="settings-toggle" aria-expanded="false" type="button">
            <span>Optional settings</span>
            <span class="chevron">⌄</span>
          </button>
        </div>

        <div class="run-settings" id="run-settings" hidden>
          <label class="field">
            <span>Container name</span>
            <input id="container-name" placeholder="Container name" />
          </label>
          <p class="field-help">A random name is generated if you do not provide one.</p>

          <label class="field">
            <span>Command</span>
            <input id="container-command" placeholder="Command, for example: sh -c &quot;echo hello&quot;" />
          </label>

          <div class="setting-group">
            <h3>Ports</h3>
            <div id="ports-list">
              ${pairRow("port", "Host port", "Container port")}
            </div>
            <button class="add-row" data-target="ports-list" data-kind="port" type="button">+</button>
          </div>

          <div class="setting-group">
            <h3>Volumes</h3>
            <div id="volumes-list">
              ${pairRow("volume", "Host path", "Container path")}
            </div>
            <button class="add-row" data-target="volumes-list" data-kind="volume" type="button">+</button>
          </div>

          <div class="setting-group">
            <h3>Environment variables</h3>
            <div id="env-list">
              ${pairRow("env", "Variable", "Value")}
            </div>
            <button class="add-row" data-target="env-list" data-kind="env" type="button">+</button>
          </div>
        </div>

        <div class="dialog-actions">
          <button class="dialog-button secondary" id="run-cancel">Cancel</button>
          <button class="dialog-button primary" id="run-confirm">Run</button>
        </div>
      </div>
    </div>
  `;
}

function pairRow(kind: string, leftPlaceholder: string, rightPlaceholder: string): string {
  return `
    <div class="pair-row" data-kind="${escapeAttribute(kind)}">
      <input class="pair-left" placeholder="${escapeAttribute(leftPlaceholder)}" />
      <input class="pair-right" placeholder="${escapeAttribute(rightPlaceholder)}" />
    </div>
  `;
}

function cubeIcon(): string {
  return `
    <svg viewBox="0 0 32 32">
      <path fill="currentColor" d="M16 2 4.5 8.5v15L16 30l11.5-6.5v-15L16 2Zm0 3.4 7.8 4.4-7.8 4.4-7.8-4.4L16 5.4ZM7.5 12.5l7 4v8.9l-7-4v-8.9Zm17 8.9-7 4v-8.9l7-4v8.9Z"/>
    </svg>
  `;
}

function renderActionToolbar(isRunning: boolean): string {
  return `
    <div class="toolbar" aria-label="Image actions">
      <button class="toolbar-button ${isRunning ? "primary" : "neutral"}" data-action="stop" title="Stop" aria-label="Stop" ${isRunning ? "" : "disabled"}>
        ${stopIcon()}
      </button>
      <button class="toolbar-button ${isRunning ? "neutral" : "primary"}" data-action="run" title="Run" aria-label="Run" ${isRunning ? "disabled" : ""}>
        ${playIcon()}
      </button>
      <button class="toolbar-button danger" data-action="remove" title="Delete" aria-label="Delete">
        ${trashIcon()}
      </button>
    </div>
  `;
}

function playIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M4 2.75c0-.7.77-1.13 1.37-.76l7.05 4.25a.9.9 0 0 1 0 1.52l-7.05 4.25A.9.9 0 0 1 4 11.25v-8.5Z"/>
    </svg>
  `;
}

function stopIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M4.75 3h6.5C12.22 3 13 3.78 13 4.75v6.5c0 .97-.78 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 3 11.25v-6.5C3 3.78 3.78 3 4.75 3Z"/>
    </svg>
  `;
}

function trashIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M6.5 1.75A.75.75 0 0 1 7.25 1h1.5a.75.75 0 0 1 .75.75V2h3.25a.75.75 0 0 1 0 1.5h-.34l-.68 9.55A2.75 2.75 0 0 1 8.99 15H7.01a2.75 2.75 0 0 1-2.74-1.95L3.59 3.5h-.34a.75.75 0 0 1 0-1.5H6.5v-.25Zm-1.4 1.75.67 9.44c.05.33.59.56 1.24.56h1.98c.65 0 1.19-.23 1.24-.56l.67-9.44H5.1ZM6.75 5.5c.41 0 .75.34.75.75v5a.75.75 0 0 1-1.5 0v-5c0-.41.34-.75.75-.75Zm2.5 0c.41 0 .75.34.75.75v5a.75.75 0 0 1-1.5 0v-5c0-.41.34-.75.75-.75Z"/>
    </svg>
  `;
}

function renderLayers(layers: DockerImageDetails["layers"]): string {
  if (layers.length === 0) {
    return `<p class="muted">No layers returned.</p>`;
  }

  return `
    <div class="layers">
      <div class="layer header-row">
        <span>#</span>
        <span>Instruction</span>
        <span>Size</span>
      </div>
      ${layers
        .map((layer, index) => `
          <div class="layer">
            <span class="muted">${index}</span>
            <span class="instruction">${escapeHtml(cleanInstruction(layer.createdBy))}</span>
            <span>${escapeHtml(layer.size || "0B")}</span>
          </div>
        `)
        .join("")}
    </div>
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

function copyableInfoRow(label: string, value: string): string {
  return `
    <div class="info-row">
      <span>${escapeHtml(label)}</span>
      <div class="copy-row">
        <strong>${escapeHtml(shortenImageId(value))}</strong>
        <button class="copy-button" data-copy="${escapeAttribute(value)}" title="Copy Image ID" aria-label="Copy Image ID">
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="currentColor" d="M5 1.75A1.75 1.75 0 0 1 6.75 0h5.5A1.75 1.75 0 0 1 14 1.75v7.5A1.75 1.75 0 0 1 12.25 11h-5.5A1.75 1.75 0 0 1 5 9.25v-7.5ZM6.75 1.5a.25.25 0 0 0-.25.25v7.5c0 .14.11.25.25.25h5.5c.14 0 .25-.11.25-.25v-7.5a.25.25 0 0 0-.25-.25h-5.5ZM2 4.75C2 3.78 2.78 3 3.75 3H4v1.5h-.25a.25.25 0 0 0-.25.25v8.5c0 .14.11.25.25.25h6.5c.14 0 .25-.11.25-.25V13H12v.25A1.75 1.75 0 0 1 10.25 15h-6.5A1.75 1.75 0 0 1 2 13.25v-8.5Z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function htmlPage(body: string, pageScript: string): string {
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
            --accent: var(--vscode-textLink-foreground);
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

          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 10px;
          }

          .info-row,
          .layers {
            border: 1px solid var(--border);
            border-radius: 6px;
          }

          .info-row {
            padding: 12px;
          }

          .info-row span,
          .muted {
            color: var(--muted);
          }

          .info-row strong {
            display: block;
            margin-top: 6px;
            overflow-wrap: anywhere;
            font-weight: 500;
          }

          .copy-row {
            display: flex;
            align-items: flex-start;
            gap: 8px;
          }

          .copy-row strong {
            flex: 1;
            min-width: 0;
          }

          .copy-button {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            margin-top: 2px;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: transparent;
            color: var(--muted);
            cursor: pointer;
          }

          .copy-button:hover {
            color: var(--fg);
            border-color: var(--accent);
          }

          .status-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 12px;
            min-width: 260px;
          }

          .status-title {
            margin: 0 0 4px;
            color: var(--fg);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .04em;
            text-transform: uppercase;
          }

          .status-copy {
            margin: 0;
            color: var(--muted);
            font-size: 14px;
          }

          .toolbar {
            display: flex;
            align-items: center;
            gap: 1px;
          }

          .toolbar-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 28px;
            border: 0;
            color: white;
            cursor: pointer;
          }

          .toolbar-button:first-child {
            border-radius: 6px 0 0 6px;
          }

          .toolbar-button:nth-child(2) {
            border-radius: 0 6px 6px 0;
          }

          .toolbar-button svg {
            width: 14px;
            height: 14px;
          }

          .toolbar-button.primary {
            background: #2563eb;
          }

          .toolbar-button.neutral {
            background: #2f333a;
            color: #8b9099;
          }

          .toolbar-button.danger {
            margin-left: 8px;
            border-radius: 6px;
            background: #dc354f;
          }

          .toolbar-button:disabled {
            cursor: default;
            opacity: .45;
          }

          .section {
            margin-top: 28px;
          }

          .layers {
            overflow: hidden;
          }

          .layer {
            display: grid;
            grid-template-columns: 48px minmax(0, 1fr) 120px;
            gap: 12px;
            align-items: center;
            border-top: 1px solid var(--border);
            padding: 10px 12px;
          }

          .layer:first-child {
            border-top: 0;
          }

          .header-row {
            color: var(--muted);
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
          }

          .instruction {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .empty-state {
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 22px;
          }

          .empty-state p {
            color: var(--muted);
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

          .run-dialog {
            box-sizing: border-box;
            width: min(760px, 100%);
            max-height: calc(100vh - 56px);
            overflow: auto;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--vscode-editor-background);
            box-shadow: 0 18px 46px rgb(0 0 0 / .42);
            padding: 34px 38px 28px;
          }

          .run-heading {
            display: flex;
            align-items: center;
            gap: 22px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 28px;
          }

          .run-heading h2 {
            margin: 0 0 6px;
            font-size: 22px;
          }

          .run-heading p {
            margin: 0;
            color: #8fb0cc;
            font-size: 15px;
          }

          .run-icon {
            display: inline-flex;
            width: 58px;
            height: 58px;
            color: #2f80ff;
          }

          .settings-toggle-row {
            border-bottom: 1px solid var(--border);
          }

          .settings-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            border: 0;
            background: transparent;
            color: var(--fg);
            cursor: pointer;
            font: inherit;
            font-size: 21px;
            padding: 22px 0;
            text-align: left;
          }

          .chevron {
            font-size: 24px;
          }

          .run-settings {
            display: grid;
            gap: 20px;
            padding: 18px 0 4px;
          }

          .field {
            display: grid;
            gap: 8px;
          }

          .field span,
          .setting-group h3 {
            font-size: 14px;
            font-weight: 650;
          }

          .field-help {
            margin: -12px 0 0;
            color: var(--muted);
          }

          input {
            box-sizing: border-box;
            width: 100%;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font: inherit;
            padding: 9px 10px;
          }

          .setting-group {
            display: grid;
            gap: 10px;
          }

          .setting-group h3 {
            margin: 0;
          }

          .pair-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 8px;
          }

          .add-row {
            width: 30px;
            height: 30px;
            border: 0;
            background: transparent;
            color: var(--accent);
            cursor: pointer;
            font-size: 26px;
            line-height: 1;
            padding: 0;
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
            border: 2px solid var(--accent);
            background: transparent;
            color: var(--accent);
          }

          .dialog-button.danger {
            border: 2px solid #dc354f;
            background: #dc354f;
            color: white;
          }

          .dialog-button.primary {
            border: 2px solid #2563eb;
            background: #2563eb;
            color: white;
          }

          @media (max-width: 760px) {
            .header {
              align-items: flex-start;
              flex-direction: column;
            }

            .status-actions {
              justify-content: space-between;
              min-width: 0;
              width: 100%;
            }

            .run-dialog {
              padding: 24px 20px;
            }

            .pair-row {
              grid-template-columns: 1fr;
            }
          }
        </style>
      </head>
      <body>
        ${body}
        ${pageScript}
      </body>
    </html>
  `;
}

function script(): string {
  const nonce = getNonce();
  return `
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll(".copy-button").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({ command: "copyText", text: button.dataset.copy });
        });
      });

      document.querySelectorAll(".toolbar-button").forEach((button) => {
        button.addEventListener("click", () => {
          if (button.disabled) {
            return;
          }

          vscode.postMessage({ command: "imageAction", action: button.dataset.action });
        });
      });

      const deleteModal = document.getElementById("delete-modal");
      const deleteCancel = document.getElementById("delete-cancel");
      const deleteConfirm = document.getElementById("delete-confirm");
      const runModal = document.getElementById("run-modal");
      const runCancel = document.getElementById("run-cancel");
      const runConfirm = document.getElementById("run-confirm");
      const settingsToggle = document.getElementById("settings-toggle");
      const runSettings = document.getElementById("run-settings");
      let settingsExpanded = settingsToggle?.getAttribute("aria-expanded") === "true";
      const setSettingsExpanded = (expanded) => {
        settingsExpanded = expanded;
        settingsToggle?.setAttribute("aria-expanded", expanded ? "true" : "false");
        if (runSettings) {
          runSettings.hidden = !expanded;
        }
        const chevron = settingsToggle?.querySelector(".chevron");
        if (chevron) {
          chevron.textContent = expanded ? "⌃" : "⌄";
        }
      };
      setSettingsExpanded(settingsExpanded);

      deleteCancel?.addEventListener("click", () => {
        deleteModal?.classList.remove("active");
        deleteModal?.setAttribute("aria-hidden", "true");
      });

      deleteConfirm?.addEventListener("click", () => {
        vscode.postMessage({ command: "deleteImage" });
      });

      runCancel?.addEventListener("click", () => {
        runModal?.classList.remove("active");
        runModal?.setAttribute("aria-hidden", "true");
      });

      settingsToggle?.addEventListener("click", () => {
        setSettingsExpanded(!settingsExpanded);
      });

      document.querySelectorAll(".add-row").forEach((button) => {
        button.addEventListener("click", () => {
          const target = document.getElementById(button.dataset.target);
          if (!target) {
            return;
          }

          const placeholders = {
            port: ["Host port", "Container port"],
            volume: ["Host path", "Container path"],
            env: ["Variable", "Value"]
          }[button.dataset.kind] || ["", ""];

          const row = document.createElement("div");
          row.className = "pair-row";
          row.dataset.kind = button.dataset.kind;
          row.innerHTML = '<input class="pair-left" placeholder="' + placeholders[0] + '" />' +
            '<input class="pair-right" placeholder="' + placeholders[1] + '" />';
          target.appendChild(row);
        });
      });

      runConfirm?.addEventListener("click", () => {
        const pairValues = (selector) => Array.from(document.querySelectorAll(selector))
          .map((row) => ({
            left: row.querySelector(".pair-left")?.value?.trim() || "",
            right: row.querySelector(".pair-right")?.value?.trim() || ""
          }))
          .filter((row) => row.left || row.right);

        const options = {
          containerName: document.getElementById("container-name")?.value?.trim() || undefined,
          command: document.getElementById("container-command")?.value?.trim() || undefined,
          ports: pairValues('#ports-list .pair-row').map((row) => ({ host: row.left, container: row.right })),
          volumes: pairValues('#volumes-list .pair-row').map((row) => ({ host: row.left, container: row.right })),
          env: pairValues('#env-list .pair-row').map((row) => ({ name: row.left, value: row.right }))
        };

        vscode.postMessage({ command: "runImage", options });
      });

      deleteModal?.addEventListener("click", (event) => {
        if (event.target === deleteModal) {
          deleteModal.classList.remove("active");
          deleteModal.setAttribute("aria-hidden", "true");
        }
      });

      runModal?.addEventListener("click", (event) => {
        if (event.target === runModal) {
          runModal.classList.remove("active");
          runModal.setAttribute("aria-hidden", "true");
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && deleteModal?.classList.contains("active")) {
          deleteModal.classList.remove("active");
          deleteModal.setAttribute("aria-hidden", "true");
        }
        if (event.key === "Escape" && runModal?.classList.contains("active")) {
          runModal.classList.remove("active");
          runModal.setAttribute("aria-hidden", "true");
        }
      });
    </script>
  `;
}

function imageLabel(image: DockerImage): string {
  if (image.repository === "<none>" && image.tag === "<none>") {
    return image.id || "<none>";
  }

  return `${image.repository}:${image.tag}`;
}

function cleanInstruction(value: string): string {
  return value.replace(/^\/bin\/sh -c #(nop)\s+/i, "").replace(/^\/bin\/sh -c\s+/i, "RUN ");
}

function shortenImageId(value: string): string {
  return value.replace(/^sha256:/, "").slice(0, 12) || value;
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

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => possible[Math.floor(Math.random() * possible.length)]).join("");
}
