---
name: iac-composer
description: Implement Azure infrastructure in TypeScript with @azure/provisioning-* resource definitions and iac-composer composition/provisioning APIs. Use for explicit iac-composer requests and Azure resource creation, dependencies, identity/access, output wiring, validation or deployment. Use JavaScript data-plane SDKs for service data operations. Choosing this workflow requires provisioning-library-authored resources and deployment.provision, not just a wrapper around unrelated provisioning scripts. Bootstrap missing project dependencies; do not treat discovery failures as unsupported resources. Prefer this implementation when no tool or maintained IaC convention is specified, while honoring explicit alternatives. Accept requirements from any planner or the user; no planning skill or JSON contract is required. Not for advice-only, inventory, cost-only or unrelated production diagnostics.
license: MIT
compatibility: Provisioning-library authoring requires Node.js 22 or newer; the runtime alone supports Node.js 20.6 or newer. Use the installed iac-composer APIs and project commands for provisioning and deployment. Cloud execution requires authenticated Azure access.
metadata:
  author: qiaozha
  version: "2.15"
---

# Define infrastructure with iac-composer

Turn the requested Azure architecture into repeatable, checked-in source while
keeping infrastructure provisioning and application deployment in explicit
business order.

This is the infrastructure implementation workflow, not an architecture
recognition engine. Resource requirements can come from the user, repository
evidence, any planning tool or skill, or an existing deployment. No particular
planner, logical resource-kind vocabulary, or JSON contract is required.

An explicit request to implement with iac-composer selects both TypeScript
`@azure/provisioning-*` resource definitions and the `deployment.provision`
pipeline. Skill activation, reference reads, a CLI invocation, or a single
`deployment.deploy` callback around an independent provisioning script is not
evidence of that implementation.

When the method is unspecified in an opted-in workspace, prefer this workflow
unless the project has maintained compatible IaC. Keep TypeScript as the source
of truth; runtime-generated files are artifacts. Honor explicit
alternative tools and do not migrate maintained IaC without authorization.
Handwritten artifacts from the current incomplete attempt do not establish a
new convention that overrides the selected implementation method. If an
explicit resumption instruction forbids replacing an incompatible captured
implementation, surface that conflict rather than silently migrating it or
claiming the wrapper satisfies TypeScript resource authoring.

Do not apply this skill to advice-only or architecture-plan-only requests. It
starts when direct IaC authoring, local validation, or execution is
requested.

