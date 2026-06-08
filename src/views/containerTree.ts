import * as vscode from "vscode";
import { DockerClient, DockerContainer, DockerImage, DockerStatsSummary, DockerVolume } from "../lib/dockerClient";

type DockerLiteTreeItem =
  | ContainerRootTreeItem
  | DaemonStatusTreeItem
  | ConfigureRuntimeTreeItem
  | ImageRootTreeItem
  | ImageTreeItem
  | MessageTreeItem
  | VolumeRootTreeItem
  | VolumeTreeItem
  | ContainerTreeItem
  | MetricTreeItem
  | ProjectTreeItem
  | SettingsRootTreeItem
  | ChangeDockerEngineTreeItem
  | RuntimeSettingsTreeItem
  | SpacerTreeItem;

interface RootData {
  containers: DockerContainer[];
  images: DockerImage[];
  summary: DockerStatsSummary;
  volumes: DockerVolume[];
}

export class ContainerTreeProvider implements vscode.TreeDataProvider<DockerLiteTreeItem> {
  private readonly didChangeTreeData = new vscode.EventEmitter<DockerLiteTreeItem | undefined>();
  private loadError: string | undefined;
  private loading = false;
  private rootData: RootData | undefined;

  readonly onDidChangeTreeData = this.didChangeTreeData.event;

  constructor(
    private readonly docker: DockerClient,
    private readonly extensionUri: vscode.Uri
  ) {}

  refresh(): void {
    if (this.loading) {
      return;
    }

    void this.loadRootData();
    this.didChangeTreeData.fire(undefined);
  }

  getTreeItem(element: DockerLiteTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DockerLiteTreeItem): Promise<DockerLiteTreeItem[]> {
    if (element instanceof ContainerRootTreeItem) {
      return element.containers.length > 0
        ? buildProjectItems(element.containers)
        : [new MessageTreeItem("No containers", "Run a container or Compose project to see it here.", "info")];
    }

    if (element instanceof ImageRootTreeItem) {
      return element.images.length > 0
        ? element.images.map((image) => new ImageTreeItem(image, this.extensionUri))
        : [new MessageTreeItem("No images", "Pull or build an image to see it here.", "info")];
    }

    if (element instanceof VolumeRootTreeItem) {
      return element.volumes.length > 0
        ? element.volumes.map((volume) => new VolumeTreeItem(volume))
        : [new MessageTreeItem("No volumes", "Named Docker volumes will appear here.", "info")];
    }

    if (element instanceof ProjectTreeItem) {
      return element.containers.map((container) => new ContainerTreeItem(container, this.extensionUri));
    }

    if (element instanceof SettingsRootTreeItem) {
      return [
        new ChangeDockerEngineTreeItem(),
        new RuntimeSettingsTreeItem()
      ];
    }

    if (!this.rootData && !this.loading && !this.loadError) {
      void this.loadRootData();
    }

    if (this.loadError) {
      return [
        new DaemonStatusTreeItem(false, this.loadError),
        new ConfigureRuntimeTreeItem(),
        new MessageTreeItem("Docker data hidden", "Start a Docker-compatible runtime, then refresh this view.", "info"),
        new SpacerTreeItem(),
        new SettingsRootTreeItem()
      ];
    }

    if (this.loading && !this.rootData) {
      return [new MessageTreeItem("Loading Docker data...", "Refreshing containers, images, and volumes.", "loading")];
    }

    if (!this.rootData) {
      return [new MessageTreeItem("No Docker data loaded", "Refresh to try again.", "info")];
    }

    return [
      ...(this.loading ? [new MessageTreeItem("Refreshing...", "Updating Docker data.", "loading")] : []),
      new DaemonStatusTreeItem(true),
      new SpacerTreeItem(),
      ...buildMetricItems(this.rootData.summary),
      new SpacerTreeItem(),
      new ContainerRootTreeItem(this.rootData.containers),
      new ImageRootTreeItem(this.rootData.images),
      new VolumeRootTreeItem(this.rootData.volumes),
      new SpacerTreeItem(),
      new SettingsRootTreeItem()
    ];
  }

