import {
  fn as coreFunctions,
  Resource,
  Stack,
  type Expression,
  type ExpressionOrValue,
  type ProvisioningComponent,
  type ResourceOptions,
  type VariableValue,
} from "@azure/provisioning-core";
import {
  renderBicepFiles as renderCoreBicepFiles,
  wrapExpression,
  type RenderedBicepFile,
} from "@azure/provisioning-core/internal";
import {
  serialize as serializeCore,
  type SerializationDocument,
} from "@azure/provisioning-core/serialization";

export type { RenderedBicepFile, SerializationDocument };
export type SerializableValue = VariableValue;
type Infra = SerializationDocument["infras"][number];
type SerializedValue = NonNullable<Infra["variables"]>[string]["value"];
type ArmObject = Readonly<Record<string, VariableValue>>;

export const fn = {
  ...coreFunctions,
  readEnvironmentVariable(name: string, defaultValue?: VariableValue): Expression<string> {
    return wrapExpression<string>({
      kind: "fn-call",
      operator: "readEnvironmentVariable",
      args: defaultValue === undefined ? [name] : [name, defaultValue],
    });
  },
};

export function bicepRef<T = string>(path: string): Expression<T> {
  if (!path.trim()) throw new Error("A Bicep reference must not be empty.");
  return wrapExpression<T>({ kind: "symbolic-value", path });
}

interface CoreResourceProps {
  readonly name?: ExpressionOrValue<string>;
  readonly existing?: boolean;
  readonly location?: ExpressionOrValue<string>;
  readonly kind?: ExpressionOrValue<string>;
  readonly sku?: ArmObject;
  readonly properties?: ArmObject;
  readonly identity?: ArmObject;
  readonly tags?: Readonly<Record<string, ExpressionOrValue<string>>>;
}

// Resource SDKs not yet published on npm use the same ARM types and versions.
abstract class ArmResource<TProperties extends object = Record<string, string>> extends Resource {
  static resourceType: string;
  static apiVersion: string;

  constructor(context: ProvisioningComponent, props: CoreResourceProps, options?: ResourceOptions) {
    super(context, {
      ...props,
      type: new.target.resourceType,
      apiVersion: new.target.apiVersion,
    }, options);
  }

  get properties(): Expression<TProperties> {
    return this.expr<TProperties>("properties");
  }

  get identity(): Expression<{ principalId: string; type: string }> {
    return this.expr("identity");
  }
}

export class UserAssignedIdentity extends ArmResource<{
  principalId: string;
  clientId: string;
  tenantId: string;
}> {
  static resourceType = "Microsoft.ManagedIdentity/userAssignedIdentities";
  static apiVersion = "2025-05-31-preview";
}

export class ConfigurationStore extends ArmResource<{ endpoint: string }> {
  static resourceType = "Microsoft.AppConfiguration/configurationStores";
  static apiVersion = "2025-08-01-preview";
}

export class KeyValue extends ArmResource {
  static resourceType = "Microsoft.AppConfiguration/configurationStores/keyValues";
  static apiVersion = "2025-08-01-preview";
}

export class AppServicePlan extends ArmResource {
  static resourceType = "Microsoft.Web/serverfarms";
  static apiVersion = "2025-05-01";
}

export class Site extends ArmResource<{ defaultHostName: string }> {
  static resourceType = "Microsoft.Web/sites";
  static apiVersion = "2025-05-01";
}

export class SiteConfigAuthsettingsV2 extends ArmResource {
  static resourceType = "Microsoft.Web/sites/config";
  static apiVersion = "2025-05-01";

  constructor(context: ProvisioningComponent, props: CoreResourceProps, options?: ResourceOptions) {
    super(context, { ...props, name: "authsettingsV2" }, options);
  }
}

export class ApiConnection extends ArmResource {
  static resourceType = "Microsoft.Web/connections";
  static apiVersion = "2016-06-01";
}

export class Bot extends ArmResource {
  static resourceType = "Microsoft.BotService/botServices";
  static apiVersion = "2023-09-15-preview";
}

export class Channel extends ArmResource {
  static resourceType = "Microsoft.BotService/botServices/channels";
  static apiVersion = "2023-09-15-preview";
}

export class RoleAssignment extends ArmResource {
  static resourceType = "Microsoft.Authorization/roleAssignments";
  static apiVersion = "2022-04-01";
}

export class ManagementLock extends ArmResource {
  static resourceType = "Microsoft.Authorization/locks";
  static apiVersion = "2020-05-01";
}

export class IntegrationAccount extends ArmResource {
  static resourceType = "Microsoft.Logic/integrationAccounts";
  static apiVersion = "2019-05-01";
}

export class Workflow extends ArmResource {
  static resourceType = "Microsoft.Logic/workflows";
  static apiVersion = "2019-05-01";
}

export class ActionGroup extends ArmResource {
  static resourceType = "Microsoft.Insights/actionGroups";
  static apiVersion = "2024-10-01-preview";
}

