import { rm } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawn } from "node:child_process";
import { getAzdProject, iacComposerAzdTemplate } from "./azd.js";
import { IacComposerError } from "./diagnostics.js";
import {
  collectBicepEnvironmentValues,
  compileProvisioning,
  copyProvisioningArtifacts,
  defaultProvisioningDirectory,
  installRenderedFiles,
} from "./provisioning-artifacts.js";
import { renderProvisioningStack } from "./provisioning.js";
import type {
  Command,
  DeploymentAction,
  DeploymentOptions,
  DeploymentProgram,
  ProvisionOptions,
  ProvisionOutputs,
} from "./deployment-types.js";
import type { DeploymentEvent, StepEvent } from "./report.js";

export function defineDeployment(program: DeploymentProgram): DeploymentProgram {
  return program;
}

export function createDeployment(options: DeploymentOptions = {}): Deployment {
  return new Deployment(options);
}

export class Deployment {
  readonly projectDirectory: string;
  readonly environment?: string;
  readonly component?: string;
  readonly dryRun: boolean;

  readonly #log: (message: string) => void;
  #layersByProject = new Map<string, string[]>();
  #events: { nextId: number; onEvent?: (event: DeploymentEvent) => void };

  constructor(options: DeploymentOptions = {}) {
    this.projectDirectory = resolve(options.projectDirectory ?? process.cwd());
    this.environment = options.environment;
    this.component = options.component;
    this.dryRun = options.dryRun ?? false;
    this.#log = options.log ?? console.log;
    this.#events = { nextId: 0, onEvent: options.onEvent };
  }

  inDirectory(projectDirectory: string): Deployment {
    const child = new Deployment({
      projectDirectory,
      environment: this.environment,
      component: this.component,
      dryRun: this.dryRun,
      log: this.#log,
    });
    child.#events = this.#events;
    child.#layersByProject = this.#layersByProject;
    return child;
  }

