import * as vscode from "vscode";
import { ContainerDetails, DockerClient, DockerContainer } from "../lib/dockerClient";

export class ContainerDetailsPanel {
  private static readonly viewType = "dockerDesktopLite.containerDetails";
  private static readonly panels = new Map<string, vscode.WebviewPanel>();

  static async open(
    docker: DockerClient,
    container: DockerContainer,
    extensionUri: vscode.Uri,
    onContainerChanged?: () => void,
    showDeleteDialog = false
  ): Promise<void> {
    const panel = this.getOrCreatePanel(container, extensionUri);
    let currentContainer = container;
    panel.webview.html = renderLoading(currentContainer);
    panel.reveal(vscode.ViewColumn.One);

    try {
      currentContainer = await resolveCurrentContainer(docker, currentContainer);
      const details = await docker.containerDetails(currentContainer);
      panel.title = currentContainer.name;
      panel.webview.html = renderDetails(details, panel.webview, showDeleteDialog);
    } catch (error) {
      panel.webview.html = renderError(currentContainer.name, formatError(error));
    }

    panel.webview.onDidReceiveMessage(async (message: {
      action?: "start" | "stop" | "restart" | "remove";
      command?: string;
      path?: string;
      text?: string;
      url?: string;
    }) => {
      if (message.command === "openExternal" && message.url) {
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
      if (message.command === "copyText" && message.text) {
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage("Copied container ID.");
      }
      if (message.command === "openFile" && message.path) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(message.path));
        await vscode.window.showTextDocument(document, { preview: false });
      }
      if (message.command === "refreshLogs") {
        currentContainer = await resolveCurrentContainer(docker, currentContainer);
        const logs = await docker.logs(currentContainer.id, message.text);
        await panel.webview.postMessage({ command: "logs", logs });
      }
      if (message.command === "openShell") {
        currentContainer = await resolveCurrentContainer(docker, currentContainer);
        if (currentContainer.state !== "running") {
          vscode.window.showWarningMessage("Container must be running before opening an interactive shell.");
          return;
        }

        const terminal = vscode.window.createTerminal({
          name: `${currentContainer.name} shell`,
          shellPath: "docker",
          shellArgs: ["exec", "-it", currentContainer.id, "sh"]
        });
        terminal.show();
      }
      if (message.command === "containerAction" && message.action) {
        currentContainer = await resolveCurrentContainer(docker, currentContainer);
        if (message.action === "remove") {
          try {
            await docker.removeContainer(currentContainer.id);
            onContainerChanged?.();
            panel.dispose();
          } catch (error) {
            const freshContainer = await docker.findMatchingContainer(currentContainer);
            onContainerChanged?.();

            if (!freshContainer) {
              panel.dispose();
              return;
            }

            vscode.window.showErrorMessage(formatError(error));
          }
          return;
        }

        await docker.containerAction(message.action, currentContainer.id);
        onContainerChanged?.();

        const freshContainer = await docker.findMatchingContainer(currentContainer);
        if (!freshContainer) {
          panel.dispose();
          return;
        }

        currentContainer = freshContainer;
        panel.webview.html = renderLoading(freshContainer);
        const freshDetails = await docker.containerDetails(freshContainer);
        panel.title = freshContainer.name;
        panel.webview.html = renderDetails(freshDetails, panel.webview);
      }
    });
  }

  private static getOrCreatePanel(
    container: DockerContainer,
    extensionUri: vscode.Uri
  ): vscode.WebviewPanel {
    const panelId = container.id;
    const existing = this.panels.get(panelId);
    if (existing) {
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      this.viewType,
      container.name,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "resources")]
      }
    );

    panel.onDidDispose(() => this.panels.delete(panelId));
    this.panels.set(panelId, panel);
    return panel;
  }
}

async function resolveCurrentContainer(
  docker: DockerClient,
  container: DockerContainer
): Promise<DockerContainer> {
  const currentContainer = await docker.findMatchingContainer(container);
  if (!currentContainer) {
    throw new Error("Container no longer exists in the current Docker context. Refresh Docklite.");
  }

  return currentContainer;
}

function renderLoading(container: DockerContainer): string {
  return htmlPage(
    `<main class="page"><h1>${escapeHtml(container.name)}</h1><p>Loading container details...</p></main>`,
    ""
  );
}

