import { dirname, posix, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Expression,
  ExpressionOrValue,
  Resource,
  ResourceDeclaration,
  ParameterMetadata,
  Stack,
  VariableValue,
  Variable,
} from "@azure/provisioning-core";
import type { RenderedBicepFile } from "@azure/provisioning-core/internal";
import { IacComposerError } from "./diagnostics.js";
import { importProjectModule } from "./typescript-loader.js";

type CoreRuntime = Pick<
  typeof import("@azure/provisioning-core/internal"),
  "renderBicepFiles" | "wrapExpression" | "unwrapExpression"
> & Pick<typeof import("@azure/provisioning-core"), "isExpression">;

export interface GraphResourceDefinition {
  readonly identifier: string;
  readonly type: string;
  readonly body: Readonly<Record<string, VariableValue>>;
  readonly condition?: ExpressionOrValue<boolean>;
}

export type ParameterVariables<T extends Readonly<Record<string, VariableValue>>> = {
  readonly [K in keyof T]: Variable<T[K]>;
};

export interface GraphResourceHandle {
  readonly id: Expression<string>;
}

export interface GraphIdentityHandle extends GraphResourceHandle {
  readonly appId: Expression<string>;
}

interface GraphResourceBodies {
  "Microsoft.Graph/applications": Readonly<Record<string, VariableValue>> & {
    readonly uniqueName: ExpressionOrValue<string>;
  };
  "Microsoft.Graph/servicePrincipals": Readonly<Record<string, VariableValue>> & {
    readonly appId: ExpressionOrValue<string>;
  };
  "Microsoft.Graph/appRoleAssignedTo": Readonly<Record<string, VariableValue>> & {
    readonly appRoleId: ExpressionOrValue<string>;
    readonly principalId: ExpressionOrValue<string>;
    readonly resourceId: ExpressionOrValue<string>;
  };
}

export type GraphResourceType = keyof GraphResourceBodies;
export type GraphResourceInput<T extends GraphResourceType> =
  Omit<GraphResourceDefinition, "type" | "body"> & {
    readonly type: T;
    readonly body: GraphResourceBodies[T];
    readonly dependsOn?: readonly GraphResourceHandle[];
  };

export interface ResourceLoopOptions<TItem> {
  readonly itemVariable: string;
  readonly batchSize?: number;
  create(item: Expression<TItem>): Resource;
}

export interface ProvisioningSettings {
  readonly parameterBindings?: Readonly<Record<string, VariableValue>>;
  readonly parameterVariables?: Readonly<Record<string, VariableValue>>;
  readonly graphResources?: readonly GraphResourceDefinition[];
}

interface ResourceLoop {
  resource: Resource;
  collection: VariableValue;
  itemVariable: string;
  batchSize: number;
}

const resourceLoops = new WeakMap<Stack, ResourceLoop[]>();
const parameterVariables = new WeakMap<Stack, Map<string, VariableValue>>();
const registeredGraphResources = new WeakMap<Stack, GraphResourceDefinition[]>();
const graphHandles = new WeakMap<GraphResourceHandle, {
  stack: Stack;
  reference: Expression<{ id: string; appId: string }>;
}>();

export function createParameterVariables<T extends Readonly<Record<string, VariableValue>>>(
  stack: Stack,
  values: T,
): ParameterVariables<T> {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw provisioningError("PROVISIONING_DEFINITION_INVALID", "parameterVariables", "Parameter variables must be a named value map.");
  }
  const entries = Object.entries(values);
  const existing = parameterVariables.get(stack) ?? new Map<string, VariableValue>();
  const names = new Set<string>();
  for (const [name] of entries) {
    assertReferenceNameAvailable(stack, name);
    if (names.has(name.toLowerCase())) {
      throw provisioningError("PROVISIONING_REFERENCE_CONFLICT", name, "Reference names must be unique regardless of case.");
    }
    names.add(name.toLowerCase());
  }
  const handles = entries.map(([name]) => [name, symbolicReference(stack, name)]);
  for (const [name, value] of entries) existing.set(name, value);
  parameterVariables.set(stack, existing);
  return Object.fromEntries(handles) as ParameterVariables<T>;
}