  private async loadRootData(): Promise<void> {
    this.loading = true;
    this.loadError = undefined;
    this.didChangeTreeData.fire(undefined);

    try {
      const daemon = await this.docker.daemonStatus();
      if (!daemon.running) {
        throw new Error(daemon.error ?? "Docker daemon is not running.");
      }

      const [summary, containers, images, volumes] = await Promise.all([
        this.docker.statsSummary(),
        this.docker.listContainers(),
        this.docker.listImages(),
        this.docker.listVolumes()
      ]);

      this.rootData = { containers, images, summary, volumes };
    } catch (error) {
      this.rootData = undefined;
      this.loadError = formatDockerError(error);
    } finally {
      this.loading = false;
      this.didChangeTreeData.fire(undefined);
    }
  }
}

class DaemonStatusTreeItem extends vscode.TreeItem {
  constructor(running: boolean, error?: string) {
    super(running ? "Docker daemon running" : "Docker daemon not running", vscode.TreeItemCollapsibleState.None);

    this.contextValue = running ? "daemonRunning" : "daemonStopped";
    this.description = running ? "" : recommendedRuntimeLabel();
    this.tooltip = running
      ? "Docker daemon is running."
      : ["Docker daemon is not available.", error].filter(Boolean).join("\n");
    this.iconPath = new vscode.ThemeIcon(
      running ? "pass-filled" : "warning",
      new vscode.ThemeColor(running ? "testing.iconPassed" : "problemsWarningIcon.foreground")
    );
  }
}

class ConfigureRuntimeTreeItem extends vscode.TreeItem {
  constructor() {
    super("Configure Runtime", vscode.TreeItemCollapsibleState.None);

    this.contextValue = "configureRuntime";
    this.description = recommendedRuntimeLabel();
    this.tooltip = `Choose how to start a Docker-compatible runtime. Recommended: ${recommendedRuntimeLabel()}.`;
    this.iconPath = new vscode.ThemeIcon("settings-gear");
    this.command = {
      command: "dockerDesktopLite.configureRuntime",
      title: "Configure Runtime"
    };
  }
}

