import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);
const DOCKER_COMMAND = "docker";
const DOCKER_COMMAND_CANDIDATES = [
  DOCKER_COMMAND,
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker"
];

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  composeProject?: string;
  composeService?: string;
  composeConfigFiles: string[];
}

export interface DockerImage {
  id: string;
  repository: string;
  running: boolean;
  tag: string;
  createdSince: string;
  size: string;
}

export interface DockerImageLayer {
  id: string;
  createdSince: string;
  createdBy: string;
  size: string;
  comment: string;
}

export interface DockerImageDetails {
  image: DockerImage;
  inspect: unknown;
  layers: DockerImageLayer[];
  usedByContainers: DockerContainer[];
}

export interface DockerRunImageOptions {
  command?: string;
  containerName?: string;
  env?: Array<{
    name: string;
    value: string;
  }>;
  ports?: Array<{
    container: string;
    host: string;
  }>;
  volumes?: Array<{
    container: string;
    host: string;
  }>;
}

export interface DockerVolume {
  name: string;
  driver: string;
  scope: string;
  mountpoint: string;
}

export interface DockerVolumeMount {
  containerId: string;
  containerName: string;
  destination: string;
  mode: string;
  rw: boolean;
  source: string;
}

export interface DockerVolumeDetails {
  currentPath: string;
  files: DockerVolumeFile[];
  inspect: unknown;
  mounts: DockerVolumeMount[];
  storedDataUnavailable?: string;
  usedByContainers: DockerContainer[];
  volume: DockerVolume;
}

export interface DockerVolumeFile {
  isDirectory: boolean;
  modifiedEpoch: number;
  mode: string;
  name: string;
  sizeBytes: number;
  type: string;
}

export interface DockerStatsSummary {
  cpuPercent: number;
  cpuLimitPercent: number;
  cpuCount: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
}

export interface ContainerPortBinding {
  containerPort: string;
  hostIp: string;
  hostPort: string;
  url?: string;
}

export interface ContainerDetails {
  container: DockerContainer;
  stats: ContainerResourceStats;
  inspect: unknown;
  logs: string;
  ports: ContainerPortBinding[];
}

export interface ContainerResourceStats {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
}

interface DockerPsRow {
  ID?: string;
  Names?: string;
  Image?: string;
  Status?: string;
  State?: string;
  Ports?: string;
  Labels?: string;
}

interface DockerStatsRow {
  BlockIO?: string;
  CPUPerc?: string;
  MemUsage?: string;
  NetIO?: string;
}

interface DockerImageRow {
  ID?: string;
  Repository?: string;
  Tag?: string;
  CreatedSince?: string;
  Size?: string;
}

interface DockerImageHistoryRow {
  ID?: string;
  CreatedSince?: string;
  CreatedBy?: string;
  Size?: string;
  Comment?: string;
}

interface DockerVolumeRow {
  Driver?: string;
  Mountpoint?: string;
  Name?: string;
  Scope?: string;
}

interface VolumeStatRow {
  mode: string;
  modifiedEpoch: number;
  name: string;
  sizeBytes: number;
  type: string;
}

export class DockerClient {
  private dockerCommand: string | undefined;

  constructor(private readonly output: vscode.OutputChannel) {}