export function createGraphResource<T extends "Microsoft.Graph/applications" | "Microsoft.Graph/servicePrincipals">(
  stack: Stack,
  definition: GraphResourceInput<T>,
): GraphIdentityHandle;
export function createGraphResource(
  stack: Stack,
  definition: GraphResourceInput<"Microsoft.Graph/appRoleAssignedTo">,
): GraphResourceHandle;
export function createGraphResource(
  stack: Stack,
  definition: GraphResourceInput<GraphResourceType>,
): GraphResourceHandle {
  assertReferenceNameAvailable(stack, definition.identifier);
  if (![
    "Microsoft.Graph/applications", "Microsoft.Graph/servicePrincipals",
    "Microsoft.Graph/appRoleAssignedTo",
  ].includes(definition.type)) {
    throw provisioningError("PROVISIONING_GRAPH_INVALID", definition.identifier, "Use a supported typed Graph resource or an explicit graphResources definition.");
  }
  const requiredProperties = definition.type === "Microsoft.Graph/applications" ? ["uniqueName"]
    : definition.type === "Microsoft.Graph/servicePrincipals" ? ["appId"]
    : ["appRoleId", "principalId", "resourceId"];
  if (!definition.body || typeof definition.body !== "object" || Array.isArray(definition.body) ||
      requiredProperties.some((name) => definition.body[name] === undefined || definition.body[name] === null)) {
    throw provisioningError("PROVISIONING_GRAPH_INVALID", definition.identifier, "The Graph resource body is missing required properties.");
  }
  if (definition.dependsOn !== undefined && Object.hasOwn(definition.body, "dependsOn")) {
    throw provisioningError("PROVISIONING_REFERENCE_CONFLICT", definition.identifier, "Declare Graph dependencies once through typed handles.");
  }
  if (definition.dependsOn !== undefined && !Array.isArray(definition.dependsOn)) {
    throw provisioningError("PROVISIONING_GRAPH_INVALID", definition.identifier, "Graph dependencies must be an array of declared handles.");
  }
  const dependencies = (definition.dependsOn ?? []).map((handle) => {
    const dependency = graphHandles.get(handle);
    if (!dependency || dependency.stack !== stack) {
      throw provisioningError("PROVISIONING_REFERENCE_SCOPE", definition.identifier, "Graph dependencies must be handles declared in the same stack.");
    }
    return dependency.reference;
  });
  const reference = symbolicReference<{ id: string; appId: string }>(stack, definition.identifier);
  const handle = definition.type === "Microsoft.Graph/appRoleAssignedTo"
    ? { id: reference.id }
    : { id: reference.id, appId: reference.appId };
  const resources = registeredGraphResources.get(stack) ?? [];
  resources.push({
    identifier: definition.identifier,
    type: definition.type,
    body: dependencies.length ? { ...definition.body, dependsOn: dependencies } : definition.body,
    ...(definition.condition === undefined ? {} : { condition: definition.condition }),
  });
  registeredGraphResources.set(stack, resources);
  graphHandles.set(handle, { stack, reference });
  return handle;
}

export function isProvisioningStack(value: unknown): value is Stack {
  return typeof value === "object" && value !== null &&
    "name" in value && typeof value.name === "string" &&
    "getResources" in value && typeof value.getResources === "function" &&
    "parameters" in value && hasCollectionMethods(value.parameters) &&
    "listMetadata" in value.parameters && typeof value.parameters.listMetadata === "function" &&
    "variables" in value && hasCollectionMethods(value.variables) &&
    "listMetadata" in value.variables && typeof value.variables.listMetadata === "function" &&
    "outputs" in value && hasCollectionMethods(value.outputs);
}

function hasCollectionMethods(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null &&
    ["add", "has", "list", "delete"].every(
      (method) => method in value && typeof Reflect.get(value, method) === "function",
    );
}

