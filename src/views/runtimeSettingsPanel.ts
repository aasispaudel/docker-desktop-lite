import * as vscode from "vscode";

interface RuntimeSettings {
  colimaCpu: number;
  colimaDiskGiB: number;
  colimaMemoryGiB: number;
  colimaSetupTimeoutSeconds: number;
  colimaVmType: "auto" | "vz" | "qemu";
  dockerDesktopTimeoutSeconds: number;
  dockerEngineTimeoutSeconds: number;
  wslDockerTimeoutSeconds: number;
}

const CONFIG_SECTION = "docklite.runtime";

const DEFAULT_SETTINGS: RuntimeSettings = {
  colimaCpu: 2,
  colimaDiskGiB: 60,
  colimaMemoryGiB: 4,
  colimaSetupTimeoutSeconds: 600,
  colimaVmType: "auto",
  dockerDesktopTimeoutSeconds: 600,
  dockerEngineTimeoutSeconds: 120,
  wslDockerTimeoutSeconds: 180
};

export class RuntimeSettingsPanel {
  static open(): void {
    const panel = vscode.window.createWebviewPanel(
      "docklite.runtimeSettings",
      "Docklite Runtime Settings",
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const render = () => {
      panel.webview.html = renderSettings(readSettings());
    };

    render();

    panel.webview.onDidReceiveMessage(async (message: { command: string; values?: Partial<RuntimeSettings> }) => {
      if (message.command === "save") {
        await saveSettings(message.values ?? {});
        vscode.window.showInformationMessage("Docklite runtime settings saved.");
        render();
      }

      if (message.command === "reset") {
        await resetSettings();
        vscode.window.showInformationMessage("Docklite runtime settings reset.");
        render();
      }
    });
  }
}

export function runtimeSettingsEnv(): Record<string, string> {
  const settings = readSettings();
  const env: Record<string, string> = {
    DOCKLITE_COLIMA_CPU: String(settings.colimaCpu),
    DOCKLITE_COLIMA_MEMORY: String(settings.colimaMemoryGiB),
    DOCKLITE_COLIMA_DISK: String(settings.colimaDiskGiB),
    DOCKLITE_COLIMA_TIMEOUT_SECONDS: String(settings.colimaSetupTimeoutSeconds),
    DOCKLITE_DOCKER_DESKTOP_TIMEOUT_SECONDS: String(settings.dockerDesktopTimeoutSeconds),
    DOCKLITE_DOCKER_ENGINE_TIMEOUT_SECONDS: String(settings.dockerEngineTimeoutSeconds),
    DOCKLITE_WSL_DOCKER_TIMEOUT_SECONDS: String(settings.wslDockerTimeoutSeconds)
  };

  if (settings.colimaVmType !== "auto") {
    env.DOCKLITE_COLIMA_VM_TYPE = settings.colimaVmType;
  }

  return env;
}

function readSettings(): RuntimeSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  return {
    colimaCpu: readNumber(config, "colimaCpu", DEFAULT_SETTINGS.colimaCpu),
    colimaDiskGiB: readNumber(config, "colimaDiskGiB", DEFAULT_SETTINGS.colimaDiskGiB),
    colimaMemoryGiB: readNumber(config, "colimaMemoryGiB", DEFAULT_SETTINGS.colimaMemoryGiB),
    colimaSetupTimeoutSeconds: readNumber(
      config,
      "colimaSetupTimeoutSeconds",
      DEFAULT_SETTINGS.colimaSetupTimeoutSeconds
    ),
    colimaVmType: readVmType(config.get("colimaVmType")),
    dockerDesktopTimeoutSeconds: readNumber(
      config,
      "dockerDesktopTimeoutSeconds",
      DEFAULT_SETTINGS.dockerDesktopTimeoutSeconds
    ),
    dockerEngineTimeoutSeconds: readNumber(
      config,
      "dockerEngineTimeoutSeconds",
      DEFAULT_SETTINGS.dockerEngineTimeoutSeconds
    ),
    wslDockerTimeoutSeconds: readNumber(
      config,
      "wslDockerTimeoutSeconds",
      DEFAULT_SETTINGS.wslDockerTimeoutSeconds
    )
  };
}

async function saveSettings(values: Partial<RuntimeSettings>): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  await updateNumber(config, "colimaCpu", values.colimaCpu, 1, 32);
  await updateNumber(config, "colimaMemoryGiB", values.colimaMemoryGiB, 1, 128);
  await updateNumber(config, "colimaDiskGiB", values.colimaDiskGiB, 8, 2048);
  await updateNumber(config, "colimaSetupTimeoutSeconds", values.colimaSetupTimeoutSeconds, 60, 3600);
  await updateNumber(config, "dockerDesktopTimeoutSeconds", values.dockerDesktopTimeoutSeconds, 30, 3600);
  await updateNumber(config, "dockerEngineTimeoutSeconds", values.dockerEngineTimeoutSeconds, 15, 600);
  await updateNumber(config, "wslDockerTimeoutSeconds", values.wslDockerTimeoutSeconds, 30, 1200);

  if (values.colimaVmType) {
    await config.update("colimaVmType", readVmType(values.colimaVmType), vscode.ConfigurationTarget.Global);
  }
}

async function resetSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await Promise.all(
    Object.keys(DEFAULT_SETTINGS).map((key) => config.update(key, undefined, vscode.ConfigurationTarget.Global))
  );
}

