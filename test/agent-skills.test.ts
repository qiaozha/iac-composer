import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";
import { createDeployment, describeRuntimeCapabilities, type ExecutionReport } from "../src/index.js";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillSources = [".github/skills/iac-composer"];

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function validateSkill(directory: string): Promise<Record<string, unknown>> {
  const contents = await readFile(join(directory, "SKILL.md"), "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(contents);
  assert.ok(frontmatter);
  const metadata = object(parse(frontmatter[1]));
  assert.equal(metadata.name, directory.split(/[\\/]/).at(-1));
  assert.ok(typeof metadata.description === "string");
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 1024);
  assert.notEqual(metadata["disable-model-invocation"], true);
  for (const match of contents.matchAll(/\]\(((?:\.\/)?references\/[^)#]+)(?:#[^)]*)?\)/g)) {
    await access(resolve(directory, match[1]));
  }
  return metadata;
}

test("the implementation skill advertises provisioning TypeScript without a planner dependency", async () => {
  const runtime = await validateSkill(resolve(root, skillSources[0]));
  assert.match(String(runtime.description), /@azure\/provisioning/);
  assert.match(String(runtime.description), /any planner or the user/);
  assert.match(String(runtime.description), /explicit iac-composer requests/);
  assert.match(String(runtime.description), /provisioning-library-authored resources and deployment\.provision/);
  assert.match(String(runtime.description), /Bootstrap missing project dependencies/);
  assert.match(String(runtime.description), /JavaScript data-plane SDKs/);
  assert.doesNotMatch(String(runtime.description), /provisioning[- ]SDKs?\b/i);
  const skill = await readFile(resolve(root, skillSources[0], "SKILL.md"), "utf8");
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  assert.match(skill, /fn\.json\("0\.25"\)/);
  assert.match(skill, /Default-export the `Stack` itself/);
  assert.match(skill, /deployment\.provision\(name, \{ stack, \.\.\. \}\)/);
  assert.match(skill, /references\/direct-authoring\.md#customer-workflow-define-provision-deploy/);
  assert.match(skill, /Compilation and generated-file layout are runtime internals/);
  assert.match(skill, /Use `createParameterVariables` and `createGraphResource`/);
  assert.match(skill, /references\/direct-authoring\.md#connect-resources-with-role-assignments/);
  assert.match(skill, /Runtime-managed files inside `\.generated` do not select a separate deployment\s+workflow/);
  assert.match(skill, /Do not load another deployment skill or invoke backend tools/);
  assert.match(skill, /using `deployment\.provision` for infrastructure and `deployment\.deploy` for\s+guarded application and data-plane actions/);
  assert.match(skill, /Inspect the current generated files for diagnostics without creating\s+historical copies/);
  assert.match(reference, /Typechecking\s+alone does not catch this serialization error/);
  for (const contents of [skill, reference]) {
    assert.match(contents, /CLI deployment program must default-export\s+`defineDeployment/);
    assert.match(contents, /A Stack export does not replace the deployment program's default export/);
    assert.match(contents, /Maintain one canonical working implementation/);
    assert.match(contents, /unless (?:explicitly requested|the\s+user explicitly requests them)/);
    assert.doesNotMatch(contents, /deployment\/history\/attempt-N/);
    assert.doesNotMatch(contents, /provisioning[- ]SDKs?\b/i);
    assert.doesNotMatch(contents, /outputBicep|bicep|\bazd\b/i);
  }
  assert.doesNotMatch(String(runtime.description), /azure-infrastructure-intent|already exists/);
  assert.equal(typeof describeRuntimeCapabilities("overview"), "object");
});

test("shared guidance keeps reusable authoring rules without a consumer-specific preflight", async () => {
  await validateSkill(resolve(root, skillSources[0]));
  const skill = await readFile(resolve(root, skillSources[0], "SKILL.md"), "utf8");
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  await assert.rejects(access(resolve(root, skillSources[0], "references/api-contracts.md")), { code: "ENOENT" });
  for (const contents of [skill, reference]) {
    assert.doesNotMatch(contents, /api-contracts\.md|checkNameAvailability|AZURE_CONFIG_DIR|AZD_CONFIG_DIR|auth\.useAzCliAuth|docker buildx|containerapp exec/);
  }
  assert.match(reference, /`ProvisionOutputs` is a string map/);
  assert.match(reference, /declared types and authorized scope/);
  assert.match(reference, /request bodies are distinct\s+contracts/);
  assert.match(reference, /inner keys do not receive provisioning-library renaming/);
  assert.match(reference, /rather than coercing a handle into a JavaScript object key/);
  assert.deepEqual([...skill.matchAll(/^### \d+\. (.+)$/gm)].map(match => match[1]), [
    "Inspect before editing", "Handle configuration deliberately", "Validate in increasing order of cost",
  ]);
});

test("bounded authoring guidance reduces replay without embedding scenario controls", async () => {
  await validateSkill(resolve(root, skillSources[0]));
  const skill = await readFile(resolve(root, skillSources[0], "SKILL.md"), "utf8");
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  assert.match(skill, /references\/direct-authoring\.md#bounded-authoring-and-resumption/);
  const guidance = reference.split("## Bounded authoring and resumption\n")[1]?.split("## npmjs release status\n")[0];
  assert.ok(guidance);
  for (const pattern of [/one bounded batch/,/offline fixtures/,/--report <path>/,
    /compact summaries/,/Control\s+plane success is not data-plane readiness/,
    /scenario's deadlines/,/lifecycle cycle/,/not a new complete/,
    /model round trips as well as context size/,/post-response counter cannot enforce/]) {
    assert.match(guidance, pattern);
  }
  assert.doesNotMatch(guidance, /chatbot|Search firewall|1200000|LegacyRegistryPermissions|PublicAccessNotPermitted|deployment:usage|\/home\/qiaozha/);
  assert.ok(skill.split("\n").length < 500);
});

test("documented data-plane SDK operations are guarded, use returned endpoints, and propagate errors", async (t) => {
  const skill = await readFile(resolve(root, skillSources[0], "SKILL.md"), "utf8");
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  assert.match(skill, /references\/direct-authoring\.md#data-plane-operations-with-javascript-sdks/);
  const guidance = reference.split("## Data-plane operations with JavaScript SDKs\n")[1]?.split("## Provision options\n")[0];
  assert.ok(guidance);
  assert.match(guidance, /Do not use\s+management SDKs or data-plane clients to replace infrastructure provisioning/);
  assert.match(guidance, /not arbitrary data-plane SDKs/);
  assert.match(guidance, /ARM Contributor\/Owner access alone does not grant\s+service data access/);
  for (const name of [
    "storage-blob", "search-documents", "cosmos", "keyvault-secrets",
    "app-configuration", "service-bus", "event-hubs", "identity",
  ]) {
    assert.ok(guidance.includes(`@azure/${name}`), name);
  }
  const example = [...guidance.matchAll(/```ts\n([\s\S]*?)```/g)]
    .map((match) => match[1]!).find((block) => block.includes("export async function uploadBootstrapBlob"));
  assert.ok(example);
  const consumer = await mkdtemp(join(tmpdir(), "iac-composer-data-plane-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  await writeFile(join(consumer, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(consumer, "upload.ts"), example);
  const fixtures = {
    identity: `
export let credentialsCreated = 0;
export class DefaultAzureCredential {
  constructor() { credentialsCreated++; }
}`,
    "storage-blob": `
export const calls = [];
let failUpload = false;
export function failNextUpload() { failUpload = true; }
export class BlobServiceClient {
  constructor(endpoint) { calls.push({ operation: "client", endpoint }); }
  getContainerClient(containerName) {
    return {
      getBlockBlobClient: (blobName) => ({
        uploadData: async (contents) => {
          if (failUpload) throw new Error("Blob upload failed.");
          calls.push({ operation: "upload", containerName, blobName, contents: [...contents] });
        },
      }),
    };
  }
}`,
  };
  for (const [name, source] of Object.entries(fixtures)) {
    const directory = join(consumer, "node_modules/@azure", name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({
      name: `@azure/${name}`, version: "0.0.0", type: "module", exports: "./index.js",
    }));
    await writeFile(join(directory, "index.js"), source);
  }
  const { uploadBootstrapBlob } = await import(pathToFileURL(join(consumer, "upload.ts")).href);
  const identity = await import(pathToFileURL(join(consumer, "node_modules/@azure/identity/index.js")).href);
  const storage = await import(pathToFileURL(join(consumer, "node_modules/@azure/storage-blob/index.js")).href);
  const payload = new Uint8Array([1, 2, 3]);
  const live = createDeployment({ log: () => {} });
  await uploadBootstrapBlob(createDeployment({ dryRun: true, log: () => {} }), {}, "seed", "bootstrap.bin", payload);
  assert.equal(identity.credentialsCreated, 0);
  assert.deepEqual(storage.calls, []);
  await assert.rejects(uploadBootstrapBlob(live, {}, "seed", "bootstrap.bin", payload), /STORAGE_BLOB_ENDPOINT/);
  assert.equal(identity.credentialsCreated, 0);
  assert.deepEqual(storage.calls, []);
  const outputs = { STORAGE_BLOB_ENDPOINT: "https://unit.blob.core.windows.net/" };
  await uploadBootstrapBlob(live, outputs, "seed", "bootstrap.bin", payload);
  assert.equal(identity.credentialsCreated, 1);
  assert.deepEqual(storage.calls, [
    { operation: "client", endpoint: outputs.STORAGE_BLOB_ENDPOINT },
    { operation: "upload", containerName: "seed", blobName: "bootstrap.bin", contents: [1, 2, 3] },
  ]);
  storage.failNextUpload();
  await assert.rejects(uploadBootstrapBlob(live, outputs, "seed", "bootstrap.bin", payload), /Blob upload failed/);
});

test("documented service modules compile ordered layers and stop dependent deployment on failure", async (t) => {
  const skill = await readFile(resolve(root, skillSources[0], "SKILL.md"), "utf8");
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  assert.match(skill, /references\/direct-authoring\.md#service-modules-and-ordered-provisioning/);
  const guidance = reference.split("## Service modules and ordered provisioning\n")[1]?.split("## Deployment API\n")[0];
  assert.ok(guidance);
  for (const boundary of ["TypeScript service module", "Provisioning layer"]) assert.ok(guidance.includes(boundary));
  assert.match(guidance, /does not infer a service graph/);
  const blocks = [...guidance.matchAll(/```ts\n([\s\S]*?)```/g)].map(match => match[1]!);
  const program = blocks.find(block => block.includes("const sharedOutputs = await shared(deploy, target)"));
  const storage = blocks.find(block => block.includes("export async function storage("));
  assert.ok(program && storage);
  const consumer = await mkdtemp(join(tmpdir(), "iac-composer-service-example-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const deploymentDirectory = join(consumer, "deployment");
  await writeFile(join(consumer, "package.json"), '{"type":"module"}\n');
  await symlink(resolve(root, "examples/chatbot/node_modules"), join(consumer, "node_modules"), "dir");
  for (const service of ["shared", "storage", "api"]) {
    const directory = join(deploymentDirectory, "services", service);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "provisioning.ts"), `export const outputBicep = [
      { path: "main.bicep", contents: "targetScope = 'resourceGroup'\\n${service === "storage" ? "param subnetId string\\n" : ""}" },
      { path: "main.bicepparam", contents: "using './main.bicep'\\n${service === "storage" ? "param subnetId = readEnvironmentVariable('MODULE_SUBNET_ID')\\n" : ""}" }
    ];`);
    await writeFile(join(directory, "index.ts"), service === "storage" ? storage : `
import { fileURLToPath } from "node:url";
import { appendFile } from "node:fs/promises";
import type { Deployment, ProvisionOptions, ProvisionOutputs } from "iac-composer";
export async function ${service}(
  deploy: Deployment,
  target: Pick<ProvisionOptions, "scope" | "resourceGroup" | "subscription" | "location">,
  inputs: ProvisionOutputs = {},
): Promise<ProvisionOutputs> {
  const context = deploy.inDirectory(fileURLToPath(new URL(".", import.meta.url)));
  const outputs = await context.provision("${service} infrastructure", {
    ...target,
    layer: { entrypoint: "provisioning.ts", outputDirectory: fileURLToPath(new URL("../../.generated/${service}", import.meta.url)) },
  });
  ${service === "api" ? `await context.deploy("application", async () => {
    if (inputs.SUBNET_ID !== "unit-subnet" || !inputs.STORAGE_BLOB_ENDPOINT) throw new Error("Missing producer outputs.");
    await appendFile(process.env.IAC_TEST_EVENTS!, "application:" + inputs.STORAGE_BLOB_ENDPOINT + "\\n");
  });` : ""}
  return outputs;
}`);
  }
  await writeFile(join(deploymentDirectory, "deploy.ts"), program);
  await writeFile(join(deploymentDirectory, "bootstrap.ts"), `
import { appendFile } from "node:fs/promises";
import type { Deployment, ProvisionOutputs } from "iac-composer";
export async function uploadBootstrapBlob(deploy: Deployment, outputs: ProvisionOutputs, container: string, blob: string, contents: Uint8Array) {
  await deploy.deploy("upload bootstrap blob", async () => {
    if (!outputs.STORAGE_BLOB_ENDPOINT || container !== "inputs" || blob !== "bootstrap.bin" || contents.length !== 3) throw new Error("Invalid initialization.");
    await appendFile(process.env.IAC_TEST_EVENTS!, "initialize:" + outputs.STORAGE_BLOB_ENDPOINT + "\\n");
    if (process.env.IAC_TEST_FAIL_STAGE === "initialize") throw new Error("Initialization failed.");
  });
}`);
  await execFileAsync(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--skipLibCheck", "--types", "node",
    "--typeRoots", resolve(root, "node_modules/@types"),
    "deployment/deploy.ts", "deployment/services/storage/index.ts",
  ], { cwd: consumer });
  const bin = join(consumer, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "azd"), `#!/bin/sh
if [ "$1 $2" = "env new" ]; then
  mkdir -p ".azure/$3"
  printf '{}\\n' > ".azure/$3/config.json"
elif [ "$1 $2" = "env set" ]; then
  cat "$4" >> "$IAC_TEST_PARAMETERS"
elif [ "$1" = "provision" ]; then
  printf 'provision:%s\\n' "$2" >> "$IAC_TEST_EVENTS"
  if [ "$IAC_TEST_FAIL_STAGE" = "$2" ]; then exit 11; fi
  printf '%s' "$2" > .current-layer
elif [ "$1 $2" = "env get-values" ]; then
  if [ "$(cat .current-layer)" = "shared" ]; then
    printf 'SUBNET_ID="unit-subnet"\\n'
  else
    printf 'STORAGE_BLOB_ENDPOINT="https://unit.blob.core.windows.net/"\\n'
  fi
else
  exit 12
fi
`, { mode: 0o755 });
  const endpoint = "https://unit.blob.core.windows.net/";
  for (const mode of ["preview", "success", "initialize", "shared"]) {
    const eventsPath = join(consumer, `${mode}-events`);
    const parametersPath = join(consumer, `${mode}-parameters`);
    const reportPath = join(consumer, `${mode}-report.json`);
    await writeFile(eventsPath, "");
    const invocation = execFileAsync(process.execPath, [
      resolve(root, "dist/cli.js"), join(deploymentDirectory, "deploy.ts"),
      "-C", consumer, "--report", reportPath, ...(mode === "preview" ? ["--dry-run"] : []),
    ], {
      cwd: consumer,
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`,
        AZURE_RESOURCE_GROUP: "unit-existing-rg", AZURE_LOCATION: "eastus",
        AZURE_SUBSCRIPTION_ID: "11111111-2222-4333-8444-555555555555",
        IAC_TEST_EVENTS: eventsPath, IAC_TEST_PARAMETERS: parametersPath,
        IAC_TEST_FAIL_STAGE: mode,
      },
    });
    if (mode === "preview" || mode === "success") await invocation;
    else await assert.rejects(invocation, error => error instanceof Error && "code" in error && error.code === 1);
    const report: ExecutionReport = JSON.parse(await readFile(reportPath, "utf8"));
    const events = (await readFile(eventsPath, "utf8")).trim().split("\n").filter(Boolean);
    const allEvents = ["provision:shared", "provision:storage", `initialize:${endpoint}`, "provision:api", `application:${endpoint}`];
    assert.deepEqual(events, mode === "preview" ? [] : allEvents.slice(0, mode === "shared" ? 1 : mode === "initialize" ? 3 : 5));
    assert.equal(report.status, mode === "preview" || mode === "success" ? "succeeded" : "failed");
    if (mode === "preview" || mode === "success") {
      assert.deepEqual(report.steps.map(step => [step.name, step.status]), [
        ["shared infrastructure", mode === "preview" ? "previewed" : "succeeded"],
        ["validate storage prerequisites", mode === "preview" ? "skipped" : "succeeded"],
        ["storage infrastructure", mode === "preview" ? "previewed" : "succeeded"],
        ["upload bootstrap blob", mode === "preview" ? "skipped" : "succeeded"],
        ["api infrastructure", mode === "preview" ? "previewed" : "succeeded"],
        ["application", mode === "preview" ? "skipped" : "succeeded"],
      ]);
      assert.deepEqual(report.artifacts.map(({ layer, dependsOn }) => [layer, dependsOn]), [
        ["shared", []], ["storage", ["shared"]], ["api", ["storage"]],
      ]);
    } else {
      assert.equal(report.steps.at(-1)?.name, mode === "shared" ? "shared infrastructure" : "upload bootstrap blob");
      assert.equal(report.steps.at(-1)?.status, "failed");
    }
    if (mode === "success") assert.match(await readFile(parametersPath, "utf8"), /MODULE_SUBNET_ID="unit-subnet"/);
  }
});

test("the skill distinguishes released npm libraries from services requiring core Resource", async () => {
  const skill = await readFile(resolve(root, skillSources[0], "SKILL.md"), "utf8");
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  assert.match(skill, /references\/direct-authoring\.md#npmjs-release-status/);
  assert.match(skill, /For services verified as not yet released on npmjs, use/);
  assert.match(reference, /Checked \*\*\d{4}-\d{2}-\d{2}\*\* directly against/);
  const published = reference.split("### Published packages\n")[1]?.split("### Not yet published: use core Resource\n")[0];
  const unpublished = reference.split("### Not yet published: use core Resource\n")[1]?.split("### Refreshing the status\n")[0];
  assert.ok(published && unpublished);
  const releases = [...published.matchAll(/\[@azure\/provisioning-([a-z]+)\]\(https:\/\/www\.npmjs\.com\/package\/@azure\/provisioning-[a-z]+\) \| `(1\.0\.0-beta\.\d+)`/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(Object.fromEntries(releases), {
    core: "1.0.0-beta.2",
    appinsights: "1.0.0-beta.1",
    containerregistry: "1.0.0-beta.1",
    cognitiveservices: "1.0.0-beta.1",
    cosmosdb: "1.0.0-beta.1",
    eventhub: "1.0.0-beta.1",
    keyvault: "1.0.0-beta.2",
    operationalinsights: "1.0.0-beta.1",
    search: "1.0.0-beta.1",
    servicebus: "1.0.0-beta.1",
    sql: "1.0.0-beta.1",
    storage: "1.0.0-beta.1",
  });
  for (const service of [
    "appconfiguration", "appservice", "authorization", "botservice", "compute",
    "appcontainers", "containerapps", "containerservice", "logic",
    "managed-identity", "monitor", "network",
  ]) {
    assert.ok(unpublished.includes(`\`@azure/provisioning-${service}\``), service);
  }
  assert.match(unpublished, /core fallback scenario/);
  assert.match(unpublished, /\*\*replaced by core\*\*/);
  assert.match(reference, /authentication\s+failure, registry override, timeout, or network error does not establish\s+unpublished status/);
  assert.match(published, /Do not blindly select `latest`/);
});

test("documented resources, scoped RBAC, fractional values and core fallback typecheck and compile in a CLI dry run", async (t) => {
  const consumer = await mkdtemp(join(tmpdir(), "iac-composer-authoring-contract-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  const blocks = [...reference.matchAll(/```ts\n([\s\S]*?)```/g)].map(match => match[1]!);
  const program = blocks.find(block => block.includes("const coreLayer"));
  const directProgram = blocks.find(block => block.includes('import stack from "./infra.js"'));
  const resources = blocks.find(block => block.includes("new StorageAccount"));
  const fallback = blocks.find(block => block.includes("new Resource(stack"));
  const fractional = blocks.find(block => block.includes("const containerResources"));
  const roleAssignment = blocks.find(block => block.includes("const blobReaderRoleId"));
  assert.ok(program && directProgram && resources && fallback && fractional && roleAssignment);
  const fractionalResource = `
${fractional.replace('import { fn } from "@azure/provisioning-core";', "")}
new Resource(stack, {
  type: "Microsoft.App/containerApps",
  apiVersion: "2025-07-01",
  name: "fractional-cpu-contract",
  location,
  properties: {
    template: {
      containers: [{
        name: "chat",
        image: "example.invalid/chat:unit",
        resources: containerResources,
      }],
    },
  },
});
`;
  const provisioning = resources.replace("export default stack;", `
${fallback}
${fractionalResource}
${roleAssignment.replace('import { Resource } from "@azure/provisioning-core";', "")}
export default stack;
`);
  const directory = join(consumer, "deployment");
  await mkdir(directory);
  await writeFile(join(directory, "deploy.ts"), program);
  await writeFile(join(directory, "direct.ts"), directProgram);
  await writeFile(join(directory, "infra.ts"), provisioning);
  const example = object(JSON.parse(await readFile(resolve(root, "examples/chatbot/package.json"), "utf8")));
  const dependencies = object(example.dependencies);
  const scriptsBlock = [...reference.matchAll(/```json\n([\s\S]*?)```/g)]
    .map(match => match[1]!).find(block => block.includes('"preview"'));
  assert.ok(scriptsBlock);
  const scripts = object(JSON.parse(scriptsBlock)).scripts;
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "unit-iac-authoring-contract", private: true, type: "module", scripts,
    dependencies: {
      "iac-composer": `file:${root}`,
      "@azure/provisioning-core": dependencies["@azure/provisioning-core"],
      "@azure/provisioning-storage": dependencies["@azure/provisioning-storage"],
      "@azure/provisioning-search": dependencies["@azure/provisioning-search"],
    },
  }));
  await symlink(resolve(root, "examples/chatbot/node_modules"), join(consumer, "node_modules"), "dir");
  await execFileAsync(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--skipLibCheck", "--types", "node", "--typeRoots", resolve(root, "node_modules/@types"),
    "deployment/deploy.ts", "deployment/direct.ts", "deployment/infra.ts",
  ], { cwd: consumer });
  const bin = join(consumer, "bin"), marker = join(consumer, "unexpected-cloud-command");
  await mkdir(bin);
  for (const command of ["az", "azd"]) {
    await writeFile(join(bin, command), `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)},"unexpected");process.exitCode=1;\n`, { mode: 0o755 });
  }
  const reportPath = join(consumer, "preview.json");
  await execFileAsync("npm", ["run", "deploy", "--", "--dry-run", "--report", reportPath], {
    cwd: consumer,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`,
      AZURE_LOCATION: "eastus", AZURE_RESOURCE_GROUP: "unit-existing-rg",
      AZURE_SUBSCRIPTION_ID: "11111111-2222-4333-8444-555555555555",
    },
  });
  const report: ExecutionReport = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.status, "succeeded");
  assert.equal(report.dryRun, true);
  assert.ok(report.steps.some(step => step.kind === "provision" && step.status === "previewed"));
  assert.equal(report.artifacts.length, 1);
  const generated = await readFile(report.artifacts[0]!.templateFile, "utf8");
  assert.match(generated, /Microsoft\.Storage\/storageAccounts@/);
  assert.match(generated, /Microsoft\.Network\/virtualNetworks@2024-05-01/);
  assert.match(generated, /Microsoft\.App\/containerApps@2025-07-01/);
  assert.match(generated, /cpu:\s*json\('0\.25'\)/);
  assert.match(generated, /output NETWORK_ID string/);
  assert.match(generated, /output STORAGE_ACCOUNT_NAME string/);
  const grant = generated.match(
    /resource \w+ 'Microsoft\.Authorization\/roleAssignments@2022-04-01' = \{[\s\S]*?^\}/m,
  )?.[0];
  assert.ok(grant);
  assert.match(grant, /scope: container/);
  assert.match(grant, /principalId: searchService\.identity\.principalId/);
  assert.match(grant, /principalType: 'ServicePrincipal'/);
  assert.match(grant, /name: guid\(container\.id, searchService\.identity\.principalId, subscriptionResourceId\(/);
  assert.match(grant, /2a2b9908-6ea1-4ae2-8e65-a410df84e7d1/);
  assert.doesNotMatch(grant, /scope: resourceGroup|clientId|appId/);
  assert.match(generated, /resource searchService 'Microsoft\.Search\/searchServices@/);
  assert.match(generated, /type: 'SystemAssigned'/);
  assert.match(generated, /output SEARCH_PRINCIPAL_ID string = searchService\.identity\.principalId/);
  await execFileAsync(process.execPath, [
    resolve(root, "dist/cli.js"), "deployment/direct.ts", "--dry-run", "--report", reportPath,
  ], {
    cwd: consumer,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`,
      AZURE_LOCATION: "eastus", AZURE_RESOURCE_GROUP: "unit-existing-rg",
      AZURE_SUBSCRIPTION_ID: "11111111-2222-4333-8444-555555555555",
    },
  });
  const directReport: ExecutionReport = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(directReport.status, "succeeded");
  assert.deepEqual(directReport.steps.map(step => [step.kind, step.status]), [
    ["provision", "previewed"], ["env", "skipped"],
  ]);
  assert.equal(await readFile(directReport.artifacts[0]!.templateFile, "utf8"), generated);
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("actual runtime package owns its skill and local consumer setup without MCP or a planner package", async () => {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { cwd: root });
  const packed: unknown = JSON.parse(stdout);
  assert.ok(Array.isArray(packed) && packed.length === 1);
  const files = object(packed[0]).files;
  assert.ok(Array.isArray(files));
  const paths = files.map((entry) => object(entry).path);
  assert.ok(paths.includes(".github/skills/iac-composer/SKILL.md"));
  assert.ok(paths.includes(".github/skills/iac-composer/references/direct-authoring.md"));
  assert.equal(paths.includes(".github/skills/iac-composer/references/api-contracts.md"), false);
  assert.ok(paths.includes("dist/discovery.js"));
  assert.ok(paths.every(path => typeof path === "string" &&
    !path.startsWith("dist/mcp/") && !path.startsWith("agent-setup/profiles/")));
  assert.ok(paths.includes("agent-setup/AGENTS.md.template"));
  const manifest = object(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  assert.equal(Object.hasOwn(object(manifest.dependencies), "azure-infrastructure"), false);
  assert.deepEqual(manifest.bin, { "iac-composer": "dist/cli.js" });
});

test("the canonical implementation skill installs alone in a consumer workspace", async (t) => {
  try {
    await execFileAsync("gh", ["skill", "install", "--help"]);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      t.skip("GitHub CLI is not installed; no real installation was verified.");
      return;
    }
    throw error;
  }
  const consumer = await mkdtemp(join(tmpdir(), "iac-composer-skill-install-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  await execFileAsync("git", ["init", "--quiet", consumer]);
  await mkdir(join(consumer, "gh-config"));
  for (const source of skillSources) {
    await execFileAsync("gh", [
      "skill", "install", root, basename(source),
      "--from-local", "--agent", "codex", "--scope", "project", "--allow-hidden-dirs",
    ], {
      cwd: consumer,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_CONFIG_DIR: join(consumer, "gh-config") },
    });
    const installed = join(consumer, ".agents/skills", basename(source));
    await validateSkill(installed);
    const body = (contents: string) => contents.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    assert.equal(body(await readFile(join(installed, "SKILL.md"), "utf8")),
      body(await readFile(join(root, source, "SKILL.md"), "utf8")));
  }
  for (const duplicate of [".github/skills", ".claude/skills"]) {
    await assert.rejects(access(join(consumer, duplicate)), { code: "ENOENT" });
  }
  await assert.rejects(access(join(consumer, ".agents/skills/azure-infrastructure-intent")), { code: "ENOENT" });
});
