import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const setup = resolve("agent-setup");

test("runtime setup uses the skill and local APIs without MCP assets or dependencies", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.deepEqual(manifest.bin, { "iac-composer": "dist/cli.js" });
  for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
    assert.equal(Object.keys(dependencies).some(name => name.startsWith("@modelcontextprotocol/")), false);
  }
  for (const path of ["src/mcp", "dist/mcp", "agent-setup/profiles"]) {
    await assert.rejects(access(path), { code: "ENOENT" });
  }
});

test("the routing block is conditional, shared and not automatically installed in the producer", async () => {
  const [policy, bridge, instructions] = await Promise.all([
    readFile(resolve(setup, "AGENTS.md.template"), "utf8"),
    readFile(resolve(setup, "CLAUDE.md.template"), "utf8"),
    readFile(resolve(setup, "README.md"), "utf8"),
  ]);
  assert.match(policy, /existing[\s\S]*Terraform, Bicep, azd/);
  assert.match(policy, /Advice-only and plan-only/);
  assert.match(policy, /Use one route/);
  assert.match(policy, /\.agents\/skills\/iac-composer\/SKILL\.md/);
  assert.match(policy, /any planner or the user/);
  assert.doesNotMatch(policy, /azure-infrastructure-intent|azure_infrastructure_generate/);
  assert.equal(bridge.trim(), "@AGENTS.md");
  assert.match(instructions, /Do not replace an existing instruction file/);
  assert.match(instructions, /No MCP server registration/);
  assert.doesNotMatch(instructions, /gh skill install qiaozha\/iac-compose\s/);
  assert.doesNotMatch(instructions, /--scope user|--dangerously/);
});

test("selection fixtures include positive, precedence and unrelated cases without fabricated results", async () => {
  const matrix = JSON.parse(await readFile(resolve(setup, "evaluation/cases.json"), "utf8"));
  assert.equal(matrix.schemaVersion, "1.0");
  assert.equal(new Set(matrix.cases.map((entry: { id: string }) => entry.id)).size, matrix.cases.length);
  for (const id of ["generic-api", "complete-plan", "explicit-composer", "explicit-composer-bootstrap", "missing-service-library", "plan-only", "explicit-terraform", "existing-azd", "non-azure", "ordinary-code"]) {
    assert.ok(matrix.cases.some((entry: { id: string }) => entry.id === id));
  }
  for (const entry of matrix.cases) {
    if (entry.selectionMode === "explicit") {
      assert.match(entry.prompt, /iac-composer/);
      assert.equal(entry.expectedRoute, "typescript-implementation");
    } else {
      assert.doesNotMatch(entry.prompt, /iac-composer|azure-infrastructure|get_context/);
    }
  }
  const recorded = JSON.parse(await readFile(resolve(setup, "evaluation/result.template.json"), "utf8"));
  assert.equal(recorded.status, "not-executed");
  assert.equal(recorded.availability, null);
  assert.equal(recorded.agentToolCallsBeforeSelection, null);
  assert.deepEqual(recorded.evidence, []);
});
