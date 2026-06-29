import { DefaultAzureCredential } from "@azure/identity";
import type { CacheJob, CacheTriggerStatus } from "@wwpdw/shared";

const terminalStatuses = new Set(["ready", "failed"]);
const defaultApiVersion = "2024-03-01";

interface ContainerJobTriggerConfig {
  subscriptionId: string;
  resourceGroup: string;
  jobName: string;
  apiVersion: string;
}

function readConfig(): ContainerJobTriggerConfig | undefined {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP;
  const jobName = process.env.AZURE_CONTAINER_APP_JOB_NAME;

  if (!subscriptionId || !resourceGroup || !jobName) {
    return undefined;
  }

  return {
    subscriptionId,
    resourceGroup,
    jobName,
    apiVersion: process.env.AZURE_CONTAINER_APP_JOB_API_VERSION ?? defaultApiVersion
  };
}

function startUrl(config: ContainerJobTriggerConfig) {
  const subscription = encodeURIComponent(config.subscriptionId);
  const resourceGroup = encodeURIComponent(config.resourceGroup);
  const jobName = encodeURIComponent(config.jobName);
  return [
    "https://management.azure.com/subscriptions",
    subscription,
    "resourceGroups",
    resourceGroup,
    "providers/Microsoft.App/jobs",
    jobName,
    `start?api-version=${encodeURIComponent(config.apiVersion)}`
  ].join("/");
}

export class CacheWorkerTrigger {
  private readonly credential = new DefaultAzureCredential();
  private readonly config = readConfig();

  async start(job: CacheJob): Promise<CacheTriggerStatus> {
    if (process.env.CACHE_BACKEND !== "azure") {
      return {
        status: "disabled",
        message: "Worker trigger is disabled outside the Azure cache backend."
      };
    }

    if (terminalStatuses.has(job.status)) {
      return {
        status: "skipped",
        message: `Worker trigger skipped because the job is already ${job.status}.`
      };
    }

    if (!this.config) {
      return {
        status: "disabled",
        message: "Worker trigger is missing AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, or AZURE_CONTAINER_APP_JOB_NAME."
      };
    }

    try {
      const token = await this.credential.getToken("https://management.azure.com/.default");
      if (!token) {
        return {
          status: "failed",
          message: "Could not acquire an Azure management token."
        };
      }

      const response = await fetch(startUrl(this.config), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      });

      if (!response.ok) {
        const body = await response.text();
        return {
          status: "failed",
          message: `Container Apps Job start failed with ${response.status}: ${body.slice(0, 300)}`
        };
      }

      return {
        status: "started",
        message: `Container Apps Job ${this.config.jobName} was started.`
      };
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : "Container Apps Job start failed."
      };
    }
  }
}