export function validateProvisioningSettings(source: unknown): asserts source is ProvisioningSettings {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw provisioningError("PROVISIONING_DEFINITION_INVALID", "settings", "Stack settings must be an object.");
  }
  for (const [group, values] of [
    ["parameterBindings", "parameterBindings" in source ? source.parameterBindings : undefined],
    ["parameterVariables", "parameterVariables" in source ? source.parameterVariables : undefined],
  ] as const) {
    if (values !== undefined && (values === null || typeof values !== "object" || Array.isArray(values))) {
      throw provisioningError("PROVISIONING_DEFINITION_INVALID", group, `${group} must be a named value map.`);
    }
    for (const name of Object.keys(values ?? {})) validateIdentifier(name);
  }
  if ("graphResources" in source && source.graphResources !== undefined && !Array.isArray(source.graphResources)) {
    throw provisioningError("PROVISIONING_DEFINITION_INVALID", "graphResources", "Graph resources must be an array.");
  }
}

export function loopResource<TItem extends VariableValue>(
  stack: Stack,
  collection: ExpressionOrValue<readonly TItem[]>,
  options: ResourceLoopOptions<TItem>,
): ResourceDeclaration;
export function loopResource(
  stack: Stack,
  resource: Resource,
  collection: VariableValue,
  itemVariable: string,
  batchSize?: number,
): ResourceDeclaration;
export function loopResource<TItem extends VariableValue>(
  stack: Stack,
  resourceOrCollection: Resource | ExpressionOrValue<readonly TItem[]>,
  collectionOrOptions: VariableValue | ResourceLoopOptions<TItem>,
  legacyItemVariable?: string,
  legacyBatchSize = 1,
): ResourceDeclaration {
  let resource: Resource;
  let collection: VariableValue;
  let itemVariable: string;
  let batchSize: number;
  if (isLoopOptions(collectionOrOptions)) {
    if (isResource(resourceOrCollection)) {
      throw provisioningError("PROVISIONING_LOOP_INVALID", collectionOrOptions.itemVariable, "A loop factory requires an array or array expression.");
    }
    itemVariable = collectionOrOptions.itemVariable;
    batchSize = collectionOrOptions.batchSize ?? 1;
    assertReferenceNameAvailable(stack, itemVariable);
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw provisioningError("PROVISIONING_LOOP_INVALID", itemVariable, "A resource loop requires a positive integer batch size.");
    }
    collection = resourceOrCollection;
    resource = collectionOrOptions.create(symbolicReference<TItem>(stack, itemVariable));
  } else {
    if (!isResource(resourceOrCollection) || legacyItemVariable === undefined) {
      throw provisioningError("PROVISIONING_LOOP_INVALID", "resource", "Use a resource and collection, or a collection with a typed resource factory.");
    }
    resource = resourceOrCollection;
    collection = collectionOrOptions;
    itemVariable = legacyItemVariable;
    batchSize = legacyBatchSize;
  }
  validateIdentifier(itemVariable);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw provisioningError("PROVISIONING_LOOP_INVALID", itemVariable, "A resource loop requires a positive integer batch size.");
  }
  if (!isResource(resource) || !resource.isChildOf(stack)) {
    throw provisioningError("PROVISIONING_LOOP_INVALID", itemVariable, "A loop resource must belong to its declared stack.");
  }
  const loops = resourceLoops.get(stack) ?? [];
  if (loops.some((loop) => loop.resource === resource)) {
    throw provisioningError("PROVISIONING_LOOP_INVALID", itemVariable, "A resource may have only one loop definition.");
  }
  loops.push({ resource, collection, itemVariable, batchSize });
  resourceLoops.set(stack, loops);
  return resource;
}

