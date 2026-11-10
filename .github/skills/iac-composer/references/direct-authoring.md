# Direct TypeScript authoring

Use this workflow to implement Azure resource requirements as TypeScript with
the Azure JavaScript provisioning libraries and `iac-composer`. It works with
requirements from any planner or the user; no planner-specific contract is
needed. Use provisioning library resource references for dependencies and runtime helpers for
ordered provisioning, application configuration, readiness, and deployment.

Use the installed provisioning library declarations rather than Azure management-SDK request
shapes or guessed properties. `iac_composer_get_reference` can look up a
provisioning type or an `iac-composer` helper without executing either package.
Use iac-composer's APIs for provisioning and deployment; do not introduce a
separate deployment toolchain or load backend deployment skills. Runtime-generated
files are implementation artifacts, not a change of authoring method.
Make any unsupported-resource fallback explicit. Selecting this
implementation requires both real provisioning library resource definitions and
`deployment.provision`; a wrapper around an unrelated provisioning script is not
equivalent.

Maintain one canonical working implementation. Fix its authored source in place,
regenerate the current outputs through iac-composer, and rerun validation until
it works. Do not create attempt archives or duplicate source trees unless the
user explicitly requests them. Use existing version control for recovery while
preserving unrelated user changes.

## Bootstrap dependencies before authoring