  async daemonStatus(): Promise<{ error?: string; running: boolean }> {
    try {
      await this.run("docker", ["info", "--format", "{{json .ServerVersion}}"], false);
      return { running: true };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        running: false
      };
    }
  }

  async listContainers(): Promise<DockerContainer[]> {
    const output = await this.run("docker", [
      "ps",
      "-a",
      "--format",
      "{{json .}}"
    ]);

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DockerPsRow)
      .map((row) => {
        const labels = parseDockerLabels(row.Labels ?? "");

        return {
          id: row.ID ?? "",
          name: row.Names ?? "unnamed",
          image: row.Image ?? "",
          status: row.Status ?? "",
          state: row.State ?? "",
          ports: row.Ports ?? "",
          composeProject: labels["com.docker.compose.project"],
          composeService: labels["com.docker.compose.service"],
          composeConfigFiles: splitComposeConfigFiles(labels["com.docker.compose.project.config_files"])
        };
      });
  }

  async listImages(): Promise<DockerImage[]> {
    const [output, containers] = await Promise.all([
      this.run("docker", [
        "image",
        "ls",
        "--format",
        "{{json .}}"
      ]),
      this.listContainers()
    ]);
    const runningContainers = containers.filter((container) => container.state === "running");

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DockerImageRow)
      .map((row) => {
        const image: DockerImage = {
          id: row.ID ?? "",
          repository: row.Repository ?? "<none>",
          running: false,
          tag: row.Tag ?? "<none>",
          createdSince: row.CreatedSince ?? "",
          size: row.Size ?? ""
        };

        image.running = runningContainers.some((container) => imageMatchesContainer(image, container));
        return image;
      });
  }

  async imageDetails(image: DockerImage): Promise<DockerImageDetails> {
    const [inspect, layers, containers] = await Promise.all([
      this.inspectImage(imageReference(image)),
      this.imageHistory(imageReference(image)),
      this.listContainers()
    ]);

    return {
      image,
      inspect,
      layers,
      usedByContainers: containers.filter((container) => imageMatchesContainer(image, container))
    };
  }

  async inspectImage(imageReference: string): Promise<unknown> {
    const output = await this.run("docker", ["image", "inspect", imageReference]);
    const parsed = JSON.parse(output) as unknown[];
    return parsed[0] ?? {};
  }

  async imageHistory(imageReference: string): Promise<DockerImageLayer[]> {
    const output = await this.run("docker", [
      "history",
      "--no-trunc",
      "--format",
      "{{json .}}",
      imageReference
    ]);

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DockerImageHistoryRow)
      .map((row) => ({
        id: row.ID ?? "",
        createdSince: row.CreatedSince ?? "",
        createdBy: row.CreatedBy ?? "",
        size: row.Size ?? "",
        comment: row.Comment ?? ""
      }));
  }

  async runImage(image: DockerImage, options: DockerRunImageOptions = {}): Promise<void> {
    const args = ["run", "-d"];

    if (options.containerName?.trim()) {
      args.push("--name", options.containerName.trim());
    }

    for (const port of options.ports ?? []) {
      if (port.host.trim() && port.container.trim()) {
        args.push("-p", `${port.host.trim()}:${port.container.trim()}`);
      }
    }

    for (const volume of options.volumes ?? []) {
      if (volume.host.trim() && volume.container.trim()) {
        args.push("-v", `${volume.host.trim()}:${volume.container.trim()}`);
      }
    }

    for (const env of options.env ?? []) {
      if (env.name.trim()) {
        args.push("-e", `${env.name.trim()}=${env.value}`);
      }
    }

    args.push(imageReference(image));

    if (options.command?.trim()) {
      args.push(...parseCommandLine(options.command.trim()));
    }

    await this.run("docker", args);
  }

  async stopImageContainers(image: DockerImage): Promise<void> {
    const containers = await this.listContainers();
    const containerIds = containers
      .filter((container) => container.state === "running")
      .filter((container) => imageMatchesContainer(image, container))
      .map((container) => container.id);

    if (containerIds.length === 0) {
      vscode.window.showInformationMessage("No running containers are using this image.");
      return;
    }

    await this.run("docker", ["stop", ...containerIds]);
  }

  async removeImage(image: DockerImage): Promise<void> {
    const containers = await this.listContainers();
    const runningContainers = containers
      .filter((container) => container.state === "running")
      .filter((container) => imageMatchesContainer(image, container));

    if (runningContainers.length > 0) {
      const names = runningContainers.map((container) => container.name).join(", ");
      throw new Error(`Could not delete image because running containers are using it: ${names}.`);
    }

    await this.run("docker", ["image", "rm", "-f", imageReference(image)], false);
  }

  async listVolumes(): Promise<DockerVolume[]> {
    const output = await this.run("docker", [
      "volume",
      "ls",
      "--format",
      "{{json .}}"
    ]);

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DockerVolumeRow)
      .map((row) => ({
        name: row.Name ?? "",
        driver: row.Driver ?? "",
        scope: row.Scope ?? "",
        mountpoint: row.Mountpoint ?? ""
      }));
  }

  async volumeDetails(volume: DockerVolume, relativePath = ""): Promise<DockerVolumeDetails> {
    const currentPath = normalizeVolumePath(relativePath);
    const [inspect, containers] = await Promise.all([
      this.inspectVolume(volume.name),
      this.listContainers()
    ]);
    const inspectedContainers = await Promise.all(
      containers.map(async (container) => ({
        container,
        inspect: await this.inspect(container.id)
      }))
    );
    const mounts = inspectedContainers.flatMap(({ container, inspect }) => {
      return extractVolumeMounts(inspect, volume.name, container);
    });
    const usedContainerIds = new Set(mounts.map((mount) => mount.containerId));
    const containerById = new Map(containers.map((container) => [container.id, container]));
    const runningMount = mounts.find((mount) => containerById.get(mount.containerId)?.state === "running");
    let files: DockerVolumeFile[] = [];
    let storedDataUnavailable: string | undefined;

    try {
      files = runningMount
        ? await this.listVolumeFilesFromMount(runningMount, currentPath)
        : await this.listVolumeFilesFromHelper(volume, currentPath);
    } catch (error) {
      storedDataUnavailable = `Unable to read stored data: ${error instanceof Error ? error.message : String(error)}`;
    }

    return {
      currentPath,
      files,
      inspect,
      mounts,
      storedDataUnavailable,
      usedByContainers: containers.filter((container) => usedContainerIds.has(container.id)),
      volume
    };
  }

  async inspectVolume(volumeName: string): Promise<unknown> {
    const output = await this.run("docker", ["volume", "inspect", volumeName]);
    const parsed = JSON.parse(output) as unknown[];
    return parsed[0] ?? {};
  }

  async removeVolume(volumeName: string): Promise<void> {
    await this.run("docker", ["volume", "rm", volumeName], false);
  }

  async listVolumeFilesFromMount(mount: DockerVolumeMount, relativePath = ""): Promise<DockerVolumeFile[]> {
    const targetPath = joinVolumePath(mount.destination, relativePath);
    const script = [
      `cd ${shellQuote(targetPath)} || exit 0`,
      `find . -maxdepth 1 -mindepth 1 -exec stat -c '%F|%n|%s|%Y|%A' {} \\;`
    ].join(" && ");
    const output = await this.run("docker", ["exec", mount.containerId, "sh", "-c", script]);

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseVolumeStatLine)
      .filter((file): file is DockerVolumeFile => Boolean(file))
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
  }

  async listVolumeFilesFromHelper(volume: DockerVolume, relativePath = ""): Promise<DockerVolumeFile[]> {
    const targetPath = joinVolumePath("/volume", relativePath);
    const output = await this.run("docker", [
      "run",
      "--rm",
      "-v",
      `${volume.name}:/volume:ro`,
      "busybox:latest",
      "sh",
      "-c",
      `cd ${shellQuote(targetPath)} || exit 0; find . -maxdepth 1 -mindepth 1 -exec stat -c '%F|%n|%s|%Y|%A' {} \\;`
    ]);

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseVolumeStatLine)
      .filter((file): file is DockerVolumeFile => Boolean(file))
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
  }

  async readVolumeTextFile(volume: DockerVolume, relativePath: string): Promise<string> {
    const currentPath = normalizeVolumePath(relativePath);
    const mounts = await this.volumeDetails(volume);
    const runningMount = mounts.mounts.find((mount) => (
      mounts.usedByContainers.some((container) => container.id === mount.containerId && container.state === "running")
    ));

    return runningMount
      ? this.readVolumeTextFileFromMount(runningMount, currentPath)
      : this.readVolumeTextFileFromHelper(volume, currentPath);
  }

  async readVolumeTextFileFromMount(mount: DockerVolumeMount, relativePath: string): Promise<string> {
    const targetPath = joinVolumePath(mount.destination, relativePath);
    const script = volumePreviewScript(targetPath);
    return this.run("docker", ["exec", mount.containerId, "sh", "-c", script]);
  }

  async readVolumeTextFileFromHelper(volume: DockerVolume, relativePath: string): Promise<string> {
    const targetPath = joinVolumePath("/volume", relativePath);
    return this.run("docker", [
      "run",
      "--rm",
      "-v",
      `${volume.name}:/volume:ro`,
      "busybox:latest",
      "sh",
      "-c",
      volumePreviewScript(targetPath)
    ]);
  }

  async statsSummary(): Promise<DockerStatsSummary> {
    const [statsOutput, cpuInfoOutput] = await Promise.all([
      this.run("docker", [
        "stats",
        "--no-stream",
        "--all",
        "--format",
        "{{json .}}"
      ]),
      this.run("docker", ["info", "--format", "{{json .NCPU}}"])
    ]);

    const cpuCount = Number.parseInt(cpuInfoOutput.trim(), 10) || 0;
    const rows = statsOutput
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DockerStatsRow);

    const memoryTotals = rows.reduce(
      (totals, row) => {
        const parsed = parseMemoryUsage(row.MemUsage ?? "");
        return {
          usage: totals.usage + parsed.usage,
          limit: Math.max(totals.limit, parsed.limit)
        };
      },
      { usage: 0, limit: 0 }
    );

    return {
      cpuPercent: rows.reduce((total, row) => total + parsePercent(row.CPUPerc ?? ""), 0),
      cpuLimitPercent: cpuCount * 100,
      cpuCount,
      memoryUsageBytes: memoryTotals.usage,
      memoryLimitBytes: memoryTotals.limit
    };
  }

  async logs(containerId: string, since?: string): Promise<string> {
    const args = ["logs", "--tail", "300"];
    if (since) {
      args.push("--since", since);
    }

    args.push(containerId);
    return this.runCombinedOutput("docker", args);
  }

  async inspect(containerId: string): Promise<unknown> {
    const output = await this.run("docker", ["inspect", containerId]);
    const parsed = JSON.parse(output) as unknown[];
    return parsed[0] ?? {};
  }

  async containerDetails(container: DockerContainer): Promise<ContainerDetails> {
    const [inspect, logs, stats] = await Promise.all([
      this.inspect(container.id),
      this.logs(container.id).catch((error) => (
        `Unable to load logs: ${error instanceof Error ? error.message : String(error)}`
      )),
      this.containerStats(container.id)
    ]);

    return {
      container,
      stats,
      inspect,
      logs,
      ports: extractPortBindings(inspect)
    };
  }

  async containerStats(containerId: string): Promise<ContainerResourceStats> {
    if (!containerId) {
      return emptyContainerStats();
    }

    const output = await this.run("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      containerId
    ]);
    const row = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DockerStatsRow)[0];

    if (!row) {
      return emptyContainerStats();
    }

    const memory = parseMemoryUsage(row.MemUsage ?? "");
    const block = parseDockerBytePair(row.BlockIO ?? "");
    const network = parseDockerBytePair(row.NetIO ?? "");

    return {
      cpuPercent: parsePercent(row.CPUPerc ?? ""),
      memoryUsageBytes: memory.usage,
      memoryLimitBytes: memory.limit,
      networkRxBytes: network.left,
      networkTxBytes: network.right,
      blockReadBytes: block.left,
      blockWriteBytes: block.right
    };
  }

  async findContainer(containerId: string): Promise<DockerContainer | undefined> {
    const containers = await this.listContainers();
    return containers.find((container) => (
      container.id === containerId ||
      container.id.startsWith(containerId) ||
      containerId.startsWith(container.id)
    ));
  }

  async findMatchingContainer(container: DockerContainer): Promise<DockerContainer | undefined> {
    const containers = await this.listContainers();
    const idMatch = containers.find((candidate) => (
      candidate.id === container.id ||
      candidate.id.startsWith(container.id) ||
      container.id.startsWith(candidate.id)
    ));

    if (idMatch) {
      return idMatch;
    }

    if (container.composeProject && container.composeService) {
      const composeMatch = containers.find((candidate) => (
        candidate.composeProject === container.composeProject &&
        candidate.composeService === container.composeService
      ));

      if (composeMatch) {
        return composeMatch;
      }
    }

    return containers.find((candidate) => candidate.name === container.name);
  }

  async containerAction(
    action: "start" | "stop" | "restart" | "pause" | "unpause",
    containerId: string
  ): Promise<void> {
    await this.run("docker", [action, containerId]);
  }

  async removeContainer(containerId: string): Promise<void> {
    await this.run("docker", ["rm", "-f", "-v", containerId], false);
  }

  private async run(command: string, args: string[], showError = true, cwd?: string): Promise<string> {
    const executable = await this.resolveCommand(command);
    this.output.appendLine(`> ${executable} ${args.join(" ")}`);

    try {
      const result = await execFileAsync(executable, args, {
        cwd: cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      });

      if (result.stdout) {
        this.output.append(result.stdout);
      }
      if (result.stderr) {
        this.output.append(result.stderr);
      }

      return result.stdout;
    } catch (error) {
      const rawMessage = rawDockerErrorMessage(error);
      const message = friendlyDockerErrorMessage(error, executable, args);
      this.output.appendLine(rawMessage);
      if (message !== rawMessage) {
        this.output.appendLine(`Friendly error: ${message}`);
      }
      if (showError) {
        vscode.window.showErrorMessage(message);
      }
      throw new Error(message);
    }
  }

  private async runCombinedOutput(command: string, args: string[]): Promise<string> {
    const executable = await this.resolveCommand(command);
    this.output.appendLine(`> ${executable} ${args.join(" ")}`);

    try {
      const result = await execFileAsync(executable, args, {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      });

      if (result.stdout) {
        this.output.append(result.stdout);
      }
      if (result.stderr) {
        this.output.append(result.stderr);
      }

      return [result.stdout, result.stderr].filter(Boolean).join("\n");
    } catch (error) {
      const rawMessage = rawDockerErrorMessage(error);
      const message = friendlyDockerErrorMessage(error, executable, args);
      this.output.appendLine(rawMessage);
      if (message !== rawMessage) {
        this.output.appendLine(`Friendly error: ${message}`);
      }
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }
  }

  private async resolveCommand(command: string): Promise<string> {
    if (command !== DOCKER_COMMAND) {
      return command;
    }

    if (this.dockerCommand) {
      return this.dockerCommand;
    }

    for (const candidate of DOCKER_COMMAND_CANDIDATES) {
      try {
        await execFileAsync(candidate, ["--version"]);
        this.dockerCommand = candidate;
        if (candidate !== DOCKER_COMMAND) {
          this.output.appendLine(`Using Docker CLI at ${candidate}`);
        }
        return candidate;
      } catch {
        // Try the next common Docker Desktop/Homebrew location.
      }
    }

    return DOCKER_COMMAND;
  }
}

