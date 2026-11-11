import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { IacComposerError } from "./diagnostics.js";
import {
  isProvisioningStack,
  renderProvisioningStack,
  validateProvisioningSettings,
} from "./provisioning.js";
import { importTypeScript } from "./typescript-loader.js";

interface RenderedFile {
  path: string;
  contents: string;
}

function validateRenderedFiles(
  outputDirectory: string,
  files: readonly RenderedFile[],
  requiredFiles: readonly string[],
): void {
  const paths = new Set<string>();
  for (const file of files) {
    const path = resolveOutputPath(outputDirectory, file.path);
    if (paths.has(path)) {
      throw new IacComposerError({
        code: "ARTIFACT_PATH_DUPLICATE",
        category: "artifact",
        message: `Provisioning produced duplicate output path '${file.path}'.`,
        target: file.path,
        property: "outputBicep.path",
        repair: "Emit each normalized file path only once.",
      });
    }
    paths.add(path);
  }
  for (const path of paths) {
    let parent = dirname(path);
    while (parent !== outputDirectory) {
      if (paths.has(parent)) {
        throw new IacComposerError({
          code: "ARTIFACT_PATH_CONFLICT",
          category: "artifact",
          message: `Provisioning output '${parent}' is both a file and a directory.`,
          target: parent,
          property: "outputBicep.path",
          repair: "Rename the conflicting file or place nested files in a different directory.",
        });
      }
      parent = dirname(parent);
    }
  }
  for (const file of requiredFiles) {
    if (!paths.has(resolveOutputPath(outputDirectory, file))) {
      throw new IacComposerError({
        code: "ARTIFACT_REQUIRED",
        category: "artifact",
        message: `Provisioning did not emit required artifact '${file}'.`,
        target: file,
        expected: "The selected templateFile and parametersFile must exist in the rendered output.",
        repair: "Emit this file from the provisioning source, or set templateFile/parametersFile to an emitted path.",
      });
    }
  }
}

export async function compileProvisioning(
  entrypoint: string,
  outputDirectory: string,
  generatedFilesRoot = outputDirectory,
  requiredFiles: readonly string[] = [],
  parameters: Readonly<Record<string, string | number | boolean>> = {},
): Promise<void> {
  const resolvedEntrypoint = resolve(entrypoint);
  let module: Record<string, unknown>;
  try {
    module = (await importTypeScript(
      pathToFileURL(resolvedEntrypoint).href,
    )) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof IacComposerError) throw error;
    throw new IacComposerError({
      code: "PROVISIONING_LOAD_FAILED",
      category: "compilation",
      message: `Could not load provisioning entrypoint '${resolvedEntrypoint}'.`,
      target: resolvedEntrypoint,
      repair: "Check the entrypoint path, syntax, package module type, and provisioning library dependencies; run the project's typecheck.",
    }, { cause: error, message: error instanceof Error ? error.message : String(error) });
  }
  const stack = module.default;
  if (isProvisioningStack(stack) && module.outputBicep !== undefined) {
    throw new IacComposerError({
      code: "PROVISIONING_SOURCE_CONFLICT", category: "configuration",
      message: "A provisioning module cannot export both a stack definition and rendered files.",
      target: resolvedEntrypoint,
      repair: "Default-export a Stack or use the legacy rendered-file export, not both.",
    });
  }
  let files: readonly RenderedFile[];
  try {
    if (isProvisioningStack(stack)) {
      validateProvisioningSettings(module);
      files = await renderProvisioningStack(stack, resolvedEntrypoint, requiredFiles, parameters, module);
    } else if (stack !== undefined && !(typeof stack === "object" && stack !== null && "outputBicep" in stack)) {
      throw new IacComposerError({
        code: "PROVISIONING_DEFINITION_INVALID", category: "configuration",
        message: "A provisioning entrypoint must default-export a Stack.",
        target: resolvedEntrypoint,
        repair: "Export the Stack directly and use named parameterBindings, parameterVariables, or graphResources exports for optional settings.",
      });
    } else {
      files = resolveRenderedFiles(module, resolvedEntrypoint);
    }
  } catch (cause) {
    if (cause instanceof IacComposerError) throw cause;
    throw new IacComposerError({
      code: "PROVISIONING_COMPILE_FAILED", category: "compilation",
      message: `Could not compile provisioning entrypoint '${resolvedEntrypoint}'.`,
      target: resolvedEntrypoint,
      repair: "Check the authored resource definitions and installed provisioning-core compatibility.",
    }, { cause, message: cause instanceof Error ? cause.message : String(cause) });
  }

  await installRenderedFiles(outputDirectory, files, generatedFilesRoot, requiredFiles);
}