function renderError(title: string, message: string): string {
  return htmlPage(
    `
      <main class="page">
        <section class="empty-state">
          <h1>${escapeHtml(title)}</h1>
          <p>Unable to load container details.</p>
          <pre>${escapeHtml(message)}</pre>
        </section>
      </main>
    `,
    ""
  );
}

function renderDetails(
  details: ContainerDetails,
  webview: vscode.Webview,
  showDeleteDialog = false
): string {
  const { container, stats, inspect, logs, ports } = details;
  const inspectRecord = asRecord(inspect);
  const config = asRecord(inspectRecord.Config);
  const state = asRecord(inspectRecord.State);
  const created = String(inspectRecord.Created ?? "");
  const lastStarted = formatRelativeTime(String(state.StartedAt ?? ""));
  const statusStartedAt = lastStarted === "-" ? "" : ` (${lastStarted})`;
  const image = String(config.Image ?? container.image);
  const command = Array.isArray(config.Cmd) ? config.Cmd.join(" ") : String(config.Cmd ?? "");
  const entrypoint = Array.isArray(config.Entrypoint)
    ? config.Entrypoint.join(" ")
    : String(config.Entrypoint ?? "");

  return htmlPage(
    `
      <main class="page">
        <header class="header">
          <div>
            <p class="eyebrow">${escapeHtml(container.composeProject ?? "container")}</p>
            <h1>${escapeHtml(container.name)}</h1>
          </div>
          <div class="status-actions">
            <div>
              <p class="status-title">Status</p>
              <p class="status-copy">${escapeHtml(toTitleCase(container.state))}${escapeHtml(statusStartedAt)}</p>
            </div>
            ${renderActionToolbar(container)}
          </div>
        </header>

        <nav class="tabs" aria-label="Container details">
          <button class="tab active" data-tab="info">Info</button>
          <button class="tab" data-tab="logs">Logs</button>
          <button class="tab" data-tab="exec">Exec</button>
          <button class="tab" data-tab="inspect">Inspect</button>
        </nav>

        <section class="panel active" id="info">
          <div class="grid">
            ${infoRow("Name", container.name)}
            ${copyableInfoRow("Container ID", container.id)}
            ${infoRow("Image", image)}
            ${infoRow("Last Started", lastStarted)}
            ${command ? infoRow("Command", command) : ""}
            ${infoRow("Created", created)}
            ${entrypoint ? infoRow("Entrypoint", entrypoint) : ""}
          </div>

          <h2>Stats</h2>
          <div class="grid">
            ${infoRow("CPU Usage", `${stats.cpuPercent.toFixed(2)}%`)}
            ${infoRow("Memory Usage", `${formatBytes(stats.memoryUsageBytes)} / ${formatBytes(stats.memoryLimitBytes)}`)}
            ${infoRow("Disk Read / Write", `${formatBytes(stats.blockReadBytes)} / ${formatBytes(stats.blockWriteBytes)}`)}
            ${infoRow("Network I/O", `${formatBytes(stats.networkRxBytes)} / ${formatBytes(stats.networkTxBytes)}`)}
          </div>

          <h2>Port Mapping</h2>
          ${renderPorts(ports)}

          ${renderComposeSection(container)}
        </section>

        <section class="panel logs-panel" id="logs">
          <div class="log-shell">
            <div class="log-search" id="log-search">
              <input id="log-search-input" type="search" placeholder="Search logs" aria-label="Search logs">
            </div>
            <pre class="log-view" id="log-output">${escapeHtml(logs || "No logs returned.")}</pre>
            <div class="log-tools" aria-label="Log actions">
              <button class="log-tool" id="log-search-toggle" title="Search logs" aria-label="Search logs" data-tooltip="Search logs">
                ${searchIcon()}
              </button>
              <button class="log-tool" id="log-clear" title="Clear terminal" aria-label="Clear terminal" data-tooltip="Clear terminal">
                ${eraserIcon()}
              </button>
            </div>
          </div>
        </section>

        <section class="panel exec-panel" id="exec">
          <div class="exec-shell">
            <div>
              <h2>Interactive Shell</h2>
              <p class="exec-copy">Open a real VS Code terminal attached to this container with <code>docker exec -it</code>.</p>
              <p class="exec-copy muted">The shell runs inside this container. Commands can change files and processes in the container.</p>
            </div>
            <button class="open-shell" id="open-shell" ${container.state === "running" ? "" : "disabled"}>
              Open Shell
            </button>
            ${container.state === "running" ? "" : `<p class="exec-copy muted">Start the container before opening a shell.</p>`}
          </div>
        </section>

        <section class="panel inspect-panel" id="inspect">
          <pre class="inspect-view">${highlightJson(JSON.stringify(inspect, null, 2))}</pre>
        </section>
      </main>
      ${renderDeleteDialog(container, showDeleteDialog)}
    `,
    script(webview)
  );
}

