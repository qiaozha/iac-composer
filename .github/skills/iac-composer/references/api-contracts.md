# API contract preflight

Read only the section needed for the selected services or a concrete error.
Batch independent local checks before editing or provisioning; save concise
capability/version results rather than repeatedly dumping declarations or logs.
These checks do not authorize cloud changes.

## Installed runtime and deployment contract

Resolve the project-local `iac-composer` public export and inspect its installed
declarations once. Keep the runtime and skill/reference versions compatible.
The current resource entrypoint default-exports a `Stack`; the CLI deployment
program default-exports `defineDeployment(...)`. Do not mix this contract with
an older archived runtime exposing `defineProvisioning`. Reuse the matching
approved runtime/assets or report the incompatibility, not a guessed wrapper.

Follow the [customer workflow](./direct-authoring.md#customer-workflow-define-provision-deploy):

1. Define Azure resources, dependencies, and outputs in a provisioning-library
   `Stack`. Pass the stack directly or default-export it from a resource entrypoint.
2. Default-export a `defineDeployment` program. The CLI creates its `Deployment`
   context and invokes the program; the definition itself does not execute it.
3. Await `deployment.provision` with the stack or entrypoint, target scope, and
   parameter values. It owns compilation, generated artifacts, resource
   provisioning, and returned outputs.
4. Put application publishing and service data operations in awaited
   `deployment.deploy` actions after their resource, RBAC, and network prerequisites.
   For Storage, account/container creation and role grants are infrastructure;
   uploading blob contents is a data-plane deployment action.

Use the project's local deployment script, configured as in the
[dependency bootstrap](./direct-authoring.md#bootstrap-dependencies-before-authoring):

```bash
npm run deploy -- --environment dev --dry-run --report preview.json
npm run deploy -- --environment dev
```

The second command requires explicit authorization for Azure and application
side effects. A dry run executes authored modules and writes local artifacts,
but skips Azure provisioning and guarded application/data-plane actions. It is
not an Azure permission check or a deployment guarantee.

Compilation is internal to provisioning, not a standalone customer operation.
Use the same program for preview and execution; do not invoke a separate compiler
or patch generated files. Read artifact paths and step status from the preview
report instead of guessing compiler output names.

`ProvisionOutputs` is a string map, not a resource-ID type. A transport may return
environment values such as `AZURE_SUBSCRIPTION_ID` alongside authored outputs.
Consume an explicit list of required output keys and validate their shape and
authorized scope. An `_ID` suffix does not make a subscription GUID an ARM
resource ID. For declared service-resource outputs in a resource-group
deployment, require that group's expected scope followed by `/providers/`.
Validate group/subscription scope outputs against their own declared ID schema,
and service endpoints separately as HTTPS URLs. Never construct a management
URL by concatenating an unvalidated output value.

## Provisioning inputs versus ARM payloads

Use installed service-package declarations, not management-SDK request shapes.
For the beta service releases in the direct-authoring release snapshot:

| Surface | Authoring/client input | Rendered ARM or provider-operation shape |
| --- | --- | --- |
| Storage account rules | `properties.networkRuleSet` | `properties.networkAcls` |
| Storage IP rule | `iPAddressOrRange`, `action` | `value`, `action` |
| Storage VNet rule | `virtualNetworkResourceId`, `action` | `id`, `action` |
| Search IP rule | `networkRuleSet.ipRules: [{ value: "203.0.113.1/32" }]` | `ipRules` is an object array, not strings |
| Search key auth disabled | `disableLocalAuth: true`, omit `authOptions` | Do not combine with `aadOrApiKey` |

Documentation-only IPs above are not deployable allowlist evidence. Check each
service's IPv4/CIDR restrictions before supplying actually observed addresses.
Deferred `fn.json(...)` payloads are evaluated by ARM, so inner object keys must
already be ARM-shaped; they do not receive provisioning-property renaming.
Prefer typed inputs, and keep any necessary expression annotation narrow.

An expression is not a JavaScript object key: `String(identity.id)` does not
produce a dynamic managed-identity dictionary key. For a core Resource property
requiring that dictionary, use a supported deferred object expression, such as
`fn.json(fn.format('{{"{0}":{{}}}}', identityId))`, and inspect its local rendering.
Preserve fractional CPU with `fn.json("0.25")`, not a raw fractional literal.

Provider operations have their own request schemas. For
`Microsoft.Search/checkNameAvailability` (API `2025-05-01`), the body is:

```json
{"name":"candidate-search-name","type":"searchServices"}
```

Its `type` is **not** `Microsoft.Search/searchServices`. Do not generalize this
to Storage or Registry checks, which use their documented fully qualified
resource types. Inspect the selected operation, API version and response fields;
successful name availability is not resource creation or model admission.

See the [Search operation contract](https://learn.microsoft.com/rest/api/searchmanagement/services/check-name-availability?view=rest-searchmanagement-2025-05-01).

## Explicit CLI identity and SDK options

In an explicitly private Azure CLI context, propagate `AZURE_CONFIG_DIR` to every
CLI and bootstrap SDK subprocess. Verify that profile's tenant and subscription
first. Do not allow a general credential chain to select unrelated host caches.
Use the approved explicit credential rather than silently switching identities.

When this runtime's provisioning transport uses the Azure Developer CLI and the
private CLI identity is approved, configure `auth.useAzCliAuth=true` in a
run-private `AZD_CONFIG_DIR` and propagate the supplied `AZURE_CONFIG_DIR`.
Keep that setup in the guarded persistent lifecycle before provisioning, not
in a resource entrypoint or import-time side effect. Do not start a separate
transport login or fall back to default host credential caches. This is an
implementation-specific transport detail, not a prerequisite for other methods.

For `AzureCliCredential`, choose `subscription` **or** `tenantId`, not both:
the underlying CLI token request rejects the combination. For a prevalidated
private subscription, construct `new AzureCliCredential({ subscription })`
inside the guarded action. Do not persist tokens or use keys to repair an
invalid credential-options combination.

Inspect command help before adding scope flags: ARM commands accept only their
supported subscription/group options; tenant-scoped Microsoft Graph commands
such as `az ad signed-in-user show --query id --output tsv` do not take a resource
group or an invented subscription option.

## Build and container-exec capabilities

Check `docker buildx version` before using buildx-specific flags. It is optional,
not evidence of an Azure quota problem. Supported alternatives include
`docker manifest inspect --verbose` for the official Node tag's platform
descriptor/digest, then `docker image inspect --format '{{json .RepoDigests}}'`
after a successful push for the immutable application reference. Verify the
intended registry/repository, Linux architecture and nonempty sha256 digest.
Use an authorized hosted build if no local engine exists; do not raise its SKU.

Do not assume `az containerapp exec --command` preserves nested shell/JavaScript
quotes or arbitrary space-containing argument strings. Check the installed
transport. A supported stdin/PTY session to one known executable can deliver a
trusted diagnostic without nested command parsing, image edits or new agents.
Keep waits bounded, terminate the diagnostic process and verify both its exit
and one non-secret structured result. Strip terminal-control sequences before
parsing; a successful CLI connection/exit is not proof the remote program ran.
Never echo identity headers, access tokens, secrets or telemetry connection
strings into terminal transcripts or evidence.