class SettingsRootTreeItem extends vscode.TreeItem {
  constructor() {
    super("Settings", vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = "settingsRoot";
    this.tooltip = "Docklite settings";
    this.iconPath = new vscode.ThemeIcon("settings-gear");
  }
}

class ChangeDockerEngineTreeItem extends vscode.TreeItem {
  constructor() {
    super("Change Docker Engine", vscode.TreeItemCollapsibleState.None);

    this.contextValue = "changeDockerEngine";
    this.description = recommendedRuntimeLabel();
    this.tooltip = "Choose a Docker-compatible runtime for Docklite.";
    this.iconPath = new vscode.ThemeIcon("server-environment");
    this.command = {
      command: "dockerDesktopLite.configureRuntime",
      title: "Change Docker Engine"
    };
  }
}

class RuntimeSettingsTreeItem extends vscode.TreeItem {
  constructor() {
    super("Runtime Settings", vscode.TreeItemCollapsibleState.None);

    this.contextValue = "runtimeSettings";
    this.description = "resources";
    this.tooltip = "Configure CPU, memory, disk, and VM backend defaults for runtime setup.";
    this.iconPath = new vscode.ThemeIcon("settings");
    this.command = {
      command: "dockerDesktopLite.openRuntimeSettings",
      title: "Runtime Settings"
    };
  }
}

function recommendedRuntimeLabel(): string {
  if (process.platform === "darwin") {
    return "Colima recommended";
  }

  if (process.platform === "win32") {
    return "WSL2 recommended";
  }

  return "Docker Engine recommended";
}

class MetricTreeItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon: string, tooltip: string) {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = description;
    this.tooltip = tooltip;
    this.contextValue = "metric";
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class SpacerTreeItem extends vscode.TreeItem {
  constructor() {
    super(" ", vscode.TreeItemCollapsibleState.None);

    this.contextValue = "spacer";
  }
}

class MessageTreeItem extends vscode.TreeItem {
  constructor(label: string, description: string, kind: "error" | "info" | "loading") {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.contextValue = "message";
    this.description = description;
    this.tooltip = [label, description].filter(Boolean).join("\n");
    this.iconPath = new vscode.ThemeIcon(messageIcon(kind));
  }
}

class ContainerRootTreeItem extends vscode.TreeItem {
  constructor(readonly containers: DockerContainer[]) {
    super("Containers", vscode.TreeItemCollapsibleState.Expanded);

    const runningCount = containers.filter((container) => container.state === "running").length;
    this.contextValue = "containerRoot";
    this.description = `${runningCount}/${containers.length} running`;
    this.tooltip = [
      "Containers",
      `Total: ${containers.length}`,
      `Running: ${runningCount}`
    ].join("\n");
    this.iconPath = new vscode.ThemeIcon("server-process");
  }
}

class ImageRootTreeItem extends vscode.TreeItem {
  constructor(readonly images: DockerImage[]) {
    super("Images", vscode.TreeItemCollapsibleState.Expanded);

    this.contextValue = "imageRoot";
    this.description = `${images.length}`;
    this.tooltip = [
      "Images",
      `Total: ${images.length}`
    ].join("\n");
    this.iconPath = new vscode.ThemeIcon("package");
  }
}

class VolumeRootTreeItem extends vscode.TreeItem {
  constructor(readonly volumes: DockerVolume[]) {
    super("Volumes", vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = "volumeRoot";
    this.description = `${volumes.length}`;
    this.tooltip = [
      "Volumes",
      `Total: ${volumes.length}`
    ].join("\n");
    this.iconPath = new vscode.ThemeIcon("database");
  }
}

export class VolumeTreeItem extends vscode.TreeItem {
  constructor(readonly volume: DockerVolume) {
    super(volume.name || "<unnamed>", vscode.TreeItemCollapsibleState.None);

    this.contextValue = "volume";
    this.description = volume.driver;
    this.tooltip = [
      `Name: ${volume.name}`,
      volume.driver ? `Driver: ${volume.driver}` : undefined,
      volume.scope ? `Scope: ${volume.scope}` : undefined,
      volume.mountpoint ? `Mountpoint: ${volume.mountpoint}` : undefined
    ]
      .filter(Boolean)
      .join("\n");
    this.iconPath = new vscode.ThemeIcon("database");
    this.command = {
      command: "dockerDesktopLite.openVolumeDetails",
      title: "Open Volume Details",
      arguments: [this]
    };
  }
}

export class ImageTreeItem extends vscode.TreeItem {
  constructor(readonly image: DockerImage, extensionUri: vscode.Uri) {
    super(formatImageLabel(image), vscode.TreeItemCollapsibleState.None);

    this.contextValue = image.running ? "runningImage" : "stoppedImage";
    this.description = image.size;
    this.tooltip = [
      `Repository: ${image.repository}`,
      `Tag: ${image.tag}`,
      `Image ID: ${image.id}`,
      `Status: ${image.running ? "used by a running container" : "not used by running containers"}`,
      image.createdSince ? `Created: ${image.createdSince}` : undefined,
      image.size ? `Size: ${image.size}` : undefined
    ]
      .filter(Boolean)
      .join("\n");
    this.iconPath = getStatusIcon(image.running, extensionUri);
    this.command = {
      command: "dockerDesktopLite.openImageDetails",
      title: "Open Image Details",
      arguments: [this]
    };
  }
}

class ProjectTreeItem extends vscode.TreeItem {
  constructor(readonly name: string, readonly containers: DockerContainer[]) {
    super(name, vscode.TreeItemCollapsibleState.Expanded);

    const runningCount = containers.filter((container) => container.state === "running").length;
    this.contextValue = "composeProject";
    this.description = `${runningCount}/${containers.length} running`;
    this.tooltip = [
      `Project: ${name}`,
      `Containers: ${containers.length}`,
      `Running: ${runningCount}`
    ].join("\n");
    this.iconPath = new vscode.ThemeIcon(runningCount > 0 ? "folder-active" : "folder");
  }
}

function formatImageLabel(image: DockerImage): string {
  if (image.repository === "<none>" && image.tag === "<none>") {
    return image.id || "<none>";
  }

  return `${image.repository}:${image.tag}`;
}

export class ContainerTreeItem extends vscode.TreeItem {
  constructor(readonly container: DockerContainer, extensionUri: vscode.Uri) {
    super(formatContainerTreeLabel(container), vscode.TreeItemCollapsibleState.None);

    this.contextValue = container.state === "running" ? "runningContainer" : "stoppedContainer";
    this.tooltip = [
      `Name: ${container.name}`,
      container.composeService ? `Service: ${container.composeService}` : undefined,
      `Image: ${container.image}`,
      `Status: ${container.status}`,
      container.ports ? `Ports: ${container.ports}` : undefined
    ]
      .filter(Boolean)
      .join("\n");

    this.iconPath = getContainerStatusIcon(container, extensionUri);
    this.command = {
      command: "dockerDesktopLite.openContainerDetails",
      title: "Open Container Details",
      arguments: [this]
    };
  }
}

function formatContainerTreeLabel(container: DockerContainer): string {
  if (container.composeProject && container.name.startsWith(`${container.composeProject}-`)) {
    return container.name.slice(container.composeProject.length + 1);
  }

  return container.composeService ?? container.name;
}

function getContainerStatusIcon(
  container: DockerContainer,
  extensionUri: vscode.Uri
): vscode.Uri | vscode.ThemeIcon {
  if (isContainerLifecyclePending(container)) {
    return new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("charts.blue"));
  }

