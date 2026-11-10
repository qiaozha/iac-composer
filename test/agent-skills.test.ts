import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";
import { describeRuntimeCapabilities, type ExecutionReport } from "../src/index.js";

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
  assert.doesNotMatch(String(runtime.description), /\bSDKs?\b/);
  const skill = await readFile(resolve(root, skillSources[0], "SKILL.md"), "utf8");
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  assert.match(skill, /fn\.json\("0\.25"\)/);
  assert.match(skill, /Retain authored deployment code, generated Bicep, parameters and configuration/);
  assert.match(skill, /deployment\/history\/attempt-N\//);
  assert.match(reference, /Typechecking\s+alone does not catch this serialization error/);
  for (const contents of [skill, reference]) {
    assert.doesNotMatch(contents, /(?<!management[- ])\bSDKs?\b/);
  }
  assert.doesNotMatch(String(runtime.description), /azure-infrastructure-intent|already exists/);
  assert.equal(typeof describeRuntimeCapabilities("overview"), "object");
});

test("documented provisioning library resources, fractional values and core Resource fallback typecheck and compile in a real CLI dry run", async (t) => {
  const consumer = await mkdtemp(join(tmpdir(), "iac-composer-authoring-contract-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const reference = await readFile(resolve(root, skillSources[0], "references/direct-authoring.md"), "utf8");
  const blocks = [...reference.matchAll(/```ts\n([\s\S]*?)```/g)].map(match => match[1]!);
  const program = blocks.find(block => block.includes("const coreLayer"));
  const resources = blocks.find(block => block.includes("new StorageAccount"));
  const fallback = blocks.find(block => block.includes("new Resource(stack"));
  const fractional = blocks.find(block => block.includes("const containerResources"));
  assert.ok(program && resources && fallback && fractional);
  assert.ok(resources.includes("export const outputJson"));
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
  const provisioning = resources.replace("export const outputJson", `${fallback}\n${fractionalResource}\nexport const outputJson`);
  const directory = join(consumer, "deployment");
  await mkdir(directory);
  await writeFile(join(directory, "deploy.ts"), program);
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
    },
  }));
  await symlink(resolve(root, "examples/chatbot/node_modules"), join(consumer, "node_modules"), "dir");
  await execFileAsync(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--skipLibCheck", "--types", "node", "--typeRoots", resolve(root, "node_modules/@types"),
    "deployment/deploy.ts", "deployment/infra.ts",
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
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("actual runtime package owns its skill, MCP and consumer setup without a planner package", async () => {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { cwd: root });
  const packed: unknown = JSON.parse(stdout);
  assert.ok(Array.isArray(packed) && packed.length === 1);
  const files = object(packed[0]).files;
  assert.ok(Array.isArray(files));
  const paths = files.map((entry) => object(entry).path);
  assert.ok(paths.includes(".github/skills/iac-composer/SKILL.md"));
  assert.ok(paths.includes(".github/skills/iac-composer/references/direct-authoring.md"));
  assert.ok(paths.includes("dist/discovery.js"));
  assert.ok(paths.includes("dist/mcp/cli.js"));
  assert.ok(paths.includes("agent-setup/AGENTS.md.template"));
  const manifest = object(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  assert.equal(Object.hasOwn(object(manifest.dependencies), "azure-infrastructure"), false);
  assert.equal(object(manifest.bin)["iac-composer-mcp"], "dist/mcp/cli.js");
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
