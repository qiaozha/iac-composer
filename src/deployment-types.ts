import type { Stack } from "@azure/provisioning-core";
import type { Deployment } from "./deployment.js";
import type { ProvisioningSettings } from "./provisioning.js";
import type { DeploymentEvent } from "./report.js";

export interface Command {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProvisioningLayer {
  readonly entrypoint: string;
  readonly outputDirectory: string;
}

export interface ProvisionOptions extends ProvisioningSettings {
  stack?: Stack;
  layer?: ProvisioningLayer;
  entrypoint?: string;
  compiler?: Command;
  artifactsDirectory?: string;
  outputDirectory?: string;
  templateFile?: string;
  parametersFile?: string;
  deploymentName?: string;
  subscription?: string;
  location?: string;
  parameters?: Readonly<Record<string, string | number | boolean>>;
  scope?: "subscription" | "resourceGroup";
  resourceGroup?: string;
  environmentValues?: Readonly<Record<string, string | undefined>>;
}

export interface DeploymentOptions {
  projectDirectory?: string;
  environment?: string;
  component?: string;
  dryRun?: boolean;
  log?: (message: string) => void;
  onEvent?: (event: DeploymentEvent) => void;
}

export type DeploymentProgram = (deployment: Deployment) => Promise<void>;

export type DeploymentAction = Command | (() => void | Promise<void>);

export type ProvisionOutputs = Record<string, string>;