export class DiagnosticSetting extends ArmResource {
  static resourceType = "Microsoft.Insights/diagnosticSettings";
  static apiVersion = "2021-05-01-preview";
}

export class MetricAlert extends ArmResource {
  static resourceType = "Microsoft.Insights/metricAlerts";
  static apiVersion = "2024-03-01-preview";
}

export const Role = {
  Contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
  AcrPull: "7f951dda-4ed3-4680-a7ca-43fe172d538d",
  MonitoringMetricsPublisher: "3913510d-42f4-4e42-8a64-420c390055eb",
  StorageAccountContributor: "17d1049b-9a84-46fb-8f53-869881c3d3ab",
  StorageBlobDataContributor: "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
  StorageQueueDataContributor: "974c5e8b-45b9-4653-ba55-5f855dd0fb88",
  StorageTableDataContributor: "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3",
  KeyVaultSecretsUser: "4633458b-17de-408a-b874-0445c86b69e6",
  KeyVaultSecretsOfficer: "b86a8fe4-44ce-4948-aee5-eccb2c155cd7",
} as const;

export function grantRole(target: Resource, props: {
  role: ExpressionOrValue<string>;
  principalId: ExpressionOrValue<string>;
  principalKey?: ExpressionOrValue<string>;
  principalType?: ExpressionOrValue<string>;
}): RoleAssignment {
  const roleDefinitionId = fn.subscriptionResourceId("Microsoft.Authorization/roleDefinitions", props.role);
  return new RoleAssignment(target, {
    name: fn.guid(target.id, props.principalKey ?? props.principalId, roleDefinitionId),
    properties: {
      roleDefinitionId,
      principalId: props.principalId,
      ...(props.principalType === undefined ? {} : { principalType: props.principalType }),
    },
  });
}

interface ResourceLoop {
  resource: Resource;
  collection: VariableValue;
  itemVariable: string;
  batchSize: number;
}

const resourceLoops = new WeakMap<Stack, ResourceLoop[]>();

export function loopResource<T extends Resource>(
  stack: Stack,
  resource: T,
  collection: VariableValue,
  itemVariable: string,
  batchSize = 1,
): T {
  if (!/^[A-Za-z_]\w*$/.test(itemVariable) || !Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("A resource loop requires a valid item identifier and positive batch size.");
  }
  const loops = resourceLoops.get(stack) ?? [];
  loops.push({ resource, collection, itemVariable, batchSize });
  resourceLoops.set(stack, loops);
  return resource;
}

export function serialize(input: readonly Stack[]): SerializationDocument {
  const document = serializeCore(input);
  return {
    infras: document.infras.map((infra, index) => {
      const stack = input[index];
      if (!stack) throw new Error("Serialization did not preserve stack order.");
      const serializedResources = { ...infra.resources };
      for (const loop of resourceLoops.get(stack) ?? []) {
        const matches = Object.entries(serializedResources).filter(([, value]) => value.type === loop.resource.type);
        if (matches.length !== 1) throw new Error("A loop must identify exactly one resource declaration.");
        const [name, declaration] = matches[0]!;
        serializedResources[name] = {
          ...declaration,
          decorators: { ...declaration.decorators, batchSize: loop.batchSize },
          value: {
            kind: "for-expression",
            collection: serializeValues(stack, [loop.collection])[0]!,
            itemVariable: loop.itemVariable,
            body: declaration.value,
          },
        };
      }
      return { ...infra, targetScope: stack.targetScope, resources: serializedResources };
    }),
  };
}

export function renderBicepFiles(input: readonly Stack[]): RenderedBicepFile[] {
  const files = input.flatMap((stack) => {
    const loops = resourceLoops.get(stack) ?? [];
    let files = renderAnchoredFiles(stack, loops.map((loop) => loop.collection));
    for (const loop of loops) {
      const collection = renderValues(stack, [loop.collection])[0]!;
      const type = escapeRegex(`${loop.resource.type}@${loop.resource.apiVersion}`);
      const pattern = new RegExp(`(^resource \\w+ '${type}' = )(\\{[\\s\\S]*?^\\})`, "gm");
      let count = 0;
      files = files.map((file) => ({
        ...file,
        contents: file.contents.replace(pattern, (_match, prefix: string, body: string) => {
          count++;
          return `@batchSize(${loop.batchSize})\n${prefix}[for ${loop.itemVariable} in ${collection}: ${body}]`;
        }),
      }));
      if (count !== 1) throw new Error("A loop must render exactly one resource declaration.");
    }
    return files;
  });
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`Duplicate Bicep file path '${file.path}'. Give stacks distinct names.`);
    paths.add(file.path);
  }
  return files;
}

export function createBicepParameterFile(
  stack: Stack,
  path: string,
  options: {
    using: string;
    variables?: Readonly<Record<string, VariableValue>>;
    parameters: Readonly<Record<string, VariableValue>>;
  },
) {
  return { stack, path, ...options };
}