export async function copyProvisioningArtifacts(
  artifactsDirectory: string,
  outputDirectory: string,
  generatedFilesRoot = outputDirectory,
  requiredFiles: readonly string[] = [],
): Promise<void> {
  const files = await readRenderedDirectory(artifactsDirectory);
  if (files.length === 0) {
    throw new IacComposerError({
      code: "ARTIFACTS_EMPTY",
      category: "artifact",
      message: `Provisioning compiler produced no files in '${artifactsDirectory}'.`,
      target: artifactsDirectory,
      repair: "Configure the compiler to emit Bicep artifacts into artifactsDirectory.",
    });
  }
  await installRenderedFiles(outputDirectory, files, generatedFilesRoot, requiredFiles);
}

export async function installRenderedFiles(
  outputDirectory: string,
  files: readonly RenderedFile[],
  generatedFilesRoot: string,
  requiredFiles: readonly string[],
): Promise<void> {
  outputDirectory = resolve(outputDirectory);
  generatedFilesRoot = resolve(generatedFilesRoot);
  validateRenderedFiles(outputDirectory, files, requiredFiles);
  relativeGeneratedPath(generatedFilesRoot, outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(generatedFilesRoot, { recursive: true });
  await rejectLegacyGeneratedManifest(
    resolve(generatedFilesRoot, ".deploy-js-generated.json"),
  );
  const manifestPath = resolve(generatedFilesRoot, ".iac-composer-generated.json");
  const previousManifestPath = resolve(generatedFilesRoot, ".iac-compose-generated.json");
  const generatedPaths = new Set([
    ...(await readGeneratedManifest(previousManifestPath)),
    ...(await readGeneratedManifest(manifestPath)),
  ]);
  let migratedLayerManifests: string[] = [];
  if (generatedFilesRoot !== outputDirectory) {
    migratedLayerManifests = await migrateLayerGeneratedManifests(
      generatedFilesRoot,
      generatedPaths,
    );
  }
  for (const generatedPath of generatedPaths) {
    resolveOutputPath(generatedFilesRoot, generatedPath);
  }

  const outputPrefix = relativeGeneratedPath(generatedFilesRoot, outputDirectory);
  const scopedPrefix = outputPrefix ? `${outputPrefix}/` : "";
  for (const generatedPath of [...generatedPaths]) {
    if (scopedPrefix && !generatedPath.startsWith(scopedPrefix)) continue;
    await rm(resolveOutputPath(generatedFilesRoot, generatedPath), { force: true });
    generatedPaths.delete(generatedPath);
  }
  await Promise.all(
    files.map(async (file) => {
      const outputPath = resolveOutputPath(outputDirectory, file.path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, file.contents);
    }),
  );
  for (const file of files) {
    generatedPaths.add(
      relativeGeneratedPath(
        generatedFilesRoot,
        resolveOutputPath(outputDirectory, file.path),
      ),
    );
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify([...generatedPaths].sort(), null, 2)}\n`,
  );
  await Promise.all(
    [previousManifestPath, ...migratedLayerManifests].map((path) =>
      rm(path, { force: true }),
    ),
  );
}

async function migrateLayerGeneratedManifests(
  generatedFilesRoot: string,
  generatedPaths: Set<string>,
): Promise<string[]> {
  const migratedManifests: string[] = [];
  for (const entry of await readdir(generatedFilesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const layerDirectory = resolve(generatedFilesRoot, entry.name);
    await rejectLegacyGeneratedManifest(
      resolve(layerDirectory, ".deploy-js-generated.json"),
    );
    const manifestPath = resolve(layerDirectory, ".iac-composer-generated.json");
    const previousManifestPath = resolve(layerDirectory, ".iac-compose-generated.json");
    const layerPaths = [
      ...(await readGeneratedManifest(previousManifestPath)),
      ...(await readGeneratedManifest(manifestPath)),
    ];
    for (const generatedPath of layerPaths) {
      generatedPaths.add(
        relativeGeneratedPath(
          generatedFilesRoot,
          resolveOutputPath(layerDirectory, generatedPath),
        ),
      );
    }
    migratedManifests.push(previousManifestPath, manifestPath);
  }
  return migratedManifests;
}

export async function defaultProvisioningDirectory(projectDirectory: string): Promise<string> {
  const previousRoot = resolve(projectDirectory, ".iac-compose");
  const previous = resolve(previousRoot, "infra");
  const current = resolve(projectDirectory, ".iac-composer", "infra");
  try {
    await readdir(previous);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return current;
    throw error;
  }
  try {
    await readdir(current);
    throw new Error(
      "Both .iac-compose/infra and .iac-composer/infra exist. " +
        "Specify outputDirectory explicitly to select the provisioning state.",
    );
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(current), { recursive: true });
  await rename(previous, current);
  if ((await readdir(previousRoot)).length === 0) {
    await rmdir(previousRoot);
  }
  return current;
}

async function rejectLegacyGeneratedManifest(path: string): Promise<void> {
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `Legacy deploy-js generated output detected at '${path}'. ` +
      "Remove the generated output directory and rerun iac-composer.",
  );
}

function relativeGeneratedPath(root: string, path: string): string {
  const generatedPath = relative(root, path);
  if (
    isAbsolute(generatedPath) ||
    generatedPath === ".." ||
    generatedPath.startsWith(`..${sep}`)
  ) {
    throw new Error(`Generated provisioning output '${path}' must be inside '${root}'.`);
  }
  return generatedPath.split(sep).join("/");
}

async function readRenderedDirectory(
  directory: string,
  root = directory,
): Promise<RenderedFile[]> {
  const files: RenderedFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readRenderedDirectory(path, root)));
    } else if (entry.isFile()) {
      files.push({
        path: relative(root, path),
        contents: await readFile(path, "utf8"),
      });
    }
  }
  return files;
}

async function readGeneratedManifest(manifestPath: string): Promise<readonly string[]> {
  try {
    const value: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error(`Invalid generated-file manifest: ${manifestPath}`);
    }
    return value;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function resolveOutputPath(outputDirectory: string, filePath: string): string {
  const outputPath = resolve(outputDirectory, filePath);
  const relativePath = relative(outputDirectory, outputPath);
  if (
    !filePath.trim() ||
    isAbsolute(filePath) ||
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new IacComposerError({
      code: "ARTIFACT_PATH_INVALID",
      category: "artifact",
      message: `Provisioning output escapes its directory or has an invalid path: ${filePath}`,
      target: filePath,
      property: "outputBicep.path",
      expected: "A non-empty relative file path inside the output directory.",
      repair: "Correct the authored output path; do not modify generated artifacts.",
    });
  }
  return outputPath;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function resolveRenderedFiles(
  module: Record<string, unknown>,
  entrypoint: string,
): readonly RenderedFile[] {
  const defaultExport = module.default;
  const files =
    module.outputBicep ??
    (typeof defaultExport === "object" && defaultExport !== null
      ? (defaultExport as Record<string, unknown>).outputBicep
      : undefined);
  if (!Array.isArray(files) || files.length === 0 || !files.every(isRenderedFile)) {
    throw new IacComposerError({
      code: "OUTPUT_BICEP_INVALID",
      category: "compilation",
      message: `Provisioning entrypoint '${entrypoint}' must export a non-empty outputBicep array.`,
      target: entrypoint,
      property: "outputBicep",
      expected: "A non-empty array of { path: string, contents: string }.",
      repair: "Export rendered Bicep files as outputBicep from the provisioning entrypoint.",
    });
  }
  return files;
}

function isRenderedFile(value: unknown): value is RenderedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "contents" in value &&
    typeof value.contents === "string"
  );
}

export async function collectBicepEnvironmentValues(
  parametersFile: string,
  overrides: Readonly<Record<string, string | number | boolean>> = {},
): Promise<Record<string, string | undefined>> {
  if (extname(parametersFile) !== ".bicepparam") {
    if (Object.keys(overrides).length > 0) {
      throw new IacComposerError({
        code: "PARAMETER_FILE_UNSUPPORTED",
        category: "configuration",
        message: "Provisioning parameter overrides require a .bicepparam file.",
        target: parametersFile,
        property: "parametersFile",
        repair: "Use a .bicepparam file for parameter overrides.",
      });
    }
    return {};
  }
  const source = await readFile(parametersFile, "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(/readEnvironmentVariable\(\s*'([^']+)'/g)) {
    if (match[1]) names.add(match[1]);
  }
  const values: Record<string, string | undefined> = Object.fromEntries(
    [...names].map((name) => [name, process.env[name]]),
  );
  for (const [parameterName, parameterValue] of Object.entries(overrides)) {
    const escapedName = parameterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const binding = new RegExp(
      `^\\s*param\\s+${escapedName}(?:\\s+[^=\\r\\n]+)?\\s*=\\s*` +
        "(?:(?:bool|int|json)\\(\\s*)?readEnvironmentVariable\\(\\s*'([^']+)'",
      "m",
    ).exec(source);
    const environmentName = binding?.[1];
    if (!environmentName) {
      throw new IacComposerError({
        code: "PARAMETER_BINDING_REQUIRED",
        category: "configuration",
        message: `Parameter '${parameterName}' must bind to readEnvironmentVariable(), optionally converted with bool/int/json, for a provisioning override.`,
        target: parametersFile,
        property: `parameters.${parameterName}`,
        repair: "Use a stack definition's generated binding, an environment binding with an optional bool/int/json conversion, or remove the override.",
      });
    }
    values[environmentName] = String(parameterValue);
  }
  return values;
}