export async function renderProvisioningStack(
  stack: Stack,
  entrypoint: string,
  requiredFiles: readonly string[],
  overrides: Readonly<Record<string, string | number | boolean>>,
  settings: ProvisioningSettings = {},
): Promise<readonly RenderedBicepFile[]> {
  if (!isProvisioningStack(stack)) {
    throw provisioningError("PROVISIONING_DEFINITION_INVALID", "stack", "Provisioning requires an authored Stack.");
  }
  validateProvisioningSettings(settings);
  let internal: unknown;
  let core: unknown;
  try {
    // Resolve from the resource project so the renderer uses the same core instance.
    [internal, core] = await Promise.all([
      importProjectModule("@azure/provisioning-core/internal", pathToFileURL(entrypoint).href),
      importProjectModule("@azure/provisioning-core", pathToFileURL(entrypoint).href),
    ]);
  } catch (cause) {
    throw new IacComposerError({
      code: "PROVISIONING_CORE_UNAVAILABLE", category: "configuration",
      message: `Could not load provisioning core for '${entrypoint}'.`,
      target: entrypoint,
      repair: "Declare and install the compatible @azure/provisioning-core package in the resource project.",
    }, { cause });
  }
  if (!isCoreInternal(internal) || !isCorePublic(core)) {
    throw provisioningError("PROVISIONING_CORE_INCOMPATIBLE", entrypoint, "The selected core must expose compatible rendering and expression APIs.");
  }
  const runtime: CoreRuntime = { ...internal, isExpression: core.isExpression };
  const template = requiredFiles[0] ?? `${stack.name}.bicep`;
  const parameterPath = requiredFiles[1] ?? template.replace(/\.bicep$/, ".bicepparam");
  const parameters = new Map(Object.entries(settings.parameterBindings ?? {}));
  for (const name of [...parameters.keys(), ...Object.keys(overrides)]) {
    if (!stack.parameters.has(name)) {
      throw provisioningError("PROVISIONING_PARAMETER_UNKNOWN", name, `Stack '${stack.name}' does not declare parameter '${name}'.`);
    }
  }
  for (const parameter of stack.parameters.listMetadata()) {
    if (Object.hasOwn(overrides, parameter.name) ||
        (!parameters.has(parameter.name) && parameter.defaultValue === undefined)) {
      parameters.set(parameter.name, runtime.wrapExpression({
        kind: "fn-call", operator: "readEnvironmentVariable", args: [`IAC_COMPOSER_PARAM_${parameter.name}`],
      }));
    }
    if (parameters.has(parameter.name)) {
      parameters.set(parameter.name, typedParameterValue(runtime, parameter, parameters.get(parameter.name)!));
    }
  }
  const parameterEntries = [...parameters];
  const variables = new Map(parameterVariables.get(stack));
  for (const [name, value] of Object.entries(settings.parameterVariables ?? {})) {
    if ([...variables.keys()].some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      throw provisioningError("PROVISIONING_REFERENCE_CONFLICT", name, "A parameter variable cannot be declared through both the typed API and a raw value map.");
    }
    variables.set(name, value);
  }
  const variableEntries = [...variables];
  const graphResources = [...registeredGraphResources.get(stack) ?? [], ...settings.graphResources ?? []];
  const graphValues = graphResources.flatMap((resource) => [
    resource.body,
    ...(resource.condition === undefined ? [] : [resource.condition]),
  ]);
  const loops = resourceLoops.get(stack) ?? [];
  for (const loop of loops) {
    if (!Array.isArray(loop.collection) && !runtime.isExpression(loop.collection)) {
      throw provisioningError("PROVISIONING_LOOP_INVALID", loop.itemVariable, "A resource loop requires an array or array expression.");
    }
  }
  let files = withValues(stack, [
    ...graphValues,
    ...loops.map((loop) => loop.collection),
    ...stack.parameters.list(),
  ], (names) =>
    removeAnchors(runtime.renderBicepFiles([stack]), names),
  );
  const entry = files[0];
  if (entry && entry.path !== template) {
    files = files.map((file, index) => ({
      ...file,
      path: index === 0 ? template : posix.join(
        posix.dirname(template), posix.relative(posix.dirname(entry.path), file.path),
      ),
    }));
  }
  const mainIndex = files.findIndex((file) => file.path === template);
  if (mainIndex < 0) {
    throw provisioningError("PROVISIONING_TEMPLATE_MISSING", template, `Stack '${stack.name}' did not produce the selected entry template.`);
  }
  let main = files[mainIndex]!;
  for (const loop of loops) {
    const [reference, collection] = renderValues(runtime, stack, [loop.resource.id, loop.collection]);
    const identifier = /^([A-Za-z_]\w*)\.id$/.exec(reference!)?.[1];
    if (!identifier) {
      throw provisioningError("PROVISIONING_LOOP_INVALID", loop.itemVariable, "The loop resource must have a direct symbolic reference.");
    }
    const pattern = new RegExp(
      `(^resource ${identifier} '[^']+' = )((?:if \\([^\\n]*\\) )?\\{[\\s\\S]*?^\\})`, "gm",
    );
    let matches = 0;
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!;
      files[index] = {
        ...file,
        contents: file.contents.replace(pattern, (_match, prefix: string, body: string) => {
          matches++;
          return `@batchSize(${loop.batchSize})\n${prefix}[for ${loop.itemVariable} in ${collection}: ${body}]`;
        }),
      };
    }
    if (matches !== 1) {
      throw provisioningError("PROVISIONING_LOOP_INVALID", loop.itemVariable, "A loop must identify exactly one rendered resource declaration.");
    }
  }
  main = files[mainIndex]!;
  if (graphResources.length) {
    const values = renderValues(runtime, stack, graphValues);
    const identifiers = new Set<string>();
    let index = 0;
    const declarations = graphResources.map((resource) => {
      validateIdentifier(resource.identifier);
      if (!/^Microsoft\.Graph\/[A-Za-z/]+$/.test(resource.type) ||
              identifiers.has(resource.identifier.toLowerCase()) ||
              new RegExp(`^(?:param|var|resource|module|output) ${resource.identifier}\\b`, "mi").test(main.contents)) {
        throw provisioningError("PROVISIONING_GRAPH_INVALID", resource.identifier, "Graph resource types and identifiers must be valid and unique.");
      }
      if (!resource.body || typeof resource.body !== "object" || Array.isArray(resource.body)) {
        throw provisioningError("PROVISIONING_GRAPH_INVALID", resource.identifier, "A Graph resource body must be an object.");
      }
      identifiers.add(resource.identifier.toLowerCase());
      const body = values[index++];
      const condition = resource.condition === undefined ? undefined : values[index++];
      return `resource ${resource.identifier} '${resource.type}@v1.0' = ${condition === undefined ? "" : `if (${condition}) `}${body}`;
    });
    const extension = "extension 'br:mcr.microsoft.com/bicep/extensions/microsoftgraph/v1.0:1.0.0'";
    files[mainIndex] = {
      ...main,
      contents: `${main.contents.replace(/^(targetScope[^\n]+\n)/, `$1\n${extension}\n`)}\n${declarations.join("\n\n")}\n`,
    };
  }
  let using = relative(dirname(parameterPath), template).replaceAll("\\", "/");
  if (!using.startsWith(".")) using = `./${using}`;
  const values = renderValues(runtime, stack, [
    using, ...variableEntries.map(([, value]) => value), ...parameterEntries.map(([, value]) => value),
  ]);
  files.push({
    path: parameterPath,
    contents: `using ${values[0]}\n\n${[
      ...variableEntries.map(([name], index) => `var ${name} = ${values[index + 1]}`),
      ...parameterEntries.map(([name], index) => `param ${name} = ${values[index + variableEntries.length + 1]}`),
    ].join("\n")}\n`,
  });
  return files;
}