1. Inspect the target project's manifest, lockfile, Node version and approved
   package sources. Use Node.js 22 or newer for the provisioning libraries.
   Declare `iac-composer`, `@azure/provisioning-core` and only the service
   packages actually needed and publicly released according to the
   [release status](#npmjs-release-status); use core `Resource` for unpublished
   services. Update the manifest before installing with the
   existing package manager. Preserve selected versions and the lockfile.
2. Resolve `iac-composer` through its public package export from the authored
   project. A globally installed CLI does not make ESM imports resolve locally.
   Reuse an approved built package/archive or configured registry when the
   runtime is private/unpublished. A runtime registry 404 is a package-source blocker,
   not authorization to replace the selected provisioning API. Never persist an
   absolute host path such as `/opt/.../iac-composer/dist/index.js`.
3. Inventory the actual project, then request only the declarations needed:

   ```json
   {"topic":"sdk","projectDirectory":"."}
   {"packageName":"@azure/provisioning-storage","symbol":"StorageAccount","projectDirectory":"."}
   {"packageName":"@azure/provisioning-core","symbol":"Resource","projectDirectory":"."}
   {"packageName":"iac-composer","symbol":"ProvisionOptions","projectDirectory":"."}
   ```

   The first request is for `iac_composer_get_context`; the others are for
   `iac_composer_get_reference`. `projectDirectory` selects the Node project
   inside the registered workspace, such as `.` or `deployment`, not a global
   tooling directory outside it. Omit it for non-inventory context topics such as
   `start` and `authoring`. Empty inventory or `SDK_PACKAGE_UNAVAILABLE` means
   establish the project dependencies and retry, not that a resource is
   unsupported. Do not guess service-package spellings from ARM type names.
4. Keep skill/reference assets, the executing CLI/MCP package and provisioning library imports
   compatible. If MCP advertises legacy standalone compilation packages while
   the selected core provisioning library/reference bundles them, repair the mismatched runtime
   or package selection first. Do not mix the two API generations, install
   obsolete packages to follow stale metadata, or bypass workspace boundaries.
   If the approved matching package is unavailable, report the exact blocker.

Expose the real local program through the canonical project command:

```json
{
  "scripts": {
    "deploy": "iac-composer ./deployment/deploy.ts",
    "preview": "npm run deploy -- --dry-run"
  }
}
```

The script alone is not proof of provisioning library resource authoring. Check its provisioning
entrypoints, imports, generated artifacts and `deployment.provision` steps.

## npmjs release status

Checked **2026-11-10** directly against the
[public npm registry](https://registry.npmjs.org/). This is a dated snapshot of
the packages checked below, not an exhaustive service-support matrix. Public
beta releases count as released; they are not GA releases.

### Published packages

Use the service-specific constructs from these exact package names when they
cover the required resource. The verified service versions below all depend on
`@azure/provisioning-core` **1.0.0-beta.2** and require **Node.js >=22.0.0**.
Preserve an existing compatible project selection rather than upgrading it
implicitly.

| Library/service | Public npm package | Verified release |
| --- | --- | --- |
| Core resources, expressions, compilation | [@azure/provisioning-core](https://www.npmjs.com/package/@azure/provisioning-core) | `1.0.0-beta.2` |
| Application Insights | [@azure/provisioning-appinsights](https://www.npmjs.com/package/@azure/provisioning-appinsights) | `1.0.0-beta.1` |
| Container Registry | [@azure/provisioning-containerregistry](https://www.npmjs.com/package/@azure/provisioning-containerregistry) | `1.0.0-beta.1` |
| Cognitive Services / Foundry accounts and projects | [@azure/provisioning-cognitiveservices](https://www.npmjs.com/package/@azure/provisioning-cognitiveservices) | `1.0.0-beta.1` |
| Cosmos DB | [@azure/provisioning-cosmosdb](https://www.npmjs.com/package/@azure/provisioning-cosmosdb) | `1.0.0-beta.1` |
| Event Hubs | [@azure/provisioning-eventhub](https://www.npmjs.com/package/@azure/provisioning-eventhub) | `1.0.0-beta.1` |
| Key Vault | [@azure/provisioning-keyvault](https://www.npmjs.com/package/@azure/provisioning-keyvault) | `1.0.0-beta.2` |
| Log Analytics | [@azure/provisioning-operationalinsights](https://www.npmjs.com/package/@azure/provisioning-operationalinsights) | `1.0.0-beta.1` |
| AI Search | [@azure/provisioning-search](https://www.npmjs.com/package/@azure/provisioning-search) | `1.0.0-beta.1` |
| Service Bus | [@azure/provisioning-servicebus](https://www.npmjs.com/package/@azure/provisioning-servicebus) | `1.0.0-beta.1` |
| SQL | [@azure/provisioning-sql](https://www.npmjs.com/package/@azure/provisioning-sql) | `1.0.0-beta.1` |
| Storage | [@azure/provisioning-storage](https://www.npmjs.com/package/@azure/provisioning-storage) | `1.0.0-beta.1` |

Do not use the old `applicationinsights` or `container-registry` package suffixes;
the public names are `appinsights` and `containerregistry`. Event Hubs uses the
singular `eventhub`, not `eventhubs`. Do not blindly select `latest`: core's
`latest` tag currently points to an alpha, and Key Vault's `latest` tag points
to beta.1 even though beta.2 is available. Verify dependency compatibility and
pin an approved version.

### Not yet published: use core Resource

The following package names returned **404** from the public npm registry on
the checked date. For these services, use `Resource` from
`@azure/provisioning-core` with the verified ARM type, API version, properties,
scope, dependencies, and outputs, following the
[core fallback scenario](#core-resource-fallback-for-unpublished-services).

| Service | Unpublished package checked | Example core Resource type |
| --- | --- | --- |
| App Configuration | `@azure/provisioning-appconfiguration` | `Microsoft.AppConfiguration/configurationStores` |
| App Service / Functions | `@azure/provisioning-appservice` | `Microsoft.Web/sites` |
| Authorization / RBAC | `@azure/provisioning-authorization` | `Microsoft.Authorization/roleAssignments` |
| Bot Service | `@azure/provisioning-botservice` | `Microsoft.BotService/botServices` |
| Compute | `@azure/provisioning-compute` | `Microsoft.Compute/virtualMachines` |
| Container Apps | `@azure/provisioning-appcontainers`, `@azure/provisioning-containerapps` | `Microsoft.App/containerApps` |
| AKS | `@azure/provisioning-containerservice` | `Microsoft.ContainerService/managedClusters` |
| Logic Apps | `@azure/provisioning-logic` | `Microsoft.Logic/workflows` |
| Managed Identity | `@azure/provisioning-managed-identity`, `@azure/provisioning-managedidentity` | `Microsoft.ManagedIdentity/userAssignedIdentities` |
| Monitor alerts / diagnostic settings | `@azure/provisioning-monitor` | `Microsoft.Insights/metricAlerts` |
| Networking | `@azure/provisioning-network` | `Microsoft.Network/virtualNetworks` |

Application Insights and Log Analytics are published separately; the missing
Monitor package does not make their published libraries unavailable.
The old standalone serialization packages are **replaced by core**, not missing
capabilities. Use the selected core library and iac-composer integration instead
of introducing additional compilation or deployment packages.

### Refreshing the status

Before a new dependency selection, verify the canonical package name and
inspect the public registry metadata without installing it:

```bash
npm view @azure/provisioning-core dist-tags --json --registry=https://registry.npmjs.org
npm view @azure/provisioning-storage@1.0.0-beta.1 version dependencies engines --json --registry=https://registry.npmjs.org
```

For a service absent from the table or a stale snapshot, check its canonical
package name in the official Azure provisioning library documentation and query
that name on npmjs. A confirmed public-registry 404 for the canonical service
package selects the core fallback; a local missing dependency, authentication
failure, registry override, timeout, or network error does not establish
unpublished status. Report access errors explicitly. If a service package is
newly published, inspect its declarations and compatibility before selecting it.

## Recommended layout

```text
deployment/
  deploy.ts
  components/
    shared/
      index.ts
      provisioning.ts
    api/
      index.ts
      provisioning.ts
  environments/
    dev.json
  runtime/
    environment.ts
    paths.ts
  package.json
  tsconfig.json
```

Small deployments may use only `deployment.ts` and `infra.ts`. Introduce
components when ownership or lifecycle order benefits from the separation.

## Service modules and ordered provisioning

Choose boundaries by ownership, outputs and lifecycle prerequisites, not one
layer per Azure resource or one giant layer containing every service. A shared
layer can own network and identity. A storage module can provision its account,
container and scoped RBAC, then initialize the archive. A Search module can
provision the service and scoped RBAC, then create its index and load documents.
A hosting module can consume those outputs, provision its host and deploy the
application. Keep provisioning separate where an intervening operation is
required, such as building an image before a host consumes its digest.

Keep these boundaries distinct:

| Boundary | Authoring and runtime behavior |
| --- | --- |
| TypeScript service module | Exports an awaited lifecycle function that receives the same `Deployment` context and returns outputs. Importing it alone does not run or split infrastructure. |
| Provisioning layer | One `deploy.provision` boundary using `.generated/<layer>` under a shared root. First appearance in the awaited lifecycle establishes its dependency on the preceding layer; reusing a layer retains that position. |

The runtime does not infer a service graph from TypeScript imports, split a
monolithic stack, or execute application actions during infrastructure
compilation. `defineDeployment` is the composition root; `deploy.provision`
owns compilation and provisioning of the authored layers, and `deploy.deploy`
guards the intervening application/data operations.
Do not wrap `deploy.provision` in `deploy.deploy`, because a dry run skips
deploy callbacks entirely.

For example, the root `deployment/deploy.ts` composes service modules:

```ts
import { defineDeployment, requiredEnv } from "iac-composer";
import { shared } from "./services/shared/index.js";
import { storage } from "./services/storage/index.js";
import { api } from "./services/api/index.js";

export default defineDeployment(async (deploy) => {
  const target = {
    scope: "resourceGroup" as const,
    resourceGroup: requiredEnv("AZURE_RESOURCE_GROUP"),
    subscription: requiredEnv("AZURE_SUBSCRIPTION_ID"),
    location: requiredEnv("AZURE_LOCATION"),
  };
  const sharedOutputs = await shared(deploy, target);
  const storageOutputs = await storage(deploy, target, sharedOutputs);
  await api(deploy, target, { ...sharedOutputs, ...storageOutputs });
});
```

The storage service's `deployment/services/storage/index.ts` owns its layer and
initialization. `uploadBootstrapBlob` is the guarded helper shown below; the
payload is supplied by the approved application inputs.

```ts
import { fileURLToPath } from "node:url";
import type { Deployment, ProvisionOptions, ProvisionOutputs } from "iac-composer";
import { uploadBootstrapBlob } from "../../bootstrap.js";

export async function storage(
  deploy: Deployment,
  target: Pick<ProvisionOptions, "scope" | "resourceGroup" | "subscription" | "location">,
  sharedOutputs: ProvisionOutputs,
): Promise<ProvisionOutputs> {
  await deploy.deploy("validate storage prerequisites", () => {
    if (!sharedOutputs.SUBNET_ID) throw new Error("Shared layer did not return SUBNET_ID.");
  });
  const outputs = await deploy.provision("storage infrastructure", {
    ...target,
    layer: {
      entrypoint: fileURLToPath(new URL("./provisioning.ts", import.meta.url)),
      outputDirectory: fileURLToPath(new URL("../../.generated/storage", import.meta.url)),
    },
    parameters: { subnetId: sharedOutputs.SUBNET_ID ?? "" },
  });
  await uploadBootstrapBlob(deploy, outputs, "inputs", "bootstrap.bin", new Uint8Array([1, 2, 3]));
  return outputs;
}
```

The `shared` and `api` modules use the same pattern with their own entrypoints
and `../../.generated/shared` / `../../.generated/api` directories. All three
resolve to one absolute `deployment/.generated` root. A module may use
`deploy.inDirectory(absoluteServiceDirectory)` for local commands; child
contexts share layer-order tracking and step events. Separate
`createDeployment()` instances do not share that lifecycle state.

The empty parameter placeholder above is only for compilation during dry runs,
where provisioning returns no live outputs; the guarded prerequisite check
rejects it during a real run. Do not turn missing live outputs into success.
Define `subnetId` with `stack.parameters.add` in a `defineProvisioning` entrypoint;
the runtime generates its binding and the API supplies earlier outputs. Avoid reading outputs,
credentials or service data at provisioning-module import time: imports can be
cached and compile/preview must remain free of live side effects.

Let iac-composer manage compilation, artifact layout, and provisioning. Reuse
the project's runtime-compatible layer entrypoints; do not flatten generated
directories or rename runtime-managed files. Provisioning a later layer must
preserve earlier layers' generated files, manifests, and environment state.

Use official JavaScript data-plane SDKs for blob bytes, Search indexes/documents,
model inference and service data verification, inside awaited deploy callbacks.
Keep ARM resources, networking, identities and role assignments in provisioning
entrypoints. Client/credential construction and service reads belong inside the
callback too, after returned endpoints and scoped RBAC are available. See the
[data-plane SDK section](#data-plane-operations-with-javascript-sdks) for package,
authentication, retry and idempotency guidance.

Validate the exact lifecycle, not just generated-file existence: a dry run
must compile every selected layer while skipping SDK/client and application
actions; an offline execution with stubbed cloud commands must interleave
provisioning, initialization and application deployment in the authored order.
A failed producer or initialization must stop dependent modules. For independent
components, parallelism is a deliberate author decision, not inferred from
imports; do not parallelize calls that share layer/manifests or depend on outputs.

## Deployment API

| API | Purpose | Dry-run behavior |
| --- | --- | --- |
| `defineDeployment(program)` | Marks the default deployment program. | The program still runs so steps can be discovered. |
| `defineProvisioning({ stack, ... })` | Declares a resource entrypoint loaded by `deployment.provision`, not a CLI deployment program. | The runtime compiles its resources without provisioning them. |
| `deployment.provision(name, options)` | Compiles and provisions the selected infrastructure layer and returns string outputs. | Compiles and writes local artifacts; cloud provisioning is skipped. |
| `deployment.deploy(name, action)` | Runs an application, configuration, or post-provisioning side effect. | Logs the step and skips the action. |
| `deployment.run(name, command)` | Runs a named command step. | Logs the step and skips the command. |
| `deployment.env(name, values)` | Applies process environment values in sequence. | Logs the step and skips the mutation. |
| `deployment.execute(command)` | Runs a command inside an existing action. | Logs and skips the command. |
| `deployment.capture(command)` | Captures stdout for an existing action. | Logs and returns an empty string. |
| `deployment.inDirectory(path)` | Creates a child context with the same environment, component, dry-run state, and logger. | Unchanged. |

`Command` values use `{ command, args, cwd, env }` and are spawned without a
shell. Keep each argument separate; do not build shell command strings.

The CLI deployment program must default-export
`defineDeployment(async (deployment) => { ... })`. Its resource entrypoints
default-export `defineProvisioning({ stack })` and are loaded through
`deployment.provision`, not passed directly to the CLI.
`defineProvisioning` does not replace the deployment program's default export.
Service modules export named lifecycle functions that the program awaits.

## Minimal deployment program

```ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineDeployment,
  requiredEnv,
  type ProvisioningLayer,
} from "iac-composer";

const deploymentRoot = dirname(fileURLToPath(import.meta.url));
const coreLayer: ProvisioningLayer = {
  entrypoint: resolve(deploymentRoot, "infra.ts"),
  outputDirectory: resolve(deploymentRoot, ".generated/core"),
};

export default defineDeployment(async (deployment) => {
  const outputs = await deployment.provision("core infrastructure", {
    layer: coreLayer,
    deploymentName: `${deployment.environment ?? "dev"}-core`,
    scope: "resourceGroup",
    resourceGroup: requiredEnv("AZURE_RESOURCE_GROUP"),
    subscription: requiredEnv("AZURE_SUBSCRIPTION_ID"),
    location: requiredEnv("AZURE_LOCATION"),
    parameters: { location: requiredEnv("AZURE_LOCATION") },
  });

  await deployment.env("publish infrastructure outputs", outputs);
});
```

Use `deployment.env` for values needed later in the same run. Use the
repository's environment helper when outputs must survive future runs.
This example uses an existing authorized resource group. Add an
`ensureResourceGroup` action only when creating the group is explicitly in scope.

## Provisioning resource definitions

Define resources with the Azure JavaScript provisioning libraries and
default-export `defineProvisioning({ stack })` from the layer entrypoint.
`deployment.provision` handles compilation and parameter binding internally.
Inspect the installed `ProvisioningSource`, `ProvisioningLayer`, and
`ProvisionOptions` declarations when wiring a new layer.

```ts
import { fn, Stack } from "@azure/provisioning-core";
import { StorageAccount } from "@azure/provisioning-storage";
import { defineProvisioning } from "iac-composer";

const stack = new Stack("main", { targetScope: "resourceGroup" });
const location = stack.parameters.add("location", "string");
const suffix = stack.variables.add(
  "suffix",
  fn.substring(fn.uniqueString(fn.resourceGroup().id), 0, 6),
);

const storage = new StorageAccount(stack, {
  name: fn.concat("appstorage", suffix),
  location,
  kind: "StorageV2",
  sku: { name: "Standard_LRS" },
  properties: {
    minimumTlsVersion: "TLS1_2",
    allowBlobPublicAccess: false,
    allowSharedKeyAccess: false,
    enableHttpsTrafficOnly: true,
  },
});

stack.outputs.add("STORAGE_ACCOUNT_NAME", "string", storage.name);

export default defineProvisioning({ stack });
```

Use the provisioning packages and versions already selected by the target
repository. Add only the resource-specific packages that the entrypoint imports.
Public npm provisioning libraries require Node.js 22 or newer. Compilation
support is managed by iac-composer; do not introduce legacy standalone packages.
Supply deployment values through `deployment.provision({ parameters: ... })`.
Required stack parameters receive runtime-managed environment bindings; optional
parameters retain their stack defaults unless overridden.

For environment mappings or computed values, use `createParameterVariables`
to declare values and obtain handles for their actual names and inferred shapes.
The runtime registers their definitions automatically:

```ts
import { createParameterVariables, defineProvisioning } from "iac-composer";

const { environment, settings } = createParameterVariables(stack, {
  environment: "dev",
  settings: { replicas: 1 },
});
export default defineProvisioning({
  stack,
  parameters: {
    environmentName: environment,
    replicas: settings.replicas,
  },
});
```

Here `stack` declares `environmentName` and `replicas` as provisioning parameters.
The handles are deferred expressions, not live service data or local values.
Use them only in parameter bindings and other parameter-variable declarations,
not resource-template properties. Unknown variable names and nested fields are
TypeScript errors. Do not reconstruct their symbolic paths from strings.

Use `createGraphResource(stack, definition)` for Graph applications, service
principals, and app-role assignments. It registers the resource automatically
and returns its supported output handles:

```ts
import { createGraphResource } from "iac-composer";

const application = createGraphResource(stack, {
  identifier: "application",
  type: "Microsoft.Graph/applications",
  body: { uniqueName: "application", displayName: "Application" },
});
const principal = createGraphResource(stack, {
  identifier: "principal",
  type: "Microsoft.Graph/servicePrincipals",
  body: { appId: application.appId },
  dependsOn: [application],
});
stack.outputs.add("PRINCIPAL_ID", "string", principal.id);
```

Identity resources expose `.id` and `.appId`; role-assignment handles expose
`.id`. Pass dependency handles through `dependsOn`, not raw identifier paths.
Dependencies must belong to the same stack, and registered names must be
unique. Additional Graph resource kinds can still use explicit `graphResources`
definitions when no typed helper exists.

For sequential resource updates, pass the collection and a factory to
`loopResource`. The callback receives an item expression whose fields are inferred
from the collection:

```ts
import { loopResource } from "iac-composer";

const updates = loopResource(stack, modelConfigurations, {
  itemVariable: "model",
  batchSize: 1,
  create: (model) => new Deployment(account, {
    name: model.name,
    properties: model.properties,
    sku: model.sku,
  }),
});
```

This example uses the model collection and provisioning-library deployment class
from the resource module. The result is a dependency handle for the entire loop,
not a scalar resource with an `.id`; use it in later resources' dependencies.
Keep item expressions inside their callback's resource definition.

Existing `parameterVariables` and `graphResources` maps remain supported, but do
not declare the same name through both a helper and a raw map. The runtime
preserves these definitions and the complete layer layout; application code does
not implement compilation adapters or symbolic-reference helpers.
Provisioning-library input names can differ from ARM property names: `enableHttpsTrafficOnly`
renders as `supportsHttpsTrafficOnly`. Inspect installed types
instead of suppressing mismatches with a broad cast.
If a provisioning library type is temporarily incomplete, keep any type escape as
narrow as possible around that provisioning library object.

## Fractional numeric values

Some provisioning serializers support integer literals only. A raw TypeScript
fraction such as `cpu: 0.25` can therefore fail during compilation. Typechecking
alone does not catch this serialization error.

Use the public `fn.json` expression from `@azure/provisioning-core` with a JSON
**string**, not a numeric argument:

```ts
import { fn } from "@azure/provisioning-core";

const containerResources = {
  cpu: fn.json("0.25"),
  memory: "0.5Gi",
};
```

Use `containerResources` as the container's resource settings. This expression
preserves the fractional value. Inspect the selected core library's `fn.json`
declaration if needed; this is an expression, not a raw floating-point literal.

Run the project's iac-composer dry run before any authorized Azure execution.
If compilation fails, fix the TypeScript input and rerun through iac-composer;
do not patch generated artifacts, round CPU to an integer, or change the
approved sizing.

## Core Resource fallback for unpublished services

Prefer the installed service-specific class. If that package/type is not
published (see the [release status](#npmjs-release-status)), use the core fallback
below rather than omitting the resource or changing the implementation method.
If a published package does not cover the required resource, use the same
fallback. Inspect the public
`Resource` and `ResourceProps` declarations in the selected core provisioning library. Core
`Resource` can keep the unsupported service in the same authored Stack,
dependency/output graph and `deployment.provision` pipeline:

```ts
import { Resource } from "@azure/provisioning-core";

const network = new Resource(stack, {
  type: "Microsoft.Network/virtualNetworks",
  apiVersion: "2024-05-01",
  name: "application-network",
  location,
  properties: {
    addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
  },
});
stack.outputs.add("NETWORK_ID", "string", network.id);
```

Here `stack` and `location` come from the provisioning entrypoint above. Verify
the requested ARM type, API version and control shapes against authoritative
provider documentation; generic `Resource` is not a service-specific schema
validator. Document why the typed service class could not be used. This is
still provisioning-library authoring, not a handwritten template fallback.

Only a demonstrated provisioning library/renderer limitation justifies a narrower external
fallback, subject to the user's implementation constraints. Identify the
installed package/version and missing capability, keep supported resources in
TypeScript, and surface conflicts rather than replacing the entire resource
graph with CLI calls. Data-plane initialization should use the
[JavaScript data-plane SDKs](#data-plane-operations-with-javascript-sdks) inside
`deployment.deploy` after its infrastructure outputs exist. Image builds,
application deployment, and bounded post-provisioning configuration also belong
in guarded actions/helpers.

## Data-plane operations with JavaScript SDKs

Use provisioning libraries (or core `Resource`) for ARM resources and their
configuration, identities, networking, and role assignments. Use official Azure
JavaScript data-plane SDKs for operations against the service endpoint, such as
uploading blobs, indexing documents, reading secrets, or sending messages.
Prefer these typed clients over handwritten REST calls, `fetch`, `curl`, or CLI
data commands when a supported client covers the operation. Do not use
management SDKs or data-plane clients to replace infrastructure provisioning.

Provisioning package publication and data-plane client availability are separate:
for example, an unpublished App Configuration provisioning package still uses
core `Resource` for the store and can use `@azure/app-configuration` for required
data-plane operations. Keep settings already owned by an ARM provisioning
definition there; do not manage the same setting through both planes.

| Data-plane operation | JavaScript client package | Typical client |
| --- | --- | --- |
| Upload/download blobs | `@azure/storage-blob` | `BlobServiceClient` |
| Create indexes or index/query documents | `@azure/search-documents` | `SearchIndexClient`, `SearchClient` |
| Read/write Cosmos DB items | `@azure/cosmos` | `CosmosClient` |
| Read/write Key Vault secret values | `@azure/keyvault-secrets` | `SecretClient` |
| Read/write App Configuration values | `@azure/app-configuration` | `AppConfigurationClient` |
| Send/receive Service Bus messages | `@azure/service-bus` | `ServiceBusClient` |
| Publish/consume Event Hubs events | `@azure/event-hubs` | `EventHubProducerClient`, `EventHubConsumerClient` |

These are client libraries, not extra provisioning packages. Declare only the
needed packages and `@azure/identity` in the authored project's manifest, select
compatible approved versions, and install with its existing package manager.
Inspect installed declarations and official
[Azure JavaScript client documentation](https://learn.microsoft.com/azure/developer/javascript/sdk/overview).
`iac_composer_get_reference` supports provisioning libraries and `iac-composer`,
not arbitrary data-plane SDKs; inspect the latter directly in the project.
If the selected client version lacks an operation, document the exact gap
before a bounded HTTP/CLI fallback; do not guess an API or hide access failures.

### Authentication, order, and safety

- Provision the target resources and required data-plane roles first, then use
  their returned endpoints. ARM Contributor/Owner access alone does not grant
  service data access. Account for private networking and bounded RBAC
  propagation retries; never weaken access controls to make a client call work.
- Prefer Microsoft Entra authentication through `@azure/identity`, using
  `DefaultAzureCredential` or the repository's explicit managed/workload identity
  credential. Reuse existing credential helpers. For local Azure CLI
  authentication use browser-based `az login`, not device-code login. Never
  request passwords/tokens in chat or fall back silently to account keys.
- Put credential/client construction, token acquisition, service reads, writes,
  polling, and cleanup inside awaited `deployment.deploy` callbacks. No
  data-plane work belongs at module top level, in provisioning entrypoints, or
  outside the dry-run guard. Close clients that require it in `finally`.
- Use deterministic object names, upserts or conditional writes only where the
  requested behavior permits them. Preserve data on reruns; do not implicitly
  overwrite/delete existing content or send duplicate messages.
- Await every operation, inspect per-item/batch failures, and propagate errors.
  Retry only documented transient conditions with bounded retries; do not catch
  all failures, return fabricated success, or log secret values or SDK responses
  containing sensitive data. Do not persist secrets as deployment outputs.

### Guarded Blob upload example

This helper assumes the storage layer exports `STORAGE_BLOB_ENDPOINT` and the
container already exists. Call it after that layer's `deployment.provision`
and data-plane access preparation, passing the returned outputs and approved
payload. The
[Blob client API](https://learn.microsoft.com/javascript/api/@azure/storage-blob/blockblobclient#@azure-storage-blob-blockblobclient-uploaddata)
uses `uploadData`; this example intentionally replaces the named blob. Use a
conditional write instead when overwriting is not authorized.

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import type { Deployment } from "iac-composer";

export async function uploadBootstrapBlob(
  deployment: Deployment,
  outputs: Readonly<Record<string, string>>,
  containerName: string,
  blobName: string,
  contents: Uint8Array,
): Promise<void> {
  await deployment.deploy("upload bootstrap blob", async () => {
    const endpoint = outputs.STORAGE_BLOB_ENDPOINT?.trim();
    if (!endpoint) {
      throw new Error("Storage provisioning did not return STORAGE_BLOB_ENDPOINT.");
    }
    const credential = new DefaultAzureCredential();
    const client = new BlobServiceClient(endpoint, credential);
    await client
      .getContainerClient(containerName)
      .getBlockBlobClient(blobName)
      .uploadData(contents);
  });
}
```

In tests, stub the clients and verify that dry runs construct no credentials or
clients and make no service calls. Validate sequencing and error propagation
without contacting Azure; perform real data operations only when authorized.

## Provision options

`deployment.provision` accepts:

- `layer`: an `entrypoint` and `outputDirectory` pair;
- `entrypoint`: a module default-exporting `defineProvisioning({ stack, ... })`;
- `outputDirectory`: standalone output or a `.generated/<layer>` directory;
- `deploymentName`, `subscription`, and `location`;
- `scope`: `resourceGroup` or `subscription`;
- `resourceGroup` for resource-group deployments;
- `parameters`: string, number, or boolean provisioning parameter values;
- `environmentValues`: additional deployment environment values.

Use one source configuration: do not combine `layer` with separate
`entrypoint` or `outputDirectory` options. For advanced project integrations,
inspect the installed `ProvisionOptions` declaration and reuse existing helpers.

## Layering and component selection

Putting output directly under one shared `.generated` root creates ordered
infrastructure layers. The first appearance of each layer establishes its
dependency on the preceding layer, so call provisioning steps in business
order.

For selectable components:

```ts
import { defineDeployment, type Deployment } from "iac-composer";

const components: Record<
  string,
  (deployment: Deployment) => Promise<void>
> = {
  shared,
  api,
  frontend,
};

export default defineDeployment(async (deployment) => {
  await prepareEnvironment(deployment);
  if (deployment.component) {
    const run = Object.hasOwn(components, deployment.component)
      ? components[deployment.component]
      : undefined;
    if (!run) {
      throw new Error(
        `Unknown component '${deployment.component}'. Expected one of: ${Object.keys(components).join(", ")}.`,
      );
    }
    await run(deployment);
    return;
  }
  await shared(deployment);
  await api(deployment);
  await frontend(deployment);
});
```

## Commands

Prefer an existing package script. Equivalent local CLI commands are:

```bash
iac-composer ./deployment.ts --environment dev --dry-run
iac-composer ./deployment.ts --environment dev
iac-composer ./deployment.ts --environment dev --component api
```

For generated layered projects, cleanup is intentionally guarded:

```bash
iac-composer down ./.generated --environment dev --force
```

Only add `--purge` after the user explicitly confirms permanent deletion.