interface DockerExecError extends Error {
  code?: unknown;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  syscall?: string;
}

function friendlyDockerErrorMessage(error: unknown, command: string, args: string[]): string {
  const rawMessage = rawDockerErrorMessage(error);
  const compactMessage = compactDockerError(rawMessage);
  const lower = compactMessage.toLowerCase();
  const dockerCommand = args[0] ?? "command";

  if (isDockerUnavailable(error, lower)) {
    return "Docker is not running or the Docker CLI is unavailable. Start Docker, then refresh Docklite.";
  }

  const missingEnv = compactMessage.match(/(?:required variable|variable)\s+([A-Z_][A-Z0-9_]*)\s+(?:is missing|missing|is not set)/i)
    ?? compactMessage.match(/([A-Z_][A-Z0-9_]*)\s+is required/i);
  if (missingEnv) {
    return `Missing required environment variable: ${missingEnv[1]}. Add it to your shell or .env file, then try again.`;
  }

  if (dockerCommand === "image" && args[1] === "rm") {
    if (lower.includes("image is being used by running container") || lower.includes("must be forced")) {
      return "Could not delete image because one or more containers still use it. Stop and delete those containers first.";
    }

    if (lower.includes("no such image")) {
      return "Could not delete image because it no longer exists. Refresh the image list.";
    }
  }

  if (dockerCommand === "volume" && args[1] === "rm") {
    if (lower.includes("volume is in use") || lower.includes("remove volume") && lower.includes("in use")) {
      return "Could not delete volume because a container still uses it. Delete or detach that container first.";
    }

    if (lower.includes("no such volume")) {
      return "Could not delete volume because it no longer exists. Refresh the volume list.";
    }
  }

  if (dockerCommand === "rm") {
    if (lower.includes("no such container")) {
      return "Could not delete container because it no longer exists. Refresh the container list.";
    }

    if (lower.includes("removal of container") && lower.includes("is already in progress")) {
      return "This container is already being deleted. Refresh the container list in a moment.";
    }
  }

  if (["start", "stop", "restart", "pause", "unpause"].includes(dockerCommand)) {
    if (lower.includes("no such container")) {
      return `Could not ${dockerCommand} container because it no longer exists. Refresh the container list.`;
    }

    if (lower.includes("is not running") && (dockerCommand === "stop" || dockerCommand === "pause")) {
      return `Could not ${dockerCommand} container because it is not running.`;
    }

    if (lower.includes("is not paused") && dockerCommand === "unpause") {
      return "Could not unpause container because it is not paused.";
    }
  }

  if (dockerCommand === "run") {
    if (lower.includes("port is already allocated") || lower.includes("bind: address already in use")) {
      return "Could not start container because one of the host ports is already in use.";
    }

    if (lower.includes("no such image") || lower.includes("unable to find image")) {
      return "Could not start container because the image is not available locally.";
    }

    if (lower.includes("conflict") && lower.includes("container name")) {
      return "Could not start container because that container name is already in use.";
    }

    if (lower.includes("invalid reference format")) {
      return "Could not start container because the image name is invalid.";
    }
  }

  if (command === "docker") {
    return `Docker ${dockerCommand} failed: ${compactMessage}`;
  }

  return compactMessage;
}