export function renderBicepParameterFile(
  file: ReturnType<typeof createBicepParameterFile>,
): RenderedBicepFile {
  const entries = Object.entries(file.parameters);
  const variables = Object.entries(file.variables ?? {});
  for (const [name] of [...variables, ...entries]) {
    if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error(`Invalid parameter identifier '${name}'.`);
  }
  const values = renderValues(file.stack, [
    file.using,
    ...variables.map(([, value]) => value),
    ...entries.map(([, value]) => value),
  ]);
  return {
    path: file.path,
    contents: `using ${values[0]}\n\n${[
      ...variables.map(([name], index) => `var ${name} = ${values[index + 1]}`),
      ...entries.map(([name], index) => `param ${name} = ${values[index + variables.length + 1]}`),
    ].join("\n")}\n`,
  };
}

export interface GraphResourceDefinition {
  readonly identifier: string;
  readonly type: string;
  readonly body: ArmObject;
  readonly condition?: ExpressionOrValue<boolean>;
}

export function renderGraphStack(stack: Stack, resources: readonly GraphResourceDefinition[]) {
  const values = resources.flatMap((resource) => [
    resource.body,
    ...(resource.condition === undefined ? [] : [resource.condition]),
  ]);
  const serialized = serializeValues(stack, values);
  const rendered = renderValues(stack, values);
  const graphResources: NonNullable<Infra["resources"]> = {};
  let index = 0;
  const declarations = resources.map((resource) => {
    if (!/^[A-Za-z_]\w*$/.test(resource.identifier) ||
        !/^Microsoft\.Graph\/[A-Za-z/]+$/.test(resource.type) ||
        Object.hasOwn(graphResources, resource.identifier)) {
      throw new Error(`Invalid or duplicate Graph resource '${resource.identifier}'.`);
    }
    const body = serialized[index];
    const contents = rendered[index++];
    if (body?.kind !== "object" || contents === undefined) {
      throw new Error(`Graph resource '${resource.identifier}' must be an object.`);
    }
    const condition = resource.condition === undefined ? undefined : serialized[index];
    const conditionContents = resource.condition === undefined ? undefined : rendered[index++];
    graphResources[resource.identifier] = {
      bicepIdentifier: resource.identifier,
      type: resource.type,
      apiVersion: "v1.0",
      existing: false,
      value: condition === undefined ? body : { kind: "if-condition", condition, body },
    };
    return `resource ${resource.identifier} '${resource.type}@v1.0' = ${conditionContents === undefined ? "" : `if (${conditionContents}) `}${contents}`;
  });
  const document = serialize([stack]);
  const infra = document.infras[0];
  // Keep Graph-only inputs during core's dependency planning.
  const main = withValues(stack, values, (names) =>
    removeAnchors(renderBicepFiles([stack]), names)[0],
  );
  if (!infra || !main) throw new Error("Graph provisioning produced no infrastructure entry.");
  for (const name of Object.keys(graphResources)) {
    if (Object.hasOwn(infra.resources ?? {}, name)) throw new Error(`Graph resource '${name}' conflicts with an ARM resource.`);
  }
  const outputJson: SerializationDocument = {
    infras: [{ ...infra, resources: { ...infra.resources, ...graphResources } }],
  };
  const extension = "extension 'br:mcr.microsoft.com/bicep/extensions/microsoftgraph/v1.0:1.0.0'";
  return {
    outputJson,
    main: {
      ...main,
      contents: `${main.contents.replace(/^(targetScope[^\n]+\n)/, `$1\n${extension}\n`)}\n${declarations.join("\n\n")}\n`,
    },
  };
}

function withValues<T>(stack: Stack, values: readonly VariableValue[], action: (names: string[]) => T): T {
  const names: string[] = [];
  try {
    for (const value of values) {
      let name = `iacValue${names.length}`;
      while (stack.variables.has(name) || stack.outputs.has(`${name}Output`)) name += "_";
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

function serializeValues(stack: Stack, values: readonly VariableValue[]): SerializedValue[] {
  return withValues(stack, values, (names) => {
    const variables = serializeCore([stack]).infras[0]?.variables;
    return names.map((name) => {
      const value = variables?.[name]?.value;
      if (!value) throw new Error(`Core serialization omitted '${name}'.`);
      return value;
    });
  });
}

function renderValues(stack: Stack, values: readonly VariableValue[]): string[] {
  return withValues(stack, values, (names) => {
    const files = renderCoreBicepFiles([stack]);
    return names.map((name) => {
      const pattern = variablePattern(name);
      const value = files.map((file) => file.contents.match(pattern)?.[1]).find((value) => value !== undefined);
      if (value === undefined) throw new Error(`Core Bicep rendering omitted '${name}'.`);
      return value;
    });
  });
}

function renderAnchoredFiles(stack: Stack, values: readonly VariableValue[]): RenderedBicepFile[] {
  return withValues(stack, values, (names) => removeAnchors(renderCoreBicepFiles([stack]), names));
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