function isCoreInternal(value: unknown): value is Omit<CoreRuntime, "isExpression"> {
  return typeof value === "object" && value !== null &&
    "renderBicepFiles" in value && typeof value.renderBicepFiles === "function" &&
    "wrapExpression" in value && typeof value.wrapExpression === "function" &&
    "unwrapExpression" in value && typeof value.unwrapExpression === "function";
}

function isCorePublic(value: unknown): value is Pick<CoreRuntime, "isExpression"> {
  return typeof value === "object" && value !== null &&
    "isExpression" in value && typeof value.isExpression === "function";
}

function typedParameterValue(runtime: CoreRuntime, parameter: ParameterMetadata, value: VariableValue): VariableValue {
  const conversion = parameter.type === "bool" ? "bool"
    : parameter.type === "int" ? "int"
    : parameter.type === "array" || parameter.type === "object" ? "json"
    : undefined;
  if (conversion && runtime.isExpression(value)) {
    const expression = runtime.unwrapExpression(value);
    if (expression.kind === "fn-call" && expression.operator === "readEnvironmentVariable") {
      return runtime.wrapExpression({ kind: "fn-call", operator: conversion, args: [value] });
    }
  }
  return value;
}

function withValues<T>(stack: Stack, values: readonly VariableValue[], action: (names: string[]) => T): T {
  const names: string[] = [];
  try {
    for (const value of values) {
      let name = `iacValue${names.length}`;
      while (stack.variables.has(name) || stack.parameters.has(name) ||
             stack.outputs.has(`${name}Output`)) name += "_";
      const variable = stack.variables.add(name, value);
      stack.outputs.add(`${name}Output`, "any", variable);
      names.push(name);
    }
    return action(names);
  } finally {
    for (const name of names) {
      stack.outputs.delete(`${name}Output`);
      stack.variables.delete(name);
    }
  }
}