function renderDeleteDialog(container: DockerContainer, isOpen: boolean): string {
  return `
    <div class="modal-backdrop ${isOpen ? "active" : ""}" id="delete-modal" aria-hidden="${isOpen ? "false" : "true"}">
      <div class="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">Delete container?</h2>
        <p class="dialog-copy">The following container is selected for deletion:</p>
        <ul>
          <li>${escapeHtml(container.name)} (container)</li>
        </ul>
        <p class="dialog-copy">Any anonymous volumes associated with this container are also deleted.</p>
        <div class="dialog-actions">
          <button class="dialog-button secondary" id="delete-cancel">Cancel</button>
          <button class="dialog-button danger" id="delete-confirm">Delete forever</button>
        </div>
      </div>
    </div>
  `;
}

function renderActionToolbar(container: DockerContainer): string {
  const isRunning = container.state === "running";
  return `
    <div class="toolbar" aria-label="Container actions">
      <button class="toolbar-button ${isRunning ? "primary" : "neutral"}" data-action="stop" title="Stop" aria-label="Stop" ${isRunning ? "" : "disabled"}>
        ${stopIcon()}
      </button>
      <button class="toolbar-button ${isRunning ? "neutral" : "primary"}" data-action="start" title="Start" aria-label="Start" ${isRunning ? "disabled" : ""}>
        ${playIcon()}
      </button>
      <button class="toolbar-button ${isRunning ? "primary" : "neutral"}" data-action="restart" title="Restart" aria-label="Restart" ${isRunning ? "" : "disabled"}>
        ${restartIcon()}
      </button>
      <button class="toolbar-button danger" data-action="remove" title="Remove" aria-label="Remove">
        ${trashIcon()}
      </button>
    </div>
  `;
}

function renderComposeSection(container: DockerContainer): string {
  if (!container.composeProject && !container.composeService && container.composeConfigFiles.length === 0) {
    return "";
  }

  return `
    <h2>Docker Compose</h2>
    <div class="grid">
      ${container.composeProject ? infoRow("Project", container.composeProject) : ""}
      ${container.composeService ? infoRow("Service", container.composeService) : ""}
      ${container.composeConfigFiles.length > 0 ? composeConfigFilesRow(container.composeConfigFiles) : ""}
    </div>
  `;
}

function composeConfigFilesRow(files: string[]): string {
  return `
    <div class="info-row">
      <span>Config files</span>
      <div class="file-links">
        ${files
          .map((file) => `
            <button class="file-link" data-path="${escapeAttribute(file)}" title="Open ${escapeAttribute(file)}">
              ${escapeHtml(file)}
            </button>
          `)
          .join("")}
      </div>
    </div>
  `;
}

function renderPorts(ports: ContainerDetails["ports"]): string {
  if (ports.length === 0) {
    return `<p class="muted">No published ports.</p>`;
  }

  return `
    <div class="ports">
      ${dedupePorts(ports)
        .map(
          (port) => {
            const portMapping = formatPortMapping(port);
            return `
            <div class="port">
              <div class="port-line">
                <span class="label">${escapeHtml(portMapping)}</span>
              </div>
              ${
                port.url
                  ? `<button class="visit" data-url="${escapeAttribute(port.url)}">Visit</button>`
                  : ""
              }
            </div>
          `;
          }
        )
        .join("")}
    </div>
  `;
}

