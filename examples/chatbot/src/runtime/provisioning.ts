import {
  fn as coreFunctions,
  Resource,
  type Expression,
  type ExpressionOrValue,
  type ProvisioningComponent,
  type ResourceOptions,
  type VariableValue,
} from "@azure/provisioning-core";
import { wrapExpression } from "@azure/provisioning-core/internal";

export type SerializableValue = VariableValue;
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

export { loopResource } from "iac-composer";
