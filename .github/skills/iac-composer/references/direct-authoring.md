# Direct TypeScript authoring

Use this workflow to implement Azure resource requirements as TypeScript with
the Azure JavaScript provisioning libraries and `iac-composer`. It works with
requirements from any planner or the user; no planner-specific contract is
needed. Use provisioning library resource references for dependencies and runtime helpers for
ordered provisioning, application configuration, readiness, and deployment.

Use the installed provisioning library declarations rather than Azure management-SDK request
shapes or guessed properties. `iac_composer_get_reference` can look up a
provisioning type or an `iac-composer` helper without executing either package.
Handwritten Bicep and resource-creation CLI scripts are not the default authored
representation; generated Bicep and azd/CLI execution remain implementation
details. Make any unsupported-resource fallback explicit. Selecting this
implementation requires both real provisioning library resource definitions and
`deployment.provision`; a wrapper around a separate Bicep/CLI lifecycle is not
equivalent.

## Bootstrap dependencies before authoring

1. Inspect the target project's manifest, lockfile, Node version and approved
   package sources. Use Node.js 22 or newer for the provisioning libraries.
   Declare `iac-composer`, `@azure/provisioning-core` and only the service
   packages actually needed; update the manifest before installing with the
   existing package manager. Preserve selected versions and the lockfile.
2. Resolve `iac-composer` through its public package export from the authored
   project. A globally installed CLI does not make ESM imports resolve locally.
   Reuse an approved built package/archive or configured registry when the
   runtime is private/unpublished. A registry 404 is a package-source blocker,
   not authorization to rewrite the deployment in raw Bicep. Never persist an
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
   compatible. If MCP advertises standalone serialization/Bicep packages while
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

## Deployment API

| API | Purpose | Dry-run behavior |
| --- | --- | --- |
| `defineDeployment(program)` | Marks the default deployment program. | The program still runs so steps can be discovered. |
| `deployment.provision(name, options)` | Compiles provisioning output, prepares an isolated azd project, runs `azd provision`, and returns string outputs. | Compiles and writes local generated artifacts; azd execution is skipped. |
| `deployment.deploy(name, action)` | Runs an application, configuration, or post-provisioning side effect. | Logs the step and skips the action. |
| `deployment.run(name, command)` | Runs a named command step. | Logs the step and skips the command. |
| `deployment.env(name, values)` | Applies process environment values in sequence. | Logs the step and skips the mutation. |
| `deployment.execute(command)` | Runs a command inside an existing action. | Logs and skips the command. |
| `deployment.capture(command)` | Captures stdout for an existing action. | Logs and returns an empty string. |
| `deployment.inDirectory(path)` | Creates a child context with the same environment, component, dry-run state, and logger. | Unchanged. |

`Command` values use `{ command, args, cwd, env }` and are spawned without a
shell. Keep each argument separate; do not build shell command strings.

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
repository's azd environment helper when outputs must survive future runs.
This example uses an existing authorized resource group. Add an
`ensureResourceGroup` action only when creating the group is explicitly in scope.

## Minimal provisioning entrypoint

Provisioning entrypoints are regular TypeScript or JavaScript modules. They
must export a non-empty `outputBicep` array. The following shape uses the Azure
JavaScript provisioning libraries:

```ts
import { renderBicepFiles } from "@azure/provisioning-core/internal";
import { fn, Stack } from "@azure/provisioning-core";
import { serialize } from "@azure/provisioning-core/serialization";
import { StorageAccount } from "@azure/provisioning-storage";

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

export const outputJson = serialize([stack]);
const [renderedStack] = renderBicepFiles([stack]);
if (renderedStack === undefined) {
  throw new Error("Provisioning produced no Bicep entry file.");
}

export const outputBicep = [
  { ...renderedStack, path: "main.bicep" },
  {
    path: "main.bicepparam",
    contents: [
      "using './main.bicep'",
      "param location = readEnvironmentVariable('AZURE_LOCATION')",
      "",
    ].join("\n"),
  },
];
```

Use the provisioning packages and versions already selected by the target
repository. Add only the resource-specific packages that the entrypoint imports.
Public npm provisioning libraries require Node.js 22 or newer. Serialization, AST
support, and Bicep rendering are bundled in core; do not install standalone
serialization or Bicep packages. The core renderer accepts authored stacks,
not the serialized JSON document. Supply deployment parameter values through
`deployment.provision({ parameters: ... })`. The entrypoint must also emit the
selected `.bicepparam` artifact, including environment-variable bindings for
its parameters: the `parameters` option supplies values but does not create that
file. Reuse an existing parameter-file helper for larger parameter sets. The
small example emits only parameter bindings as text; resource definitions
remain provisioning-library-authored and library-rendered.
Provisioning-library input names can differ from ARM property names: `enableHttpsTrafficOnly`
renders as `supportsHttpsTrafficOnly`. Inspect installed types
instead of suppressing mismatches with a broad cast.
If a provisioning library type is temporarily incomplete, keep any type escape as
narrow as possible around that provisioning library object.

## Fractional numeric values

Bicep numeric literals and some provisioning serializers support integers only.
A raw TypeScript fraction such as `cpu: 0.25` can therefore fail with
`Bicep serialization currently only supports integer numbers.` Typechecking
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

Use `containerResources` as the container's resource settings. The generated
Bicep must contain `cpu: json('0.25')`, which compiles to an ARM expression
preserving the fractional value. Inspect the selected core library's `fn.json`
declaration if needed; this is an expression, not a raw floating-point literal.

Run the local provisioning render and CLI dry run before any authorized Azure
execution. Validate the generated Bicep with `bicep build` when the compiler is
available. If rendering fails, fix the TypeScript input and regenerate; do not
patch generated Bicep, round CPU to an integer, or change the approved sizing.

## Missing service provisioning libraries are not a raw-Bicep default

Prefer the installed service-specific class. If that package/type is not
published or does not cover the required resource, inspect the public
`Resource` and `ResourceProps` declarations in the selected core provisioning library. Core
`Resource` can keep the unsupported service in the same authored Stack,
dependency/output graph, renderer and `deployment.provision` pipeline:

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
graph with CLI calls. Data-plane initialization, image builds, application
deployment and bounded post-provisioning configuration may use
`deployment.deploy`/helpers after their infrastructure outputs exist.

## Provision options

`deployment.provision` accepts:

- `layer`: an `entrypoint` and `outputDirectory` pair;
- `entrypoint`: a TypeScript or JavaScript module exporting `outputBicep`;
- `compiler` plus `artifactsDirectory`: a custom command and its generated
  Bicep artifact directory;
- `outputDirectory`: standalone output or a `.generated/<layer>` directory;
- `templateFile` and `parametersFile`: overrides for `main.bicep` and
  `main.bicepparam`;
- `deploymentName`, `subscription`, and `location`;
- `scope`: `resourceGroup` or `subscription`;
- `resourceGroup` for resource-group deployments;
- `parameters`: string, number, or boolean Bicep parameter values;
- `environmentValues`: additional azd environment values.

Do not combine `layer` with `entrypoint`, `outputDirectory`, `compiler`, or
`artifactsDirectory`. For a custom compiler, provide both `compiler` and
`artifactsDirectory`.

## Layering and component selection

Putting output directly under one shared `.generated` root creates azd
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
