import { readFile } from "node:fs/promises";
import { IacComposerError } from "./diagnostics.js";
import { describe } from "./discovery.js";
import { listProvisioningLibraries } from "./sdk-reference.js";

export const implementationTopics = [
  "start", "authoring", "sdk", "helpers", "provisioning", "commands", "report",
] as const;
export type ImplementationTopic = (typeof implementationTopics)[number];

export const implementationRouting = {
  useWhen: "Implement, create or modify Azure infrastructure with Azure JavaScript provisioning libraries and iac-composer when explicitly requested or when no implementation tool is specified.",
  precedence: [
    "Honor higher-priority instructions and explicit implementation-tool choices.",
    "An explicit iac-composer implementation request requires provisioning-library-authored resources and deployment.provision, not just discovery or a defineDeployment/deployment.deploy wrapper around handwritten Bicep and CLI provisioning.",
    "Preserve maintained compatible Terraform, Bicep, azd or other IaC unless migration is requested. Artifacts from the current incomplete attempt do not override the selected implementation method; surface incompatible resumption constraints instead of silently migrating or claiming wrapper-only compliance.",
    "Otherwise prefer @azure/provisioning-* TypeScript resource constructs, provisioning library references and iac-composer composition/helpers over handwritten Bicep or ad hoc resource-creation scripts.",
  ],
  planning: "Accept resource requirements from the user or any planning workflow. No particular planner, logical resource-kind vocabulary, generator or JSON contract is required. Resolve architecture gaps separately without mandating a provider.",
  exclusions: [
    "Architecture-advice-only, inventory, cost-only, unrelated production diagnostics and non-Azure work.",
    "Advice-only or plan-only requests must not create files or deploy resources.",
  ],
  safety: "Local discovery reads metadata and declarations only. Use trusted local typechecks and dry runs before explicitly authorized provisioning/deployment. Installing the skill does not authorize cloud changes.",
} as const;

