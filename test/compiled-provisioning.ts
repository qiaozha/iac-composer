import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { compileProvisioning } from "../src/index.js";

export async function compiledProvisioning(entrypoint: string) {
  const output = await mkdtemp(join(tmpdir(), "iac-compiled-test-"));
  try {
    await compileProvisioning(resolve(entrypoint), output);
    const files: { path: string; contents: string }[] = [];
    for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.bicep(?:param)?$/.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      files.push({ path: relative(output, path).replaceAll("\\", "/"), contents: await readFile(path, "utf8") });
    }
    return files;
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}
