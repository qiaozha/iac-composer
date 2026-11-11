# Workspace opt-in: TypeScript Azure infrastructure with iac-composer

The discovery target is the **implementation method**, not an architecture
planner. In an opted-in workspace, requests such as:

> Implement these Azure resources with managed identity access.

should lead to customer-owned TypeScript using `@azure/provisioning-*`, resource
references, and `iac-composer` composition and provisioning/deployment helpers.
Bicep is generated output. Requirements can come from the user or **any**
planning workflow; no particular planner, logical resource-kind vocabulary,
generator package, or JSON contract is required.

Honor explicit implementation tools and existing compatible IaC. For unresolved
architecture decisions, use an appropriate planning workflow and then resume
implementation. Do not reselect services simply to use this runtime.

## 1. Install or build iac-composer only

Use Node.js 20.6 or newer and a reviewed, pinned runtime package or checkout.
From a checkout:

```bash
npm ci
npm run build
```

The package provides the `iac-composer` CLI and local JavaScript APIs.
No MCP server registration or host profile is required. Building
`tools/azure-infrastructure`, installing its skill, and preparing its contracts
are **not** prerequisites.

The consumer project declares `@azure/provisioning-core` and resource-specific
packages it actually imports, such as `@azure/provisioning-storage`.
Public npm provisioning libraries require Node.js 22 or newer. Core bundles
serialization, AST support, and Bicep rendering; use its `/serialization` and
`/internal` exports rather than separate packages. Inspect existing manifests/versions first; do
not silently install an unrelated latest tool or a management SDK.

## 2. Install the implementation skill

From the consumer repository, with GitHub CLI 2.97 or newer:

```bash
gh skill install qiaozha/iac-composer iac-composer \
  --agent codex --scope project --pin <REVIEWED_REF> --allow-hidden-dirs
```

This creates `.agents/skills/iac-composer`, a common project location supported
by Copilot and Codex. It does not require the Codex application. Other hosts
can use the instruction/file bridge below. Do not install duplicate full
skill trees in several auto-scanned locations.

For unpublished changes use the reviewed checkout path instead of the GitHub
repository, add `--from-local`, and omit `--pin`; pin the checkout itself.
GitHub CLI 2.97's local installer accepted the canonical name but rejected
path-shaped selectors in verification. Do not use `--force` without review.

## 3. Add the conditional workspace policy

Merge the [AGENTS routing block](AGENTS.md.template) into the consumer-root
`AGENTS.md`. Do not replace an existing instruction file. It prefers TypeScript
provisioning library resource definitions and iac-composer when no implementation method or
existing convention applies, not when the user explicitly chose Terraform,
Bicep, azd, REST/management SDKs or another approach.

If a host/version does not load `AGENTS.md`, merge the
[minimal Claude bridge](CLAUDE.md.template) into the already-active
`CLAUDE.md` where appropriate. Preserve unrelated project instructions. Use
one workflow route rather than loading the same instructions twice.
Architecture-only, inventory and unrelated diagnostic requests are not
redirected into implementation.

## 4. Inspect installed APIs locally

Resolve packages from the consumer project and read only the declarations
needed for the selected resources. The optional local JavaScript APIs expose
authoring context and bounded declaration lookup without loading resource code:

```ts
import { getIacComposerContext, getTypeScriptReference } from "iac-composer";

const context = await getIacComposerContext("start");
const reference = await getTypeScriptReference({
  workspaceRoot: process.cwd(),
  packageName: "@azure/provisioning-storage",
  symbol: "StorageAccount",
  projectDirectory: ".",
});
console.log(context, reference);
```

`getIacComposerContext` supports `start`, `authoring`, `sdk`, `helpers`,
`provisioning`, `commands`, and `report`. The `sdk` topic requires
`{ workspaceRoot, projectDirectory? }`; other topics do not accept
`projectDirectory`. No Azure service catalog or planner contract is required.

`getTypeScriptReference` accepts `iac-composer` or an installed
`@azure/provisioning-*` package. Omit `symbol` for an entrypoint excerpt;
optional `file` and `line` select a bounded declaration-file range.
Runtime symbol lookup is limited to names in the public package entrypoint.
Missing packages/symbols and invalid paths fail explicitly.

Lookup reports installed versions, filenames, line numbers and excerpts.
It does not download packages, execute provisioning-library entrypoints, or
substitute management-SDK request shapes. Reads stay within the resolved
package; narrow lookup when the response reports truncation. Ordinary Node
module resolution and `.d.ts` reads are also supported; no server is needed.

## Author, validate and execute through the runtime

The agent writes TypeScript provisioning source, passes or default-exports a
`Stack`, and composes it with `defineDeployment`, `deployment.provision`, returned
outputs, and explicit lifecycle helpers. Resource relationships belong in provisioning library
references; persistent resources should not be replaced by ad hoc CLI scripts.

After project typechecking and appropriate Bicep checks, use the existing CLI:

```bash
iac-composer ./deployment.ts --dry-run --report preview.json
```

Only when the user authorizes infrastructure execution:

```bash
iac-composer ./deployment.ts --environment dev --report deployment.json
```

Provisioning/deployment uses the runtime's existing azd integration. A dry run
executes trusted modules/compilers and writes local artifacts; it is not a
sandbox, Azure what-if, permission check or deployment guarantee. Keep secrets
out of source, logs and arguments. Deployment, role grants, authentication and
deletion are not authorized by installing a skill or reading local context.

## Optional planning/generation integrations

Any planning skill/tool can provide resource requirements. The separate
`azure-infrastructure` planner/contract generator is one optional upstream
integration; do not install it or convert requirements to its JSON inputs merely
to implement resources with iac-composer.

The planner's separate MCP server remains available when that specific
planner/generator is wanted. It is not part of this runtime. If a consumer has
an older runtime MCP registration, remove only that reviewed server entry;
preserve unrelated servers and project instructions.

## Verify the intended selection

Use the [evaluation cases and recording protocol](evaluation/README.md).
The key trial installs only iac-composer, supplies an Azure resource plan from
another source, and checks for TypeScript provisioning library resource definitions, helper use
and runtime provisioning/preview without a required recognition skill or JSON
contract.

Native skill installation, packed-runtime isolation and local API tests
verify availability and behavior, not model choice. Fresh real-host trials
are still required to claim unprompted selection improvements; unavailable
hosts or telemetry must be recorded as unverified, not successful.
