import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { DockerClient, DockerContainer, DockerImage, DockerVolume } from "./lib/dockerClient";
import { ContainerTreeProvider, ContainerTreeItem, ImageTreeItem, VolumeTreeItem } from "./views/containerTree";
import { ContainerDetailsPanel } from "./views/containerDetailsPanel";
import { ImageDetailsPanel } from "./views/imageDetailsPanel";
import { RuntimeSettingsPanel, runtimeSettingsEnv } from "./views/runtimeSettingsPanel";
import { VolumeDetailsPanel } from "./views/volumeDetailsPanel";

let output: vscode.OutputChannel;
const execFileAsync = promisify(execFile);

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Docker Desktop Lite");
  const docker = new DockerClient(output);
  const containers = new ContainerTreeProvider(docker, context.extensionUri);

  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("dockerDesktopLite.containers", containers)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.refreshContainers", () => {
      containers.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.configureRuntime", async () => {
      await configureRuntime(containers, context.extensionUri.fsPath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.openRuntimeSettings", () => {
      RuntimeSettingsPanel.open();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.showLogs", async (item?: ContainerTreeItem) => {
      const container = await getContainerFromCommandArg(item, docker);
      if (!container) {
        return;
      }

      const document = await vscode.workspace.openTextDocument({
        content: await docker.logs(container.id),
        language: "log"
      });
      await vscode.window.showTextDocument(document, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.openContainerDetails", async (item?: ContainerTreeItem) => {
      const container = await getContainerFromCommandArg(item, docker);
      if (!container) {
        return;
      }

      await ContainerDetailsPanel.open(docker, container, context.extensionUri, () => containers.refresh());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.confirmDeleteContainer", async (item?: ContainerTreeItem) => {
      const container = await getContainerFromCommandArg(item, docker);
      if (!container) {
        return;
      }

      await ContainerDetailsPanel.open(docker, container, context.extensionUri, () => containers.refresh(), true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.openImageDetails", async (item?: ImageTreeItem) => {
      const image = await getImageFromCommandArg(item, docker);
      if (!image) {
        return;
      }

      await ImageDetailsPanel.open(docker, image, () => containers.refresh());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.runImage", async (item?: ImageTreeItem) => {
      const image = await getImageFromCommandArg(item, docker);
      if (!image) {
        return;
      }

      await ImageDetailsPanel.open(docker, image, () => containers.refresh(), false, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.stopImageContainers", async (item?: ImageTreeItem) => {
      const image = await getImageFromCommandArg(item, docker);
      if (!image) {
        return;
      }

      try {
        await docker.stopImageContainers(image);
        containers.refresh();
      } catch {
        // DockerClient already shows the friendly error.
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.confirmDeleteImage", async (item?: ImageTreeItem) => {
      const image = await getImageFromCommandArg(item, docker);
      if (!image) {
        return;
      }

      await ImageDetailsPanel.open(docker, image, () => containers.refresh(), true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.openVolumeDetails", async (item?: VolumeTreeItem) => {
      const volume = await getVolumeFromCommandArg(item, docker);
      if (!volume) {
        return;
      }

      await VolumeDetailsPanel.open(docker, volume, async (containerId) => {
        const container = await docker.findContainer(containerId);
        if (!container) {
          vscode.window.showWarningMessage("Container no longer exists.");
          return;
        }

        await ContainerDetailsPanel.open(docker, container, context.extensionUri, () => containers.refresh());
      }, () => containers.refresh());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.confirmDeleteVolume", async (item?: VolumeTreeItem) => {
      const volume = await getVolumeFromCommandArg(item, docker);
      if (!volume) {
        return;
      }

      await VolumeDetailsPanel.open(docker, volume, async (containerId) => {
        const container = await docker.findContainer(containerId);
        if (!container) {
          vscode.window.showWarningMessage("Container no longer exists.");
          return;
        }

        await ContainerDetailsPanel.open(docker, container, context.extensionUri, () => containers.refresh());
      }, () => containers.refresh(), true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.startContainer", async (item?: ContainerTreeItem) => {
      try {
        await runContainerAction(item, docker, "start");
        containers.refresh();
      } catch {
        // DockerClient already shows the friendly error.
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.stopContainer", async (item?: ContainerTreeItem) => {
      try {
        await runContainerAction(item, docker, "stop");
        containers.refresh();
      } catch {
        // DockerClient already shows the friendly error.
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.restartContainer", async (item?: ContainerTreeItem) => {
      try {
        await runContainerAction(item, docker, "restart");
        containers.refresh();
      } catch {
        // DockerClient already shows the friendly error.
      }
    })
  );
}

async function getVolumeFromCommandArg(
  item: VolumeTreeItem | undefined,
  docker: DockerClient
): Promise<DockerVolume | undefined> {
  if (item?.volume) {
    return item.volume;
  }

  const volumes = await docker.listVolumes();
  const picked = await vscode.window.showQuickPick(
    volumes.map((volume) => ({
      label: volume.name,
      description: volume.driver,
      detail: volume.mountpoint,
      volume
    })),
    { placeHolder: "Choose a Docker volume" }
  );

  return picked?.volume;
}

async function getImageFromCommandArg(
  item: ImageTreeItem | undefined,
  docker: DockerClient
): Promise<DockerImage | undefined> {
  if (item?.image) {
    return item.image;
  }

  const images = await docker.listImages();
  const picked = await vscode.window.showQuickPick(
    images.map((image) => ({
      label: image.repository === "<none>" && image.tag === "<none>"
        ? image.id
        : `${image.repository}:${image.tag}`,
      description: image.size,
      detail: image.createdSince,
      image
    })),
    { placeHolder: "Choose a Docker image" }
  );

  return picked?.image;
}

export function deactivate(): void {
  output?.dispose();
}

async function runContainerAction(
  item: ContainerTreeItem | undefined,
  docker: DockerClient,
  action: "start" | "stop" | "restart"
): Promise<void> {
  const container = await getContainerFromCommandArg(item, docker);
  if (!container) {
    return;
  }

  await docker.containerAction(action, container.id);
}

async function getContainerFromCommandArg(
  item: ContainerTreeItem | undefined,
  docker: DockerClient
): Promise<DockerContainer | undefined> {
  if (item?.container) {
    return item.container;
  }

  const containers = await docker.listContainers();
  const picked = await vscode.window.showQuickPick(
    containers.map((container) => ({
      label: container.name,
      description: container.status,
      detail: container.image,
      container
    })),
    { placeHolder: "Choose a Docker container" }
  );

  return picked?.container;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RuntimeOption {
  args: string[];
  command: string;
  description: string;
  detail: string;
  id: string;
  label: string;
  recommended?: boolean;
  setupScript?: string;
  setupScriptKind?: "powershell" | "shell";
}

async function configureRuntime(containers: ContainerTreeProvider, extensionRoot: string): Promise<void> {
  const currentRuntimeId = await detectCurrentRuntimeId();
  const picked = await vscode.window.showQuickPick(
    runtimeOptions(extensionRoot).map((runtime) => ({
      label: formatRuntimeLabel(runtime, currentRuntimeId),
      description: runtime.description,
      detail: formatRuntimeDetail(runtime, currentRuntimeId),
      runtime
    })),
    {
      placeHolder: "Choose a Docker-compatible runtime to start"
    }
  );

  if (!picked) {
    return;
  }

  await startRuntime(picked.runtime);
  containers.refresh();
}

function formatRuntimeLabel(runtime: RuntimeOption, currentRuntimeId: string | undefined): string {
  const badges = [
    runtime.recommended ? "Recommended" : undefined,
    runtime.id === currentRuntimeId ? "Current" : undefined
  ].filter(Boolean);

  return badges.length > 0 ? `${runtime.label} (${badges.join(", ")})` : runtime.label;
}

function formatRuntimeDetail(runtime: RuntimeOption, currentRuntimeId: string | undefined): string {
  if (runtime.id === currentRuntimeId) {
    return `Current runtime. ${runtime.detail}`;
  }

  return runtime.detail;
}

async function startRuntime(runtime: RuntimeOption): Promise<void> {
  if (runtime.setupScript) {
    if (await commandExists(runtime.command)) {
      runRuntimeSetupScript(runtime);
      return;
    }

    await offerRuntimeInstall(runtime);
    return;
  }

  try {
    await execFileAsync(runtime.command, runtime.args);
    vscode.window.showInformationMessage(`Started ${runtime.label}. Refresh Docker Desktop Lite if Docker is still warming up.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`Could not start ${runtime.label}. Run this manually: ${formatRuntimeCommand(runtime)}. ${message}`);
  }
}

async function offerRuntimeInstall(runtime: RuntimeOption): Promise<void> {
  if (!runtime.setupScript) {
    return;
  }

  const accepted = await vscode.window.showWarningMessage(
    `${runtime.label} is not available on this machine. Docker Desktop Lite can install and start it for you.`,
    { modal: true },
    "Accept and Install"
  );

  if (accepted !== "Accept and Install") {
    return;
  }

  runRuntimeSetupScript(runtime);
}

function runRuntimeSetupScript(runtime: RuntimeOption): void {
  if (!runtime.setupScript) {
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `${runtime.label} setup`,
    cwd: path.dirname(runtime.setupScript),
    env: {
      VIRTUAL_ENV: "",
      PYTHONPATH: "",
      ...runtimeSettingsEnv()
    },
    ...(process.platform === "win32"
      ? {}
      : {
          shellPath: "/bin/bash",
          shellArgs: ["--noprofile", "--norc"]
        })
  });
  terminal.show();
  terminal.sendText(formatSetupScriptCommand(runtime));
  vscode.window.showInformationMessage(`Setting up ${runtime.label}. When setup finishes, refresh Docker Desktop Lite.`);
}

function runtimeOptions(extensionRoot: string): RuntimeOption[] {
  const script = (name: string) => path.join(extensionRoot, "scripts", "runtimes", name);

  if (process.platform === "darwin") {
    return [
      {
        id: "macos-colima",
        label: "Colima",
        description: "Lightweight Docker runtime",
        detail: "Runs: colima start",
        command: "colima",
        args: ["start"],
        setupScript: script("setup-macos-colima-runtime.sh"),
        recommended: true
      },
      {
        id: "macos-docker-desktop",
        label: "Docker Desktop",
        description: "Official Docker runtime",
        detail: "Runs: open -a Docker",
        command: "open",
        args: ["-a", "Docker"],
        setupScript: script("setup-macos-docker-desktop-runtime.sh")
      }
    ];
  }

  if (process.platform === "win32") {
    return [
      {
        id: "windows-wsl2-docker",
        label: "Docker Engine in WSL2",
        description: "Lightweight WSL2 Docker daemon",
        detail: "Runs: wsl -e sh -lc \"sudo service docker start || sudo systemctl start docker\"",
        command: "wsl",
        args: ["-e", "sh", "-lc", "sudo service docker start || sudo systemctl start docker"],
        setupScript: script("setup-windows-wsl2-docker-runtime.ps1"),
        setupScriptKind: "powershell",
        recommended: true
      },
      {
        id: "windows-docker-desktop",
        label: "Docker Desktop",
        description: "Official Docker runtime",
        detail: "Runs: start Docker Desktop",
        command: "cmd",
        args: ["/c", "start", "", "Docker Desktop"],
        setupScript: script("setup-windows-docker-desktop-runtime.ps1"),
        setupScriptKind: "powershell"
      },
    ];
  }

  return [
    {
      id: "linux-docker-engine",
      label: "Docker Engine",
      description: "Native Linux Docker daemon",
      detail: "Runs: systemctl start docker",
      command: "systemctl",
      args: ["start", "docker"],
      setupScript: script("setup-linux-docker-engine-runtime.sh"),
      recommended: true
    },
    {
      id: "linux-colima",
      label: "Colima",
      description: "Isolated VM-based Docker runtime",
      detail: "Runs: colima start",
      command: "colima",
      args: ["start"],
      setupScript: script("setup-linux-colima-runtime.sh")
    }
  ];
}

async function detectCurrentRuntimeId(): Promise<string | undefined> {
  const context = await currentDockerContext();

  if (process.platform === "darwin") {
    if (context === "colima") {
      return "macos-colima";
    }

    if (isDockerDesktopContext(context)) {
      return "macos-docker-desktop";
    }

    return undefined;
  }

  if (process.platform === "win32") {
    if (isDockerDesktopContext(context)) {
      return "windows-docker-desktop";
    }

    if (context) {
      return "windows-wsl2-docker";
    }

    return undefined;
  }

  if (context === "colima") {
    return "linux-colima";
  }

  if (context) {
    return "linux-docker-engine";
  }

  return undefined;
}

async function currentDockerContext(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("docker", ["context", "show"]);
    const context = stdout.trim();
    return context.length > 0 ? context : undefined;
  } catch {
    return undefined;
  }
}

function isDockerDesktopContext(context: string | undefined): boolean {
  return context === "desktop-linux" || context === "docker-desktop";
}

function formatRuntimeCommand(runtime: RuntimeOption): string {
  return [runtime.command, ...runtime.args].join(" ");
}

async function commandExists(command: string): Promise<boolean> {
  const lookup = process.platform === "win32" ? "where" : "which";
  const args = [command];

  try {
    await execFileAsync(lookup, args);
    return true;
  } catch {
    return false;
  }
}

function formatSetupScriptCommand(runtime: RuntimeOption): string {
  if (!runtime.setupScript) {
    return "";
  }

  if (runtime.setupScriptKind === "powershell") {
    return `powershell -ExecutionPolicy Bypass -File ${powershellQuote(runtime.setupScript)}`;
  }

  return `bash ${shellQuote(runtime.setupScript)}`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