  async env(name: string, values: NodeJS.ProcessEnv): Promise<void> {
    await this.#step("env", name, async () => {
      Object.assign(process.env, values);
    });
  }

  async provision(name: string, options: ProvisionOptions): Promise<ProvisionOutputs> {
    let outputs: ProvisionOutputs = {};
    await this.#step("provision", name, async () => {
      validateProvisionOptions(options);
      const outputDirectory = resolve(
        this.projectDirectory,
        options.layer?.outputDirectory ??
          options.outputDirectory ??
          await defaultProvisioningDirectory(this.projectDirectory),
      );
      const layer = inferLayerName(outputDirectory);
      const azdProjectDirectory = layer ? dirname(outputDirectory) : outputDirectory;
      const entrypoint = options.layer?.entrypoint ?? options.entrypoint;
      const requiredFiles = [
        options.templateFile ?? "main.bicep",
        options.parametersFile ?? "main.bicepparam",
      ];
      if (options.stack !== undefined) {
        const files = await renderProvisioningStack(
          options.stack,
          resolve(this.projectDirectory, "package.json"),
          requiredFiles,
          options.parameters ?? {},
          options,
        );
        await installRenderedFiles(outputDirectory, files, azdProjectDirectory, requiredFiles);
      } else if (options.compiler && options.artifactsDirectory) {
        await this.#execute(options.compiler);
        await copyProvisioningArtifacts(
          resolve(this.projectDirectory, options.artifactsDirectory),
          outputDirectory,
          azdProjectDirectory,
          requiredFiles,
        );
      } else if (entrypoint) {
        await compileProvisioning(
          resolve(this.projectDirectory, entrypoint),
          outputDirectory,
          azdProjectDirectory,
          requiredFiles,
          options.parameters,
        );
      } else {
        throw new Error(
          "Provisioning requires a stack, an entrypoint, or a compiler with artifactsDirectory.",
        );
      }

      const parametersFile = resolve(
        outputDirectory,
        options.parametersFile ?? "main.bicepparam",
      );
      const templateFile = resolve(
        outputDirectory,
        options.templateFile ?? "main.bicep",
      );
      const environmentValues = {
        ...(await collectBicepEnvironmentValues(
          parametersFile,
          options.parameters,
        )),
        ...(options.resourceGroup
          ? { AZURE_RESOURCE_GROUP: options.resourceGroup }
          : {}),
        ...options.environmentValues,
      };
      const module = relative(
        outputDirectory,
        resolve(dirname(templateFile), basename(templateFile, extname(templateFile))),
      ).split(sep).join("/");
      const dependsOn = layer
        ? this.#inferLayerDependencies(azdProjectDirectory, layer)
        : [];
      const infra = layer
        ? {
            provider: "bicep",
            layers: [
              {
                name: layer,
                path: relativeAzdPath(azdProjectDirectory, outputDirectory),
                module,
                ...(dependsOn.length ? { dependsOn } : {}),
              },
            ],
          }
        : {
            provider: "bicep",
            path: ".",
            module,
          };
      if (layer) {
            await rm(resolve(outputDirectory, "azure.yaml"), { force: true });
            await rm(resolve(outputDirectory, ".azure"), {
              recursive: true,
              force: true,
            });
        await rm(resolve(azdProjectDirectory, ".iac-composer-project.json"), {
          force: true,
        });
        await rm(resolve(azdProjectDirectory, ".iac-compose-project.json"), {
          force: true,
        });
      }
      const project = getAzdProject(this, {
        directory: azdProjectDirectory,
        mergeManifest: layer !== undefined,
        manifest: {
          name: sanitizeAzdName(
            options.deploymentName ?? basename(outputDirectory),
          ),
          ...(layer ? { metadata: { template: iacComposerAzdTemplate } } : {}),
          ...(layer ? { requiredVersions: { azd: ">= 1.30.0" } } : {}),
          infra,
        },
        subscription:
          options.subscription ?? process.env.AZURE_SUBSCRIPTION_ID,
        location: options.location ?? process.env.AZURE_LOCATION,
        values: environmentValues,
      });
      this.#events.onEvent?.({
        type: "artifacts",
        step: name,
        projectDirectory: azdProjectDirectory,
        outputDirectory,
        templateFile,
        parametersFile,
        manifestFile: resolve(azdProjectDirectory, "azure.yaml"),
        ...(layer ? { layer } : {}),
        dependsOn,
      });
      outputs = await project.provision();
    }, true);
    return outputs;
  }

  async deploy(name: string, action: DeploymentAction): Promise<void> {
    await this.#step("deploy", name, async () => {
      if (typeof action === "function") await action();
      else await this.#execute(action);
    });
  }

  async run(name: string, command: Command): Promise<void> {
    await this.#step("command", name, async () => {
      await this.#execute(command);
    });
  }

  async execute(command: Command): Promise<void> {
    this.#log(`[iac-composer] $ ${formatCommand(command.command, command.args ?? [])}`);
    if (this.dryRun) return;
    await this.#execute(command, false, false);
  }

  async capture(command: Command): Promise<string> {
    this.#log(`[iac-composer] $ ${formatCommand(command.command, command.args ?? [])}`);
    if (this.dryRun) return "";
    return this.#execute(command, true, false);
  }

  #inferLayerDependencies(projectDirectory: string, layer: string): string[] {
    const layers = this.#layersByProject.get(projectDirectory) ?? [];
    if (!this.#layersByProject.has(projectDirectory)) {
      this.#layersByProject.set(projectDirectory, layers);
    }
    const existingIndex = layers.indexOf(layer);
    if (existingIndex >= 0) {
      return existingIndex === 0 ? [] : [layers[existingIndex - 1]!];
    }
    const dependsOn = layers.length > 0 ? [layers[layers.length - 1]!] : [];
    layers.push(layer);
    return dependsOn;
  }

  async #step(
    kind: StepEvent["kind"],
    name: string,
    action: () => Promise<void>,
    runInDryRun = false,
  ): Promise<void> {
    this.#log(`[iac-composer] ${this.dryRun ? "DRY" : "RUN"} ${kind}: ${name}`);
    const step = {
      type: "step" as const,
      id: ++this.#events.nextId,
      kind,
      name,
      projectDirectory: this.projectDirectory,
    };
    if (this.dryRun && !runInDryRun) {
      this.#events.onEvent?.({ ...step, status: "skipped" });
      return;
    }
    this.#events.onEvent?.({ ...step, status: "started" });
    try {
      await action();
    } catch (error) {
      this.#events.onEvent?.({ ...step, status: "failed" });
      throw error;
    }
    this.#events.onEvent?.({ ...step, status: this.dryRun ? "previewed" : "succeeded" });
    if (!this.dryRun) this.#log(`[iac-composer] DONE ${kind}: ${name}`);
  }

  async #execute(command: Command, capture = false, log = true): Promise<string> {
    const args = [...(command.args ?? [])];
    if (log) this.#log(`[iac-composer] $ ${formatCommand(command.command, args)}`);

    return new Promise((resolvePromise, reject) => {
      const child = spawn(command.command, args, {
        cwd: resolve(this.projectDirectory, command.cwd ?? "."),
        env: { ...process.env, ...command.env },
        shell: false,
        stdio: capture ? ["ignore", "pipe", "pipe"] : ["inherit", "inherit", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        process.stderr.write(chunk);
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        reject(new IacComposerError({
          code: error.code === "ENOENT" ? "COMMAND_NOT_FOUND" : "COMMAND_START_FAILED",
          category: "execution",
          message: `Could not start '${command.command}'.`,
          target: command.command,
          repair: "Check that the executable is installed, the working directory exists, and permissions allow execution.",
        }, { cause: error, message: error.message }));
      });
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolvePromise(stdout);
          return;
        }
        reject(
          new IacComposerError({
            code: "COMMAND_FAILED",
            category: "execution",
            message: `${command.command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
            target: command.command,
            exitCode: code,
            ...(signal ? { signal } : {}),
            repair: "Inspect stderr and the failed step. Check external state before retrying; completed actions are not rolled back.",
          }, {
            message: `${command.command} exited with ${signal ? `signal ${signal}` : `code ${code}`}` +
              (stderr.trim() ? `: ${stderr.trim()}` : ""),
          }),
        );
      });
    });
  }
}

function inferLayerName(outputDirectory: string): string | undefined {
  return basename(dirname(outputDirectory)) === ".generated"
    ? basename(outputDirectory)
    : undefined;
}

function validateProvisionOptions(options: ProvisionOptions): void {
  let message: string | undefined;
  if (
    options.layer &&
    [options.stack, options.entrypoint, options.outputDirectory, options.compiler, options.artifactsDirectory]
      .some((value) => value !== undefined)
  ) {
    message = "Provisioning with a layer cannot also specify source or output options.";
  } else if (
    options.stack !== undefined &&
    [options.entrypoint, options.compiler, options.artifactsDirectory].some((value) => value !== undefined)
  ) {
    message = "Provisioning cannot combine a stack with an entrypoint, compiler, or artifactsDirectory.";
  } else if (
    options.entrypoint !== undefined &&
    (options.compiler !== undefined || options.artifactsDirectory !== undefined)
  ) {
    message = "Provisioning cannot combine an entrypoint with compiler or artifactsDirectory.";
  } else if (
    (options.compiler !== undefined) !== (options.artifactsDirectory !== undefined)
  ) {
    message = "Provisioning with a compiler requires both compiler and artifactsDirectory.";
  } else if (!options.layer?.entrypoint && !options.entrypoint && !options.compiler && options.stack === undefined) {
    message = "Provisioning requires a stack, an entrypoint, or a compiler with artifactsDirectory.";
  } else if (
    options.stack === undefined &&
    [options.parameterBindings, options.parameterVariables, options.graphResources].some((value) => value !== undefined)
  ) {
    message = "Stack settings must be supplied with a direct stack or exported by its entrypoint.";
  }
  if (message) {
    throw new IacComposerError({
      code: "PROVISION_SOURCE_INVALID",
      category: "configuration",
      message,
      property: "provision",
      expected: "Exactly one source: stack, layer, entrypoint, or compiler with artifactsDirectory.",
      repair: "Choose one provisioning source and remove conflicting options.",
    });
  }
}

function relativeAzdPath(projectDirectory: string, outputDirectory: string): string {
  const path = relative(projectDirectory, outputDirectory);
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) {
    throw new Error(
      `Provisioning output directory '${outputDirectory}' must be inside azd project '${projectDirectory}'.`,
    );
  }
  return path ? `./${path.split(sep).join("/")}` : ".";
}

function sanitizeAzdName(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return sanitized || "iac-composer";
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((part) => (/^[A-Za-z0-9_./:=@-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}