function dedupePorts(ports: ContainerDetails["ports"]): ContainerDetails["ports"] {
  const seen = new Set<string>();
  return ports.filter((port) => {
    const key = `${port.containerPort}:${port.hostPort}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatPortMapping(port: ContainerDetails["ports"][number]): string {
  if (!port.hostPort) {
    return "-";
  }

  return `${port.containerPort.split("/")[0]} -> localhost:${port.hostPort}`;
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
        <strong>${escapeHtml(value || "-")}</strong>
        <button class="copy-button" data-copy="${escapeAttribute(value)}" title="Copy Container ID" aria-label="Copy Container ID">
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
            --button: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
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
            gap: 16px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 18px;
          }

          h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 650;
          }

          h2 {
            margin: 28px 0 12px;
            font-size: 15px;
          }

          .eyebrow {
            margin: 0 0 4px;
            color: var(--muted);
            font-size: 12px;
            text-transform: uppercase;
          }

          .tabs {
            display: flex;
            gap: 18px;
            border-bottom: 1px solid var(--border);
            margin-top: 18px;
          }

          .tab {
            appearance: none;
            border: 0;
            border-bottom: 2px solid transparent;
            background: transparent;
            color: var(--muted);
            cursor: pointer;
            font: inherit;
            padding: 12px 0 10px;
          }

          .tab.active {
            border-color: var(--accent);
            color: var(--fg);
          }

          .panel {
            display: none;
            padding-top: 22px;
          }

          .panel.active {
            display: block;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 10px;
          }

          .info-row,
          .port {
            border: 1px solid var(--border);
            border-radius: 6px;
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

          .file-links {
            display: grid;
            gap: 6px;
            margin-top: 6px;
          }

          .file-link {
            border: 0;
            background: transparent;
            color: var(--accent);
            cursor: pointer;
            font: inherit;
            font-weight: 500;
            overflow-wrap: anywhere;
            padding: 0;
            text-align: left;
            text-decoration: underline;
          }

          .status-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 12px;
            min-width: 270px;
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

          .toolbar-button:nth-child(3) {
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

          .ports {
            display: grid;
            gap: 8px;
          }

          .port {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .port-line {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            overflow-wrap: anywhere;
          }

          .label {
            font-weight: 600;
          }

          .visit {
            border: 0;
            border-radius: 4px;
            background: var(--button);
            color: var(--button-fg);
            cursor: pointer;
            padding: 5px 10px;
          }

          pre {
            box-sizing: border-box;
            max-width: 100%;
            overflow: auto;
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 14px;
            line-height: 1.45;
          }

          .logs-panel {
            padding-top: 22px;
          }

          .log-shell {
            position: relative;
            padding-right: 58px;
          }

          .log-view {
            height: calc(100vh - 245px);
            min-height: 320px;
            margin: 0;
            white-space: pre;
            overflow: auto;
          }

          .inspect-panel {
            padding-top: 22px;
          }

          .exec-panel {
            padding-top: 22px;
          }

          .exec-shell {
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 18px;
          }

          .exec-copy {
            max-width: 680px;
            margin: 0 0 8px;
            color: var(--fg);
            line-height: 1.45;
          }

          .exec-copy code {
            font-family: var(--vscode-editor-font-family);
          }

          .open-shell {
            border: 0;
            border-radius: 4px;
            background: var(--button);
            color: var(--button-fg);
            cursor: pointer;
            font: inherit;
            margin-top: 10px;
            padding: 7px 12px;
          }

          .open-shell:disabled {
            cursor: not-allowed;
            opacity: .5;
          }

          .inspect-view {
            height: calc(100vh - 245px);
            min-height: 320px;
            margin: 0;
            white-space: pre;
            overflow: auto;
          }

          .json-key {
            color: #7dd3fc;
          }

          .json-string {
            color: #86efac;
          }

          .json-number {
            color: #fbbf24;
          }

          .json-boolean {
            color: #c084fc;
          }

          .json-null {
            color: #f87171;
          }

          .log-tools {
            position: absolute;
            top: 0;
            right: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: color-mix(in srgb, var(--bg) 92%, var(--fg));
            padding: 8px;
          }

          .log-tool {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: var(--accent);
            cursor: pointer;
          }

          .log-tool:hover,
          .log-tool.active {
            background: color-mix(in srgb, var(--accent) 16%, transparent);
          }

          .log-tool::after {
            content: attr(data-tooltip);
            position: absolute;
            top: 50%;
            right: calc(100% + 10px);
            transform: translateY(-50%);
            display: none;
            width: max-content;
            max-width: 180px;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: var(--vscode-editorHoverWidget-background);
            color: var(--vscode-editorHoverWidget-foreground);
            box-shadow: 0 4px 14px rgb(0 0 0 / .24);
            font-size: 12px;
            line-height: 1.2;
            padding: 6px 8px;
            pointer-events: none;
            z-index: 3;
          }

          .log-tool:hover::after {
            display: block;
          }

          .log-tool svg {
            width: 20px;
            height: 20px;
          }

          .log-search {
            display: none;
            position: absolute;
            top: 8px;
            right: 58px;
            z-index: 2;
            width: min(320px, calc(100% - 82px));
          }

          .log-search.active {
            display: block;
          }

          .log-search input {
            box-sizing: border-box;
            width: 100%;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font: inherit;
            padding: 7px 9px;
          }

          .log-match {
            border-radius: 2px;
            background: var(--vscode-editor-findMatchHighlightBackground);
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
            font-size: 14px;
            font-weight: 700;
            padding: 9px 16px;
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

          .empty-state {
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 22px;
          }

          .empty-state p {
            color: var(--muted);
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

function script(webview: vscode.Webview): string {
  const nonce = getNonce();
  return `
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const logOutput = document.getElementById("log-output");
      const logSearch = document.getElementById("log-search");
      const logSearchInput = document.getElementById("log-search-input");
      const logSearchToggle = document.getElementById("log-search-toggle");
      const logClear = document.getElementById("log-clear");
      const deleteModal = document.getElementById("delete-modal");
      const deleteCancel = document.getElementById("delete-cancel");
      const deleteConfirm = document.getElementById("delete-confirm");
      const openShell = document.getElementById("open-shell");
      let currentLogs = logOutput?.textContent || "";
      let clearedSince;
      let searchQuery = "";

      const isLogPinnedToBottom = () => {
        if (!logOutput) {
          return false;
        }

        return logOutput.scrollHeight - logOutput.scrollTop - logOutput.clientHeight < 48;
      };

      const scrollLogsToBottom = () => {
        if (logOutput) {
          logOutput.scrollTop = logOutput.scrollHeight;
        }
      };

      const escapeForHtml = (value) => value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

      const renderLogs = () => {
        if (!logOutput) {
          return;
        }

        if (!searchQuery) {
          logOutput.textContent = currentLogs || "No logs returned.";
          return;
        }

        const source = currentLogs || "No logs returned.";
        const sourceLower = source.toLowerCase();
        const queryLower = searchQuery.toLowerCase();
        let cursor = 0;
        let html = "";

        while (true) {
          const index = sourceLower.indexOf(queryLower, cursor);
          if (index === -1) {
            html += escapeForHtml(source.slice(cursor));
            break;
          }

          html += escapeForHtml(source.slice(cursor, index));
          html += '<span class="log-match">' + escapeForHtml(source.slice(index, index + searchQuery.length)) + '</span>';
          cursor = index + searchQuery.length;
        }

        logOutput.innerHTML = html;
      };

      window.addEventListener("message", (event) => {
        if (event.data.command !== "logs" || !logOutput) {
          return;
        }

        const shouldFollow = isLogPinnedToBottom();
        currentLogs = event.data.logs || "";
        renderLogs();
        if (shouldFollow) {
          scrollLogsToBottom();
        }
      });

      document.querySelectorAll(".tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
          document.querySelectorAll(".panel").forEach((item) => item.classList.remove("active"));
          tab.classList.add("active");
          document.getElementById(tab.dataset.tab).classList.add("active");
          if (tab.dataset.tab === "logs") {
            requestAnimationFrame(scrollLogsToBottom);
          }
        });
      });

      document.querySelectorAll(".visit").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({ command: "openExternal", url: button.dataset.url });
        });
      });

      document.querySelectorAll(".copy-button").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({ command: "copyText", text: button.dataset.copy });
        });
      });

      document.querySelectorAll(".file-link").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({ command: "openFile", path: button.dataset.path });
        });
      });

      document.querySelectorAll(".toolbar-button").forEach((button) => {
        button.addEventListener("click", () => {
          if (button.disabled) {
            return;
          }

          if (button.dataset.action === "remove") {
            deleteModal?.classList.add("active");
            deleteModal?.setAttribute("aria-hidden", "false");
            deleteCancel?.focus();
            return;
          }

          vscode.postMessage({ command: "containerAction", action: button.dataset.action });
        });
      });

      deleteCancel?.addEventListener("click", () => {
        deleteModal?.classList.remove("active");
        deleteModal?.setAttribute("aria-hidden", "true");
      });

      deleteConfirm?.addEventListener("click", () => {
        vscode.postMessage({ command: "containerAction", action: "remove" });
      });

      deleteModal?.addEventListener("click", (event) => {
        if (event.target === deleteModal) {
          deleteModal.classList.remove("active");
          deleteModal.setAttribute("aria-hidden", "true");
        }
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && deleteModal?.classList.contains("active")) {
          deleteModal.classList.remove("active");
          deleteModal.setAttribute("aria-hidden", "true");
        }
      });

      logSearchToggle?.addEventListener("click", () => {
        logSearch?.classList.toggle("active");
        logSearchToggle.classList.toggle("active");
        if (logSearch?.classList.contains("active")) {
          logSearchInput?.focus();
        } else {
          searchQuery = "";
          if (logSearchInput) {
            logSearchInput.value = "";
          }
          renderLogs();
        }
      });

      logSearchInput?.addEventListener("input", () => {
        searchQuery = logSearchInput.value.trim();
        renderLogs();
      });

      logClear?.addEventListener("click", () => {
        clearedSince = new Date().toISOString();
        currentLogs = "";
        renderLogs();
        vscode.postMessage({ command: "refreshLogs", text: clearedSince });
      });

      openShell?.addEventListener("click", () => {
        if (openShell.disabled) {
          return;
        }

        vscode.postMessage({ command: "openShell" });
      });

      requestAnimationFrame(scrollLogsToBottom);
      setInterval(() => {
        vscode.postMessage({ command: "refreshLogs", text: clearedSince });
      }, 2000);
    </script>
  `;
}

function stopIcon(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/>
    </svg>
  `;
}

