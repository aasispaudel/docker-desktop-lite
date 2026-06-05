import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { DockerClient, DockerContainer, DockerImage, DockerVolume } from "./lib/dockerClient";
import { ContainerTreeProvider, ContainerTreeItem, ImageTreeItem, VolumeTreeItem } from "./views/containerTree";
import { ContainerDetailsPanel } from "./views/containerDetailsPanel";
import { ImageDetailsPanel } from "./views/imageDetailsPanel";
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
  const autoRefresh = setInterval(() => containers.refresh(), 5000);
  context.subscriptions.push({ dispose: () => clearInterval(autoRefresh) });

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.refreshContainers", () => {
      containers.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerDesktopLite.startDocker", async () => {
      await startDockerDesktop();
      vscode.window.showInformationMessage("Opening Docker Desktop. Refresh Docker Desktop Lite once Docker finishes starting.");
      setTimeout(() => containers.refresh(), 5000);
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

async function startDockerDesktop(): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-a", "Docker"]);
      return;
    }

    if (process.platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", "Docker Desktop"]);
      return;
    }

    await execFileAsync("systemctl", ["--user", "start", "docker-desktop"]);
  } catch {
    vscode.window.showWarningMessage("Could not open Docker Desktop automatically. Start Docker manually, then refresh Docker Desktop Lite.");
  }
}