function readNumber(config: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = config.get<number>(key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function updateNumber(
  config: vscode.WorkspaceConfiguration,
  key: string,
  value: number | undefined,
  min: number,
  max: number
): Promise<void> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  const normalized = Math.min(max, Math.max(min, Math.round(value)));
  await config.update(key, normalized, vscode.ConfigurationTarget.Global);
}

function readVmType(value: unknown): RuntimeSettings["colimaVmType"] {
  return value === "vz" || value === "qemu" ? value : "auto";
}

function renderSettings(settings: RuntimeSettings): string {
  const platform = process.platform;
  const supportsColima = platform === "darwin" || platform === "linux";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Docklite Runtime Settings</title>
  <style>
    :root {
      color-scheme: dark;
      --border: color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      --muted: color-mix(in srgb, var(--vscode-foreground) 64%, transparent);
      --panel: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-foreground) 12%);
      --accent: var(--vscode-button-background);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 28px;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font: 13px/1.45 var(--vscode-font-family);
    }

    main {
      max-width: 980px;
    }

    header {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-start;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: 26px;
      line-height: 1.2;
    }

    h2 {
      margin: 0 0 14px;
      font-size: 16px;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: var(--muted);
    }

    section {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 16px;
      background: var(--panel);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }

    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-weight: 600;
    }

    input,
    select {
      width: 100%;
      min-height: 34px;
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 5px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 6px 8px;
      font: inherit;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding-top: 8px;
    }

    button {
      min-width: 96px;
      min-height: 34px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 5px;
      padding: 7px 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Runtime Settings</h1>
        <p>These defaults are used the next time Docklite configures a Docker-compatible runtime.</p>
      </div>
    </header>

    ${supportsColima ? renderColimaSection(settings, platform) : ""}

    <section>
      <h2>Startup Timeouts</h2>
      <div class="grid">
        ${renderTimeoutFields(settings, platform)}
      </div>
    </section>

    <div class="actions">
      <button class="secondary" id="reset">Reset</button>
      <button class="primary" id="save">Save</button>
    </div>
  </main>

  <script>
    const vscode = acquireVsCodeApi();
    const numberIds = [
      "colimaCpu",
      "colimaMemoryGiB",
      "colimaDiskGiB",
      "colimaSetupTimeoutSeconds",
      "dockerDesktopTimeoutSeconds",
      "dockerEngineTimeoutSeconds",
      "wslDockerTimeoutSeconds"
    ];

    document.getElementById("save").addEventListener("click", () => {
      const values = {};
      for (const id of numberIds) {
        const input = document.getElementById(id);
        if (input) {
          values[id] = Number(input.value);
        }
      }

      const colimaVmType = document.getElementById("colimaVmType");
      if (colimaVmType) {
        values.colimaVmType = colimaVmType.value;
      }

      vscode.postMessage({ command: "save", values });
    });

    document.getElementById("reset").addEventListener("click", () => {
      vscode.postMessage({ command: "reset" });
    });
  </script>
</body>
</html>`;
}

function renderColimaSection(settings: RuntimeSettings, platform: NodeJS.Platform): string {
  return /* html */ `<section>
    <h2>Colima Resources</h2>
    <div class="grid">
      ${numberField("colimaCpu", "CPU", settings.colimaCpu, 1, 32)}
      ${numberField("colimaMemoryGiB", "Memory GiB", settings.colimaMemoryGiB, 1, 128)}
      ${numberField("colimaDiskGiB", "Disk GiB", settings.colimaDiskGiB, 8, 2048)}
      <label>
        VM backend
        <select id="colimaVmType">
          ${option("auto", platform === "darwin" ? "Auto: Apple vz" : "Auto: QEMU", settings.colimaVmType)}
          ${platform === "darwin" ? option("vz", "Apple vz", settings.colimaVmType) : ""}
          ${option("qemu", "QEMU", settings.colimaVmType)}
        </select>
      </label>
    </div>
  </section>`;
}

function renderTimeoutFields(settings: RuntimeSettings, platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return [
      numberField("colimaSetupTimeoutSeconds", "Colima setup seconds", settings.colimaSetupTimeoutSeconds, 60, 3600),
      numberField("dockerDesktopTimeoutSeconds", "Docker Desktop seconds", settings.dockerDesktopTimeoutSeconds, 30, 3600)
    ].join("");
  }

  if (platform === "win32") {
    return [
      numberField("wslDockerTimeoutSeconds", "Windows WSL2 seconds", settings.wslDockerTimeoutSeconds, 30, 1200),
      numberField("dockerDesktopTimeoutSeconds", "Docker Desktop seconds", settings.dockerDesktopTimeoutSeconds, 30, 3600)
    ].join("");
  }

  return [
    numberField("dockerEngineTimeoutSeconds", "Linux Docker Engine seconds", settings.dockerEngineTimeoutSeconds, 15, 600),
    numberField("colimaSetupTimeoutSeconds", "Colima setup seconds", settings.colimaSetupTimeoutSeconds, 60, 3600)
  ].join("");
}

function numberField(id: string, label: string, value: number, min: number, max: number): string {
  return /* html */ `<label>
    ${label}
    <input id="${id}" type="number" min="${min}" max="${max}" step="1" value="${value}">
  </label>`;
}

function option(value: string, label: string, selected: string): string {
  return `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`;
}
