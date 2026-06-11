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
const LAST_RUNTIME_KEY = "docklite.lastRuntimeId";
const DOCKER_START_TIMEOUT_MS = 120_000;
const DOCKER_START_POLL_MS = 2_000;
const SUGGEST_IMPROVEMENT_URL = "https://github.com/aasispaudel/docker-desktop-lite/issues/new?template=suggest-improvement.md";

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Docklite");
  const docker = new DockerClient(output);
  const containers = new ContainerTreeProvider(docker, context.extensionUri);

  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("docklite.containers", containers)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.refreshContainers", () => {
      containers.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.configureRuntime", async () => {
      await configureRuntime(containers, context, docker);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.startDockerRuntime", async () => {
      await startDockerRuntime(containers, context, docker);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.openRuntimeSettings", () => {
      RuntimeSettingsPanel.open();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.suggestImprovement", async () => {
      await vscode.env.openExternal(vscode.Uri.parse(SUGGEST_IMPROVEMENT_URL));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.showLogs", async (item?: ContainerTreeItem) => {
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
    vscode.commands.registerCommand("docklite.openContainerDetails", async (item?: ContainerTreeItem) => {
      const container = await getContainerFromCommandArg(item, docker);
      if (!container) {
        return;
      }

      await ContainerDetailsPanel.open(docker, container, context.extensionUri, () => containers.refresh());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.confirmDeleteContainer", async (item?: ContainerTreeItem) => {
      const container = await getContainerFromCommandArg(item, docker);
      if (!container) {
        return;
      }

      await ContainerDetailsPanel.open(docker, container, context.extensionUri, () => containers.refresh(), true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.openImageDetails", async (item?: ImageTreeItem) => {
      const image = await getImageFromCommandArg(item, docker);
      if (!image) {
        return;
      }

      await ImageDetailsPanel.open(docker, image, () => containers.refresh());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.runImage", async (item?: ImageTreeItem) => {
      const image = await getImageFromCommandArg(item, docker);
      if (!image) {
        return;
      }

      await ImageDetailsPanel.open(docker, image, () => containers.refresh(), false, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.stopImageContainers", async (item?: ImageTreeItem) => {
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
    vscode.commands.registerCommand("docklite.confirmDeleteImage", async (item?: ImageTreeItem) => {
      const image = await getImageFromCommandArg(item, docker);
      if (!image) {
        return;
      }

      await ImageDetailsPanel.open(docker, image, () => containers.refresh(), true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.openVolumeDetails", async (item?: VolumeTreeItem) => {
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
    vscode.commands.registerCommand("docklite.confirmDeleteVolume", async (item?: VolumeTreeItem) => {
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
    vscode.commands.registerCommand("docklite.startContainer", async (item?: ContainerTreeItem) => {
      try {
        await runContainerAction(item, docker, "start");
        containers.refresh();
      } catch {
        // DockerClient already shows the friendly error.
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.stopContainer", async (item?: ContainerTreeItem) => {
      try {
        await runContainerAction(item, docker, "stop");
        containers.refresh();
      } catch {
        // DockerClient already shows the friendly error.
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docklite.restartContainer", async (item?: ContainerTreeItem) => {
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

async function configureRuntime(
  containers: ContainerTreeProvider,
  context: vscode.ExtensionContext,
  docker: DockerClient
): Promise<void> {
  const currentRuntimeId = await detectCurrentRuntimeId();
  const extensionRoot = context.extensionUri.fsPath;
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

  if (await startRuntime(picked.runtime, containers, docker)) {
    await context.globalState.update(LAST_RUNTIME_KEY, picked.runtime.id);
  }
}

async function startDockerRuntime(
  containers: ContainerTreeProvider,
  context: vscode.ExtensionContext,
  docker: DockerClient
): Promise<void> {
  const extensionRoot = context.extensionUri.fsPath;
  const runtimes = runtimeOptions(extensionRoot);
  const currentRuntimeId = await detectCurrentRuntimeId();
  const lastRuntimeId = context.globalState.get<string>(LAST_RUNTIME_KEY);
  const preferredRuntime = firstRuntimeById(runtimes, [currentRuntimeId, lastRuntimeId]);

  if (preferredRuntime && await commandExists(preferredRuntime.command)) {
    if (await startRuntimeCommand(preferredRuntime, containers, docker)) {
      await context.globalState.update(LAST_RUNTIME_KEY, preferredRuntime.id);
    }
    return;
  }

  const availableRuntimes: RuntimeOption[] = [];
  for (const runtime of runtimes) {
    if (await commandExists(runtime.command)) {
      availableRuntimes.push(runtime);
    }
  }

  if (availableRuntimes.length === 1) {
    if (await startRuntimeCommand(availableRuntimes[0], containers, docker)) {
      await context.globalState.update(LAST_RUNTIME_KEY, availableRuntimes[0].id);
    }
    return;
  }

  if (availableRuntimes.length > 1) {
    const picked = await vscode.window.showQuickPick(
      availableRuntimes.map((runtime) => ({
        label: runtime.label,
        description: runtime.description,
        detail: runtime.detail,
        runtime
      })),
      { placeHolder: "Choose the Docker runtime to start" }
    );

    if (!picked) {
      return;
    }

    if (await startRuntimeCommand(picked.runtime, containers, docker)) {
      await context.globalState.update(LAST_RUNTIME_KEY, picked.runtime.id);
    }
    return;
  }

  const accepted = await vscode.window.showWarningMessage(
    "No installed Docker runtime command was found. Change Docker Engine to install or configure one.",
    "Change Docker Engine"
  );

  if (accepted === "Change Docker Engine") {
    await configureRuntime(containers, context, docker);
  }
}

function firstRuntimeById(runtimes: RuntimeOption[], ids: Array<string | undefined>): RuntimeOption | undefined {
  for (const id of ids) {
    const runtime = id ? runtimes.find((candidate) => candidate.id === id) : undefined;
    if (runtime) {
      return runtime;
    }
  }

  return undefined;
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

async function startRuntime(
  runtime: RuntimeOption,
  containers: ContainerTreeProvider,
  docker: DockerClient
): Promise<boolean> {
  if (runtime.setupScript) {
    if (await commandExists(runtime.command)) {
      return startRuntimeCommand(runtime, containers, docker);
    }

    await offerRuntimeInstall(runtime);
    return false;
  }

  return startRuntimeCommand(runtime, containers, docker);
}

async function startRuntimeCommand(
  runtime: RuntimeOption,
  containers: ContainerTreeProvider,
  docker: DockerClient
): Promise<boolean> {
  try {
    await execFileAsync(runtime.command, runtime.args);
    containers.setRuntimeStarting(`${runtime.label} is starting. Docklite will refresh automatically when Docker is ready.`);
    await waitForDockerDaemon(docker);
    containers.setRuntimeStarting(undefined);
    containers.refresh();
    vscode.window.showInformationMessage(`${runtime.label} is ready.`);
    return true;
  } catch (error) {
    containers.setRuntimeStarting(undefined);
    containers.refresh();
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`Could not start ${runtime.label}. Run this manually: ${formatRuntimeCommand(runtime)}. ${message}`);
    return false;
  }
}

async function waitForDockerDaemon(docker: DockerClient): Promise<void> {
  const deadline = Date.now() + DOCKER_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const daemon = await docker.daemonStatus();
    if (daemon.running) {
      return;
    }

    await delay(DOCKER_START_POLL_MS);
  }

  throw new Error("Docker opened, but the daemon did not become ready within 2 minutes.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function offerRuntimeInstall(runtime: RuntimeOption): Promise<void> {
  if (!runtime.setupScript) {
    return;
  }

  const accepted = await vscode.window.showWarningMessage(
    `${runtime.label} is not available on this machine. Docklite can install and start it for you.`,
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
  vscode.window.showInformationMessage(`Setting up ${runtime.label}. When setup finishes, refresh Docklite.`);
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