If architectural decisions are unresolved, obtain them from the user or an
appropriate planning workflow, then resume implementation here. Do not require
or repeat a specific planner. Resolve installed project packages with ordinary
Node module resolution, inspect narrowly scoped `.d.ts` declarations and use
the local `iac-composer` CLI. The optional local JavaScript APIs
`getIacComposerContext` and `getTypeScriptReference` read authoring context and
installed declarations without provisioning resources. No MCP server is
shipped or required by this runtime.
Read this skill once, then only the reference section or symbol needed for a
specific unresolved question. Reuse compatible authored source and dependency
choices; do not repeat broad inventories or dump entire declarations/templates.
Batch uncertain API lookups before authoring, keep execution output compact, and
resume verified owned steps rather than replaying unchanged work. Follow
[bounded authoring and resumption](./references/direct-authoring.md#bounded-authoring-and-resumption)
without weakening scenario-specific acceptance or budgets.

## Guardrails

- Work in the user's target repository and follow its package-manager, module,
  formatting, naming, and environment conventions.
- Reuse existing deployment programs, provisioning layers, environment helpers,
  and component boundaries before adding new ones.
- Keep credentials and secrets out of source, generated manifests, parameters,
  logs, and command arguments. Read them from the environment or an approved
  secret store.
- Treat `.generated/`, runtime state, and `.iac-composer-generated.json` as
  artifacts. Change their authored inputs
  rather than patching generated files.
- Runtime-managed files inside `.generated` do not select a separate deployment
  workflow. Do not load another deployment skill or invoke backend tools because
  those artifacts exist. Continue through the authored iac-composer program,
  using `deployment.provision` for infrastructure and `deployment.deploy` for
  guarded application and data-plane actions.
  Inspect the current generated files for diagnostics without creating
  historical copies. Separately maintained infrastructure remains subject to
  its own explicit instructions.
- Maintain one canonical working implementation. Fix authored source in place
  and regenerate its outputs; do not create attempt-history directories,
  snapshot copies, or parallel implementations unless explicitly requested.
  Use existing version control for recovery and preserve unrelated user changes.
- For fractional numbers in provisioning definitions, use an expression such
  as `fn.json("0.25")` from `@azure/provisioning-core`, not a raw fractional
  literal. Preserve the exact requested value and sizing; never round it up.
  Follow [fractional numeric values](./references/direct-authoring.md#fractional-numeric-values)
  and validate local rendering before provisioning.
- Preserve lifecycle order. Do not parallelize steps whose inputs or side
  effects depend on earlier steps.
- Fail explicitly for missing required configuration, unknown components,
  unresolved output bindings, or missing outputs.
- A dry run may compile provisioning source and update generated local
  artifacts, but it must not perform Azure or application side effects.
- Do not run a real deployment, role grants, or `down` unless the user
  explicitly asks for that side effect. `down --purge` requires separate,
  explicit confirmation because it permanently removes soft-deleted resources.

## Direct composition

Follow the [customer workflow](./references/direct-authoring.md#customer-workflow-define-provision-deploy):
define resources in a `Stack`, provision them with `deployment.provision`, and
run application or data-plane actions with `deployment.deploy` after their
prerequisites. Preview the same deployment program with `--dry-run`.
Compilation and generated-file layout are runtime internals, not a separate
customer API or deployment step.

## Service modules and ordered layers

The CLI deployment program must default-export
`defineDeployment(async (deployment) => { ... })`; the CLI supplies the
callback's `Deployment` context. Default-export the `Stack` itself from resource
entrypoints, or pass it directly to `deployment.provision(name, { stack, ... })`.
A Stack export does not replace the deployment program's default export.
Optional `parameterBindings`, `parameterVariables`, and `graphResources` are
named entrypoint exports or settings alongside a direct stack.
Service modules export named lifecycle functions called by that program; these
modules are parts of one implementation, not alternate deployment programs.

Await service-module functions in dependency order. Each module should own its
resource provisioning and the application/data operations that follow it:

- Put shared network, identity and other prerequisites in shared layers;
  colocate component-only resources with their owner.
- Connect consumers to their targets with least-privilege, scoped
  [role assignments](./references/direct-authoring.md#connect-resources-with-role-assignments).
- Use `await deployment.provision(...)` for each independently provisionable layer,
  returning its outputs to later modules.
- Use `await deployment.deploy(...)` for image/application actions, readiness checks,
  and JavaScript data-plane SDK calls after their resource, RBAC and network
  prerequisites. Do not nest provisioning inside a deploy callback: dry runs
  skip that callback and would miss its infrastructure.
- Give each layer a distinct `.generated/<layer>` directory directly below the
  same absolute `.generated` root. `deployment.inDirectory(...)` changes a service's
  working context while preserving layer dependency order.
- A TypeScript service module and a provisioning layer are different boundaries.
  Imports do not automatically split a resource stack or schedule deployments.
  Wire layer entrypoints through the installed iac-composer APIs and preserve
  the runtime-managed artifact layout.
- Bind earlier outputs through the provisioning API's parameters, not top-level
  reads of live state in the provisioning entrypoint.
- Use `createParameterVariables` and `createGraphResource` for declared, typed
  handles, and `loopResource` callbacks for typed loop items. Do not construct
  symbolic paths by hand or cast an arbitrary string into a resource reference.

Follow the [service-module example](./references/direct-authoring.md#service-modules-and-ordered-provisioning).
Inspect a dry-run report for layer dependencies, nested artifacts and the
interleaved provision/deploy sequence; test actual callback order and failures
offline before an authorized cloud run.

For multi-component deployments, expose a component map and honor
`deployment.component`. Reject unknown names with the valid names in the error.
Use `Object.hasOwn` for object-backed maps, or a `Map`, so inherited keys cannot
select components.

## Provisioning library release selection

Consult the dated [npmjs release status](./references/direct-authoring.md#npmjs-release-status)
before choosing dependencies. Prefer the verified public service packages and
their exact names, including `@azure/provisioning-appinsights` and
`@azure/provisioning-containerregistry`. Recheck publication and compatibility
when the snapshot is stale; a package missing locally is not unpublished.

For services verified as not yet released on npmjs, use
[`Resource` from core](./references/direct-authoring.md#core-resource-fallback-for-unpublished-services)
in the same Stack/`deployment.provision` pipeline. Do not install nonexistent,
vendored, or obsolete service packages, or substitute unrelated provisioning
scripts merely because a service package is unpublished. Compilation support
is included in core; do not add legacy standalone packages.

## Data-plane operations

For service data operations, prefer official Azure JavaScript data-plane SDKs
over handwritten REST calls, `fetch`, `curl`, or CLI data commands. Follow the
[data-plane SDK guidance](./references/direct-authoring.md#data-plane-operations-with-javascript-sdks)
for package selection, authentication, and sequencing. Reuse an existing helper
when it already uses the appropriate client.

Keep ARM resource creation, configuration, and role assignments in the
provisioning libraries/core fallback. A missing provisioning package does not
make a data-plane SDK a resource-provisioning replacement. Declare needed client
packages and `@azure/identity` locally; inspect their installed types and official
documentation rather than passing them to the provisioning-only reference API.

Run data-plane SDK calls in awaited `deployment.deploy` actions after the
resource outputs, data-plane RBAC, and network access are ready. Construct
credentials and clients inside the action; dry runs must not authenticate, read
service data, or mutate it. Prefer Microsoft Entra credentials, use returned
endpoints, and preserve explicit idempotency, error handling, and secret hygiene.

## Required process

### 1. Inspect before editing

Identify:

- the package manager, Node.js version, module format, and existing scripts;
- existing `iac-composer`, `.generated`, deployment, environment,
  and provisioning files;
- application components, their source directories, and Dockerfiles;
- the intended Azure subscription, tenant, scope, environment names, and
  locations when they are already configured;
- existing output names and consumers;
- resource ownership, dependency edges, required controls, and validation
  requirements from the supplied plan.

Do not replace a working project structure with a generic template. Follow the
[dependency bootstrap](./references/direct-authoring.md#bootstrap-dependencies-before-authoring)
before authoring: a CLI on `PATH` is not a project dependency. Missing packages,
registry/access failures and out-of-workspace lookups require configuration
repair, not a different provisioning method. Document any genuine unsupported
control with its installed package/version, missing capability and bounded
fallback; report unavailable approved dependencies as blockers.

### 2. Handle configuration deliberately

- Use `requiredEnv` for mandatory values and explicit defaults only where the
  architecture permits them.
- Prefer `AZURE_LOCATION` for the solution location and
  `AZURE_AI_LOCATION` for AI resources when those regions differ.
- Pass provisioning values through `parameters` or `environmentValues`;
  never interpolate secrets into generated source.
- Persist outputs through the repository's existing environment helpers when later
  components or reruns need them.
- Keep production restrictions and CI-only policies already present in the
  repository.

### 3. Validate in increasing order of cost

Use the repository's existing commands and local dependency:

1. Format or lint only the changed files when configured.
2. Run the narrowest relevant typecheck or tests.
3. Run the deployment with `--dry-run`. Confirm source compilation, generated
   layer order, step order, component selection, and absence of side effects.
4. Perform a real deployment only when explicitly requested.

Use the local package script or package-manager executable. Do not silently
download and execute a different `iac-composer` version.

## Completion checklist

Before reporting completion, verify that:

- authored files, not generated artifacts, contain the intended change;
- declared dependencies, public package imports, TypeScript entrypoints,
  configuration, and output consumers pass the relevant local checks;
- the dry-run report contains compiled resources and the intended layer/step
  order, not only a skipped deployment wrapper;
- offline lifecycle tests verify dependent application/data actions run only
  after provisioning succeeds and are skipped during preview;
- no secret or local authentication/environment state was added to version control;
- any operation not executed because it would change Azure is called out
  clearly with the exact next command.