function rawDockerErrorMessage(error: unknown): string {
  if (!isDockerExecError(error)) {
    return String(error);
  }

  const stderr = bufferToString(error.stderr).trim();
  const stdout = bufferToString(error.stdout).trim();

  if (stderr || stdout) {
    return [stderr, stdout].filter(Boolean).join("\n");
  }

  return error.message;
}

function compactDockerError(message: string): string {
  return message
    .replace(/^Error response from daemon:\s*/i, "")
    .replace(/^error during connect:\s*/i, "")
    .replace(/^Command failed:\s*docker\s+[^\n]*\n?/i, "")
    .replace(/\s+/g, " ")
    .trim() || "Unknown Docker error.";
}

function isDockerUnavailable(error: unknown, lowerMessage: string): boolean {
  const code = isDockerExecError(error) ? String(error.code ?? "") : "";

  return (
    code === "ENOENT" ||
    lowerMessage.includes("cannot connect to the docker daemon") ||
    lowerMessage.includes("is the docker daemon running") ||
    lowerMessage.includes("docker daemon is not running") ||
    lowerMessage.includes("error during connect") ||
    lowerMessage.includes("failed to connect to docker") ||
    lowerMessage.includes("no such file or directory") && lowerMessage.includes("docker.sock")
  );
}