  if (isContainerHealthStarting(container)) {
    return vscode.Uri.joinPath(extensionUri, "resources", "status-health-starting.svg");
  }

  return getStatusIcon(container.state === "running", extensionUri);
}

function isContainerLifecyclePending(container: DockerContainer): boolean {
  const state = container.state.toLowerCase();
  const status = container.status.toLowerCase();

  return (
    state === "created" ||
    state === "restarting" ||
    state === "removing" ||
    state === "starting" ||
    status.startsWith("created") ||
    status.startsWith("starting") ||
    status.includes("restarting")
  );
}

function isContainerHealthStarting(container: DockerContainer): boolean {
  return (
    container.state.toLowerCase() === "running" &&
    container.status.toLowerCase().includes("health: starting")
  );
}

function getStatusIcon(active: boolean, extensionUri: vscode.Uri): vscode.Uri {
  const iconFile = active ? "status-running.svg" : "status-not-running.svg";
  return vscode.Uri.joinPath(extensionUri, "resources", iconFile);
}

function buildProjectItems(containers: DockerContainer[]): ProjectTreeItem[] {
  const groups = containers.reduce<Map<string, DockerContainer[]>>((projects, container) => {
    const projectName = container.composeProject ?? "Standalone containers";
    const projectContainers = projects.get(projectName) ?? [];
    projectContainers.push(container);
    projects.set(projectName, projectContainers);
    return projects;
  }, new Map<string, DockerContainer[]>());

  return Array.from(groups.entries())
    .sort(([left], [right]) => {
      if (left === "Standalone containers") {
        return 1;
      }
      if (right === "Standalone containers") {
        return -1;
      }

      return left.localeCompare(right);
    })
    .map(([projectName, projectContainers]) => {
      projectContainers.sort((left, right) => {
        if (left.state === "running" && right.state !== "running") {
          return -1;
        }
        if (left.state !== "running" && right.state === "running") {
          return 1;
        }

        return (left.composeService ?? left.name).localeCompare(right.composeService ?? right.name);
      });

      return new ProjectTreeItem(projectName, projectContainers);
    });
}

function buildMetricItems(summary: DockerStatsSummary): MetricTreeItem[] {
  return [
    new MetricTreeItem(
      "Container CPU usage",
      "",
      "dashboard",
      "Total CPU usage across local containers"
    ),
    new MetricTreeItem(
      `${formatPercent(summary.cpuPercent)} / ${formatPercent(summary.cpuLimitPercent)}`,
      summary.cpuCount > 0 ? `${summary.cpuCount} CPUs available` : "",
      "pulse",
      "Total container CPU usage compared with Docker's available CPU capacity"
    ),
    new MetricTreeItem(
      "Container memory usage",
      "",
      "server",
      "Total memory usage across local containers"
    ),
    new MetricTreeItem(
      `${formatBytes(summary.memoryUsageBytes)} / ${formatBytes(summary.memoryLimitBytes)}`,
      "",
      "graph",
      "Total container memory usage compared with Docker's memory limit"
    )
  ];
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
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

function messageIcon(kind: "error" | "info" | "loading"): string {
  if (kind === "error") {
    return "error";
  }

  if (kind === "loading") {
    return "sync~spin";
  }

  return "info";
}

function formatDockerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Cannot connect to the Docker daemon")) {
    return "Docker daemon is not running. Start Docker Desktop and refresh.";
  }

  if (message.includes("command not found") || message.includes("ENOENT")) {
    return "Docker CLI was not found on PATH.";
  }

  return message.replace(/\s+/g, " ").trim();
}
