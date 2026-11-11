export { createDeployment, defineDeployment, Deployment } from "./deployment.js";
export type {
  Command,
  ProvisioningLayer,
  ProvisionOptions,
  DeploymentOptions,
  DeploymentProgram,
  DeploymentAction,
  ProvisionOutputs,
} from "./deployment-types.js";
export { copyProvisioningArtifacts } from "./provisioning-artifacts.js";
export {
  createParameterVariables,
  createGraphResource,
  loopResource,
  type ParameterVariables,
  type GraphResourceHandle,
  type GraphIdentityHandle,
  type GraphResourceInput,
  type GraphResourceType,
  type ResourceLoopOptions,
  type ProvisioningSettings,
  type GraphResourceDefinition,
} from "./provisioning.js";
export { IacComposerError, type Diagnostic } from "./diagnostics.js";
export type { DeploymentEvent, StepEvent, ArtifactEvent, ExecutionReport } from "./report.js";
export { describe as describeRuntimeCapabilities, type DiscoveryTopic } from "./discovery.js";
export {
  getIacComposerContext,
  implementationTopics,
  type ImplementationTopic,
} from "./authoring-context.js";
export { getTypeScriptReference, type TypeScriptReference } from "./sdk-reference.js";
export {
  createWorkspacePaths,
  containsPath,
  workspaceError,
  type WorkspacePaths,
} from "./workspace.js";
export {
  AzdProject,
  createAzdProject,
  iacComposerAzdTemplate,
  getAzdProject,
  parseAzdEnvironment,
  type AzdDeployOptions,
  type AzdEnvironmentValues,
  type AzdProjectOptions,
} from "./azd.js";
export {
  authorizationError,
  buildContainerImage,
  captureAzure,
  captureAzureJson,
  createAppServiceContainerManifest,
  deployAppServiceContainer,
  ensureAppServiceClientAuthorization,
  ensureAppServiceContainerPullIdentity,
  ensureAppServiceIngress,
  ensureAppServicePrivateEndpoint,
  ensureAppServicePeerIngress,
  prepareAppServiceContainer,
  ensureResourceGroup,
  ensureRoleAssignment,
  resolveAzureAccountContext,
  resolveAzureSubscriptionContext,
  retry,
  runAzure,
  waitForAppServiceReady,
  waitForHttp,
  type AppServiceClientAuthorizationOptions,
  type AppServiceContainerOptions,
  type AppServiceIngressOptions,
  type AppServicePrivateEndpointOptions,
  type AppServicePeerIngressOptions,
  type AppServiceReadyOptions,
  type AzureAccountContext,
  type AzureAccountContextOptions,
  type AzureRoleAssignmentOptions,
  type AzureResourceGroupOptions,
  type AzureSubscriptionContext,
  type AzureSubscriptionContextOptions,
  type ContainerImageOptions,
} from "./azure.js";
export {
  optionalEnv,
  persistEnvironmentFile,
  readEnvironmentFile,
  requiredEnv,
  stringEnvironment,
  type EnvironmentValues,
} from "./environment.js";