function isDockerExecError(error: unknown): error is DockerExecError {
  return error instanceof Error;
}

function bufferToString(value: string | Buffer | undefined): string {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return value ?? "";
}

function parsePercent(value: string): number {
  return Number.parseFloat(value.replace("%", "")) || 0;
}

function parseCommandLine(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function imageReference(image: DockerImage): string {
  if (image.repository === "<none>" || image.tag === "<none>") {
    return image.id;
  }

  return `${image.repository}:${image.tag}`;
}

function imageMatchesContainer(image: DockerImage, container: DockerContainer): boolean {
  const containerImage = container.image;
  const reference = imageReference(image);

  return (
    containerImage === reference ||
    containerImage === image.id ||
    image.id.startsWith(containerImage) ||
    containerImage.startsWith(image.id)
  );
}

function parseDockerLabels(value: string): Record<string, string> {
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((labels, label) => {
      const separator = label.indexOf("=");
      if (separator === -1) {
        labels[label] = "";
        return labels;
      }

      labels[label.slice(0, separator)] = label.slice(separator + 1);
      return labels;
    }, {});
}

function parseVolumeStatLine(line: string): DockerVolumeFile | undefined {
  const [type = "", rawName = "", rawSize = "0", rawModified = "0", mode = ""] = line.split("|");
  if (!rawName) {
    return undefined;
  }

  const name = rawName.replace(/^\.\//, "");
  const normalizedType = type.toLowerCase();

  return {
    isDirectory: normalizedType.includes("directory"),
    modifiedEpoch: Number.parseInt(rawModified, 10) || 0,
    mode,
    name,
    sizeBytes: Number.parseInt(rawSize, 10) || 0,
    type: formatVolumeFileType(type)
  };
}

function normalizeVolumePath(value: string): string {
  const normalized = path.posix.normalize(`/${value}`).replace(/^\/+/, "");
  if (normalized === "." || normalized === "") {
    return "";
  }

  return normalized
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function joinVolumePath(root: string, relativePath: string): string {
  const normalized = normalizeVolumePath(relativePath);
  if (!normalized) {
    return root;
  }

  return path.posix.join(root, normalized);
}

function volumePreviewScript(targetPath: string): string {
  const quotedPath = shellQuote(targetPath);
  return [
    `test -f ${quotedPath} || exit 0`,
    `test $(wc -c < ${quotedPath}) -le 262144 || { echo "File is too large to preview."; exit 0; }`,
    `LC_ALL=C grep -q '[^[:print:][:space:]]' ${quotedPath} && { echo "Binary file preview is not available."; exit 0; }`,
    `head -c 65536 ${quotedPath}`
  ].join("; ");
}

function formatVolumeFileType(type: string): string {
  const normalized = type.toLowerCase();

  if (normalized.includes("directory")) {
    return "Directory";
  }
  if (normalized.includes("symbolic link")) {
    return "Symlink";
  }
  if (normalized.includes("regular")) {
    return "File";
  }

  return type || "File";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function splitComposeConfigFiles(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value.split(",").map((file) => file.trim()).filter(Boolean);
}

function parseMemoryUsage(value: string): { usage: number; limit: number } {
  const [usage, limit] = value.split("/").map((part) => part.trim());
  return {
    usage: parseDockerBytes(usage ?? ""),
    limit: parseDockerBytes(limit ?? "")
  };
}

function parseDockerBytePair(value: string): { left: number; right: number } {
  const [left, right] = value.split("/").map((part) => part.trim());
  return {
    left: parseDockerBytes(left ?? ""),
    right: parseDockerBytes(right ?? "")
  };
}

function emptyContainerStats(): ContainerResourceStats {
  return {
    cpuPercent: 0,
    memoryUsageBytes: 0,
    memoryLimitBytes: 0,
    networkRxBytes: 0,
    networkTxBytes: 0,
    blockReadBytes: 0,
    blockWriteBytes: 0
  };
}

function parseDockerBytes(value: string): number {
  const match = value.match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) {
    return 0;
  }

  const amount = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1_000,
    mb: 1_000_000,
    gb: 1_000_000_000,
    tb: 1_000_000_000_000,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4
  };

  return amount * (multipliers[unit] ?? 0);
}

function extractPortBindings(inspect: unknown): ContainerPortBinding[] {
  const ports = getRecord(getRecord(inspect)["NetworkSettings"])["Ports"];
  if (!isRecord(ports)) {
    return [];
  }

  return Object.entries(ports).flatMap(([containerPort, bindings]) => {
    if (!Array.isArray(bindings)) {
      return [];
    }

    return bindings
      .map((binding): ContainerPortBinding | undefined => {
        if (!isRecord(binding)) {
          return undefined;
        }

        const hostIp = String(binding.HostIp ?? "");
        const hostPort = String(binding.HostPort ?? "");
        const portBinding: ContainerPortBinding = {
          containerPort,
          hostIp,
          hostPort
        };
        if (hostPort) {
          portBinding.url = `http://localhost:${hostPort}`;
        }

        return portBinding;
      })
      .filter((binding): binding is ContainerPortBinding => Boolean(binding));
  });
}

function extractVolumeMounts(
  inspect: unknown,
  volumeName: string,
  container: DockerContainer
): DockerVolumeMount[] {
  const mounts = getRecord(inspect).Mounts;
  if (!Array.isArray(mounts)) {
    return [];
  }

  return mounts
    .map((mount): DockerVolumeMount | undefined => {
      if (!isRecord(mount) || mount.Type !== "volume" || mount.Name !== volumeName) {
        return undefined;
      }

      return {
        containerId: container.id,
        containerName: container.name,
        destination: String(mount.Destination ?? ""),
        mode: String(mount.Mode ?? ""),
        rw: Boolean(mount.RW),
        source: String(mount.Source ?? "")
      };
    })
    .filter((mount): mount is DockerVolumeMount => Boolean(mount));
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