function renderValues(runtime: CoreRuntime, stack: Stack, values: readonly VariableValue[]): string[] {
  return withValues(stack, values, (names) => {
    const files = runtime.renderBicepFiles([stack]);
    return names.map((name) => {
      const value = files.map((file) => file.contents.match(variablePattern(name))?.[1])
        .find((value) => value !== undefined);
      if (value === undefined) {
        throw provisioningError("PROVISIONING_EXPRESSION_INVALID", name, "Core rendering omitted a required expression.");
      }
      return value;
    });
  });
}

function removeAnchors(files: readonly RenderedBicepFile[], names: readonly string[]): RenderedBicepFile[] {
  return files.map((file) => {
    let contents = file.contents;
    for (const name of names) {
      contents = contents.replace(variablePattern(name), "\n");
      contents = contents.replace(new RegExp(`^output ${name}Output any = ${name}\\n?`, "m"), "");
    }
    return { ...file, contents };
  });
}

function variablePattern(name: string): RegExp {
  return new RegExp(`(?:^|\\n)var ${name} = ([\\s\\S]*?)(?=\\n\\n(?:@|param |var |resource |module |output )|\\n*$)`);
}

function validateIdentifier(name: string): void {
  if (!/^[A-Za-z_]\w*$/.test(name)) {
    throw provisioningError("PROVISIONING_IDENTIFIER_INVALID", name, "Use a valid deployment identifier.");
  }
}

function symbolicReference<T>(stack: Stack, name: string): Expression<T> {
  // Use the author's core instance to create a handle without retaining a template variable.
  const reference: Expression<unknown> = stack.variables.add(name, null);
  stack.variables.delete(name);
  return reference as Expression<T>;
}

function assertReferenceNameAvailable(stack: Stack, name: string): void {
  validateIdentifier(name);
  const normalized = name.toLowerCase();
  const names = [
    ...stack.parameters.listMetadata().map((parameter) => parameter.name),
    ...stack.variables.listMetadata().map((variable) => variable.name),
    ...parameterVariables.get(stack)?.keys() ?? [],
    ...registeredGraphResources.get(stack)?.map((resource) => resource.identifier) ?? [],
  ];
  if (names.some((existing) => existing.toLowerCase() === normalized)) {
    throw provisioningError("PROVISIONING_REFERENCE_CONFLICT", name, "The reference name is already declared in this stack.");
  }
}

function isResource(value: unknown): value is Resource {
  return typeof value === "object" && value !== null &&
    "isChildOf" in value && typeof value.isChildOf === "function" &&
    "id" in value;
}

function isLoopOptions<TItem>(value: unknown): value is ResourceLoopOptions<TItem> {
  return typeof value === "object" && value !== null &&
    "create" in value && typeof value.create === "function" &&
    "itemVariable" in value && typeof value.itemVariable === "string";
}

function provisioningError(code: string, target: string, message: string): IacComposerError {
  return new IacComposerError({
    code, category: "compilation", target, message,
    repair: "Correct the authored provisioning definition and rerun the project's typecheck and preview.",
  });
}
