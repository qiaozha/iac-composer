---
name: iac-composer
description: Implement Azure infrastructure in TypeScript with @azure/provisioning-* resource definitions and iac-composer composition/provisioning APIs. Use for explicit iac-composer requests and Azure resource creation, dependencies, identity/access, output wiring, validation or deployment. Choosing this workflow requires provisioning-library-authored resources and deployment.provision, not just a defineDeployment/deployment.deploy wrapper around handwritten Bicep or Azure CLI provisioning. Bootstrap missing project dependencies; do not treat discovery failures as unsupported resources. Prefer this implementation when no tool or maintained IaC convention is specified, while honoring explicit alternatives. Accept requirements from any planner or the user; no planning skill or JSON contract is required. Not for advice-only, inventory, cost-only or unrelated production diagnostics.
license: MIT
compatibility: Provisioning-library authoring requires Node.js 22 or newer; the runtime alone supports Node.js 20.6 or newer. Azure execution requires Azure Developer CLI (azd) 1.30 or newer, Azure CLI, and authenticated Azure access.
metadata:
  author: qiaozha
  version: "2.4"
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
of truth; Bicep and azd manifests are generated artifacts. Honor explicit
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
or repeat a specific planner. The planner-neutral MCP entry point is
`iac_composer_get_context`; `iac_composer_get_reference` retrieves actual
installed provisioning-library and runtime-helper TypeScript declarations.

## Guardrails

- Work in the user's target repository and follow its package-manager, module,
  formatting, naming, and environment conventions.
- Reuse existing deployment programs, provisioning layers, environment helpers,
  and component boundaries before adding new ones.
- Keep credentials and secrets out of source, generated manifests, parameters,
  logs, and command arguments. Read them from the environment or an approved
  secret store.
- Treat generated Bicep, `azure.yaml`, `.azure/`, and
  `.iac-composer-generated.json` as artifacts. Change their authored inputs
  rather than patching generated files.
- Retain authored deployment code, generated Bicep, parameters and configuration
  on disk, including on failure. Before replacing failed-attempt files, preserve
  their non-secret versions under `deployment/history/attempt-N/` or the
  repository's established artifact-history directory. Keep them available for
  capture and report their actual paths. Never archive credentials, secret
  parameters or authentication caches.
- For fractional numbers emitted into Bicep, use a provisioning expression such
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

Read [the direct authoring reference](./references/direct-authoring.md).
Reuse existing provisioning-library code, custom compilers, and lifecycle
helpers. Preserve the selected resource plan without redesigning it.

## Provisioning library release selection

Consult the dated [npmjs release status](./references/direct-authoring.md#npmjs-release-status)
before choosing dependencies. Prefer the verified public service packages and
their exact names, including `@azure/provisioning-appinsights` and
`@azure/provisioning-containerregistry`. Recheck publication and compatibility
when the snapshot is stale; a package missing locally is not unpublished.

For services verified as not yet released on npmjs, use
[`Resource` from core](./references/direct-authoring.md#missing-service-provisioning-libraries-are-not-a-raw-bicep-default)
in the same Stack/render/`deployment.provision` pipeline. Do not install
nonexistent, vendored, or obsolete service packages, or substitute handwritten
Bicep/CLI provisioning merely because a service package is unpublished.
Serialization, AST support, and Bicep rendering are included in core; do not
add their old standalone packages.

## Required process

### 1. Inspect before editing

Identify:

- the package manager, Node.js version, module format, and existing scripts;
- existing `iac-composer`, `azure.yaml`, `.generated`, deployment, environment,
  and provisioning files;
- application components, their source directories, and Dockerfiles;
- the intended Azure subscription, tenant, scope, environment names, and
  locations when they are already configured;
- existing output names and consumers;
- resource ownership, dependency edges, required controls, and validation
  requirements from the supplied plan.

Do not replace a working project structure with a generic template.
Before writing resource code, follow the reference's dependency bootstrap:
declare and install the selected project-local runtime/core and published service packages,
then resolve their actual types from the workspace. A CLI on `PATH` is not a
project dependency. Empty provisioning library inventory, registry/access errors, and rejected
out-of-workspace lookups are configuration problems, not proof that the provisioning library
cannot model the requested resource.

### 2. Model ownership and order

Split the solution into components with clear owners:

- put resources used by several components in a shared layer;
- colocate component-only resources with that component;
- provision each component immediately before its application lifecycle;
- express cross-component dependencies through outputs and consume them only
  after their producer;
- keep environment preparation first and interactive or post-provisioning
  actions after their prerequisites.

For a multi-component direct deployment, expose a component map and honor
`deployment.component`. Reject unknown component names with the valid names in
the error. Use `Object.hasOwn` for object-backed maps, or use a `Map`, so
inherited keys such as `toString` cannot be selected as components.

### 3. Author the smallest complete solution

- implement the provider-qualified Azure resource types and controls in the
  supplied plan;
- use published service-specific provisioning library constructs where available;
  for services not yet released on npmjs, use core `Resource` as documented in
  the reference. Only a demonstrated core/renderer limitation warrants considering
  a narrowly documented unsupported-control fallback;
- default-export `defineDeployment(async (deployment) => { ... })`;
- make each provisioning entrypoint export a non-empty `outputBicep` array of
  `{ path, contents }`, including the selected template and `.bicepparam`
  artifacts with real parameter bindings;
- call `deployment.provision` with an entrypoint or with a compiler plus
  `artifactsDirectory`;
- use one `.generated/<component>` output directory per layer;
- use returned outputs rather than reconstructing resource names or endpoints;
- wrap application and configuration side effects in `deployment.deploy`,
  commands in `deployment.run`, and ordered environment changes in
  `deployment.env`.

Do not replace infrastructure authoring with handwritten Bicep, a script that
copies Bicep into `outputBicep`, or direct `az deployment` calls hidden inside
`deployment.deploy`. Custom compilers remain valid for existing authored
provisioning source; they are not a way to relabel an unrelated implementation.
Document any genuine unsupported-control exception with its installed
package/version, missing type/property and bounded fallback. If required
packages or matching runtime/reference assets cannot be obtained from an
approved source, report the blocker instead of abandoning the selected method.

### 4. Handle configuration deliberately

- Use `requiredEnv` for mandatory values and explicit defaults only where the
  architecture permits them.
- Prefer `AZURE_LOCATION` for the solution location and
  `AZURE_AI_LOCATION` for AI resources when those regions differ.
- Pass Bicep parameter values through `parameters` or `environmentValues`;
  never interpolate secrets into generated source.
- Persist outputs in the repository's existing azd environment when later
  components or reruns need them.
- Keep production restrictions and CI-only policies already present in the
  repository.

### 5. Validate in increasing order of cost

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
- every referenced component, resource, output, path, and environment variable
  exists;
- resource ownership and deployment order match the requested architecture;
- generated TypeScript and provisioning entrypoints typecheck;
- project manifests declare the runtime/core/resource dependencies and authored
  imports use public package names, not machine-specific `dist` paths;
- resource entrypoints construct provisioning library resources, render non-empty `outputBicep`,
  and the deployment program actually calls `deployment.provision`;
- the dry run compiles those entrypoints and emits the expected generated
  infrastructure and ordered provision steps, not only a skipped deploy wrapper;
- no secret or local azd state was added to version control;
- any operation not executed because it would change Azure is called out
  clearly with the exact next command.