function playIcon(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.75v12.5c0 .8.87 1.28 1.54.84l9.1-6.25a1 1 0 0 0 0-1.68l-9.1-6.25A1 1 0 0 0 8 5.75Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    </svg>
  `;
}

function restartIcon(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 8.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4.5 4.5v4.4h4.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function trashIcon(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M5 7h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M8 10v8m4-8v8m4-8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M7 7l.7 12.2A2 2 0 0 0 9.7 21h4.6a2 2 0 0 0 2-1.8L17 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function searchIcon(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.3"/>
      <path d="m15.5 15.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
    </svg>
  `;
}

function eraserIcon(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4.5 15.5 7.9-7.9a3 3 0 0 1 4.2 0l2.1 2.1a3 3 0 0 1 0 4.2l-5.6 5.6H8.5l-4-4Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M12.5 19.5H20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
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

function highlightJson(value: string): string {
  return escapeHtml(value).replace(
    /(&quot;(?:\\u[\dA-Fa-f]{4}|\\[^u]|[^\\&])*&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?/g,
    (match, stringToken: string | undefined, colon: string | undefined) => {
      if (stringToken) {
        const className = colon ? "json-key" : "json-string";
        return `<span class="${className}">${stringToken}</span>${colon ?? ""}`;
      }

      if (match === "true" || match === "false") {
        return `<span class="json-boolean">${match}</span>`;
      }

      if (match === "null") {
        return `<span class="json-null">${match}</span>`;
      }

      return `<span class="json-number">${match}</span>`;
    }
  );
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getFullYear() <= 1) {
    return "-";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const units = [
    { name: "year", seconds: 365 * 24 * 60 * 60 },
    { name: "month", seconds: 30 * 24 * 60 * 60 },
    { name: "day", seconds: 24 * 60 * 60 },
    { name: "hour", seconds: 60 * 60 },
    { name: "minute", seconds: 60 }
  ];

  for (const unit of units) {
    const amount = Math.floor(seconds / unit.seconds);
    if (amount >= 1) {
      return `${amount} ${unit.name}${amount === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
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
    return `${(value / 1024).toFixed(2)}KiB`;
  }

  return `${value.toFixed(0)}B`;
}

function toTitleCase(value: string): string {
  if (!value) {
    return "-";
  }

  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => possible[Math.floor(Math.random() * possible.length)]).join("");
}