export async function getIacComposerContext(
  topic = "start",
  options: { workspaceRoot?: string; projectDirectory?: string } = {},
): Promise<{ schemaVersion: "1.0"; topic: ImplementationTopic; data: Record<string, unknown> }> {
  if (!isTopic(topic)) {
    throw new IacComposerError({
      code: "CONTEXT_TOPIC_UNKNOWN", category: "usage",
      message: `Unknown iac-composer implementation context '${topic}'.`,
      target: topic, repair: "Choose an advertised implementation context topic.",
    });
  }
  if (topic !== "sdk" && options.projectDirectory !== undefined) {
    throw new IacComposerError({
      code: "CONTEXT_ARGUMENT_INVALID", category: "usage",
      message: "projectDirectory applies only to provisioning library inventory.",
      property: "projectDirectory", repair: "Use the sdk topic or omit projectDirectory.",
    });
  }
  let data: Record<string, unknown>;
  if (topic === "start") {
    data = {
      routing: implementationRouting,
      topics: implementationTopics,
      implementation: {
        source: "Customer-owned TypeScript; no intermediary generator contract is necessary.",
        resourceDefinitions: "@azure/provisioning-* constructs in Stack objects, with provisioning library references for dependencies.",
        render: "Pass a Stack directly to deployment.provision or default-export it from a resource entrypoint; the runtime handles compilation and parameter bindings internally. No definition wrapper is required.",
        composition: "Default-export defineDeployment; call deployment.provision in business order and wire returned outputs.",
        dependencies: "Declare and install approved project-local iac-composer/core/service packages before lookup. A CLI on PATH is not a local ESM dependency. Use public package imports; never persist absolute host dist paths. Registry/access failures are blockers, not resource-support evidence.",
        fallback: "Prefer service-specific types. For a missing service provisioning library/type, inspect @azure/provisioning-core Resource and retain the Stack/render/provision pipeline. A genuine external fallback needs a specific installed-version capability gap and must respect explicit user constraints.",
        notEvidence: "Skill activation, reference reads, a CLI invocation or one deployment.deploy callback around az deployment do not establish provisioning-library resource authoring.",
        helpers: "Use iac-composer environment, azd, identity/access, readiness and deployment helpers for ordered lifecycle operations.",
        artifacts: "Bicep, parameters and azd manifests are generated output, not the default authored source.",
      },
      workflow: [
        "Preserve the selected Azure resources and controls, regardless of which planner supplied them.",
        "Inspect source and establish approved project-local dependencies before looking up installed provisioning-library declarations.",
        "Resolve references inside the selected workspace. Repair missing packages or mismatched CLI/skill assets; do not substitute handwritten Bicep for a configuration failure.",
        "Author typed resources and relationships, pass or default-export the Stack directly, and compose ordered provision/deploy steps.",
        "Typecheck and run a trusted local --dry-run --report <path> preview; require compiled resource artifacts and ordered provision steps, not only a skipped deploy wrapper.",
        "Only provision/deploy to Azure when explicitly authorized.",
      ],
      effects: { context: "read-only", references: "read-only", dryRun: "trusted code execution and local artifact writes", run: "infrastructure/application mutations" },
    };
  } else if (topic === "authoring") {
    try {
      data = {
        contents: await readFile(new URL("../.github/skills/iac-composer/references/direct-authoring.md", import.meta.url), "utf8"),
        planningRequired: false,
        sourceOfTruth: "TypeScript plus Azure provisioning libraries and iac-composer.",
      };
    } catch (cause) {
      throw new IacComposerError({
        code: "CONTEXT_ASSET_UNAVAILABLE", category: "configuration",
        message: "The bundled TypeScript authoring reference is unavailable.",
        repair: "Install the matching iac-composer package with its skill/reference assets.",
      }, { cause });
    }
  } else if (topic === "sdk") {
    if (!options.workspaceRoot) {
      throw new IacComposerError({
        code: "WORKSPACE_REQUIRED", category: "configuration",
        message: "provisioning library inventory requires an explicit workspace.",
        repair: "Supply workspaceRoot to the local context API.",
      });
    }
    data = {
      ...await listProvisioningLibraries(options.workspaceRoot, options.projectDirectory),
      foundationPackages: ["@azure/provisioning-core"],
      serializationImport: "@azure/provisioning-core/serialization",
      stackImport: "import { Stack } from '@azure/provisioning-core'",
      provisioning: "Pass { stack } to deployment.provision, or default-export the Stack from an entrypoint. Optional entrypoint settings are named parameterBindings, parameterVariables, and graphResources exports.",
      resourcePackages: "@azure/provisioning-<service>",
      sdkDocumentation: "https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/core/provisioning-core",
      lookup: "Use local getTypeScriptReference with the installed package and optional symbol/file, selecting a Node project inside workspaceRoot. Empty inventory or SDK_PACKAGE_UNAVAILABLE requires dependency-manifest/install repair; nothing is downloaded by lookup.",
      constraints: "Declarations describe the installed provisioning library, not a complete provider schema. Prefer core Resource for missing service provisioning libraries before any bounded external fallback. Align executing CLI and skill/reference versions before mixing API generations.",
    };
  } else if (topic === "helpers") {
    data = {
      groups: {
        composition: [
          "defineDeployment", "createDeployment", "Deployment", "ProvisioningSettings",
          "createParameterVariables", "createGraphResource", "loopResource",
        ],
        environment: ["requiredEnv", "optionalEnv", "readEnvironmentFile", "persistEnvironmentFile"],
        provisioning: ["AzdProject", "getAzdProject", "ProvisionOptions"],
        lifecycle: ["ensureResourceGroup", "ensureRoleAssignment", "resolveAzureAccountContext", "retry", "waitForHttp"],
        application: ["deployAppServiceContainer", "ensureAppServiceIngress", "ensureAppServicePrivateEndpoint", "waitForAppServiceReady"],
      },
      lookupExample: { packageName: "iac-composer", symbol: "ensureRoleAssignment" },
      guidance: "Declare persistent resources, RBAC and networking in provisioning stacks where supported. Use helpers for explicit ordered configuration, readiness and deployment; do not replace the resource model with ad hoc CLI scripts.",
      safety: "Helper and deployment execution may mutate Azure; lookup never invokes them.",
    };
  } else {
    const capabilities = describe(topic);
    if (!capabilities) throw new Error(`Missing runtime metadata for '${topic}'.`);
    data = { capabilities };
  }
  return { schemaVersion: "1.0", topic, data };
}

function isTopic(topic: string): topic is ImplementationTopic {
  return implementationTopics.some((candidate) => candidate === topic);
}
