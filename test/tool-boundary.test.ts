import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { access, readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import ts from "typescript";
import * as runtime from "../src/index.js";
import { createDeployment, defineDeployment, Deployment } from "../src/deployment.js";

const execFileAsync = promisify(execFile);
const cli = resolve("dist/cli.js");

test("public entrypoint contains only explicit reexports from owning modules", async () => {
  const source = ts.createSourceFile("index.ts", await readFile("src/index.ts", "utf8"), ts.ScriptTarget.Latest, true);
  assert.ok(source.statements.length > 0);
  for (const statement of source.statements) {
    assert.ok(ts.isExportDeclaration(statement));
    assert.ok(statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier));
    assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause));
  }
  assert.equal(runtime.Deployment, Deployment);
  assert.equal(runtime.createDeployment, createDeployment);
  assert.equal(runtime.defineDeployment, defineDeployment);
});

test("exports execution primitives without planning or source generation", () => {
  assert.equal(typeof runtime.defineDeployment, "function");
  assert.equal(typeof runtime.createDeployment, "function");
  for (const name of [
    "compileProvisioning",
    "ensureDeploymentPrincipalRoles",
    "getActiveHostedAgentVersion",
    "deployHostedAgentService",
    "getApiConnectionStatus",
    "requireApiConnectionAuthorization",
    "setAppConfigurationKeyValues",
    "parseHostedAgentVersion",
    "waitForHostedAgentVersion",
    "generateDeploymentCode",
    "loadResourceRequirements",
    "renderResourceRequirements",
    "fetchAzureArchitectureCatalog",
    "planResourceValidation",
    "validateResourceRequirements",
    "deployResourceComponent",
    "prepareResourceRequirements",
    "resolveOutputBindings",
    "createHostedAgentManifest",
    "enableWorkflowDeployment",
    "prepareAuthorizedConnection",
    "provisionTeamsApplication",
    "teamsEnvironmentName",
    "validateWorkflowParameters",
  ]) {
    assert.equal(Object.hasOwn(runtime, name), false, name);
  }
});

test("public declarations do not expose the internal compiler", async () => {
  const declarations = await readFile("dist/index.d.ts", "utf8");
  assert.doesNotMatch(declarations, /\bcompileProvisioning\b/);
});

test("runtime source and declarations contain no resource contracts or contract adapters", async () => {
  for (const directory of ["src", "dist"]) {
    const entries = await readdir(directory, { recursive: true });
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;
      const source = await readFile(resolve(directory, entry), "utf8");
      assert.doesNotMatch(
        source,
        /ResourceContract|DeployResourceComponentOptions|deployResourceComponent|prepareResourceRequirements|resolveOutputBindings|shared\/contracts|runtime\/resources|runtime\/providers|provisionTeamsApplication|enableWorkflowDeployment|HostedAgentService|ensureDeploymentPrincipalRoles|getApiConnectionStatus/,
        entry,
      );
    }
  }
});

test("runtime package has no provider source, build output or public subpaths", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  for (const directory of ["src/runtime/providers", "dist/runtime/providers"]) {
    await assert.rejects(access(directory), { code: "ENOENT" });
  }
  for (const name of [
    "microsoft-cognitiveservices",
    "microsoft-web",
    "microsoft-authorization",
    "microsoft-appconfiguration",
  ]) {
    await assert.rejects(
      import(`iac-composer/providers/${name}`),
      { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
    );
  }
});

test("runtime CLI exposes execution and directs retired commands to the separate tool", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cli, "--help"]);
  assert.match(stdout, /iac-composer <deployment.ts>/);
  assert.match(stdout, /iac-composer down/);
  assert.doesNotMatch(stdout, /iac-composer (generate|validate|architecture-catalog)/);
  for (const command of ["generate", "validate", "architecture-catalog"]) {
    await assert.rejects(
      execFileAsync(process.execPath, [cli, command]),
      new RegExp(`'${command}' belongs to the separate azure-infrastructure tool`),
    );
  }
});
