import { Readable } from "node:stream";
import FCClientPackage, {
  GetAsyncTaskRequest,
  InvokeFunctionHeaders,
  InvokeFunctionRequest,
  StopAsyncTaskRequest
} from "@alicloud/fc20230330";
import { Config } from "@alicloud/openapi-client";
import { RuntimeOptions } from "@alicloud/tea-util";

export interface OssPrepareInvocation {
  jobId: string;
  objectKey: string;
  sourceUrl: string;
  title: string;
  contentType?: string;
  expectedBytes?: number;
}

export interface FcPrepareTask {
  taskId: string;
  status: string;
  durationMs?: number;
  error?: string;
  returnPayload?: string;
}

interface FcPrepareOptions {
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
  region?: string;
  functionName?: string;
  client?: FcClient;
}

const FCClientConstructor = (
  FCClientPackage as unknown as { default?: typeof FCClientPackage }
).default ?? FCClientPackage;
type FcClient = InstanceType<typeof FCClientConstructor>;

function configuredValue(value: string | undefined, fallback = "") {
  return value?.trim() || fallback;
}

function safeTaskId(jobId: string) {
  return `wwpdw-${jobId.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 128);
}

export class AliyunFcPrepareUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AliyunFcPrepareUnavailableError";
  }
}

export class AliyunFcPrepare {
  private readonly functionName: string;
  private readonly client?: FcClient;
  readonly enabled: boolean;
  readonly reason?: string;

  constructor(options: FcPrepareOptions = {}) {
    const accessKeyId = configuredValue(
      options.accessKeyId ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_ID
    );
    const accessKeySecret = configuredValue(
      options.accessKeySecret ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET
    );
    const securityToken = configuredValue(
      options.securityToken ?? process.env.ALIBABA_CLOUD_SECURITY_TOKEN
    );
    const region = configuredValue(options.region ?? process.env.ALIYUN_FC_REGION, "cn-shanghai");
    this.functionName = configuredValue(
      options.functionName ?? process.env.ALIYUN_FC_FUNCTION_NAME,
      "wwpdw-oss-prepare"
    );
    const missing = [
      !accessKeyId ? "ALIBABA_CLOUD_ACCESS_KEY_ID" : undefined,
      !accessKeySecret ? "ALIBABA_CLOUD_ACCESS_KEY_SECRET" : undefined
    ].filter(Boolean);
    this.enabled = Boolean(options.client || missing.length === 0);
    this.reason = this.enabled ? undefined : `FC preparation is missing ${missing.join(", ")}.`;
    this.client = options.client ?? (this.enabled ? new FCClientConstructor(new Config({
      accessKeyId,
      accessKeySecret,
      securityToken: securityToken || undefined,
      regionId: region,
      endpoint: `fcv3.${region}.aliyuncs.com`
    })) : undefined);
  }

  private requireClient() {
    if (!this.client) throw new AliyunFcPrepareUnavailableError(this.reason ?? "FC preparation is unavailable.");
    return this.client;
  }

  async invoke(input: OssPrepareInvocation) {
    const taskId = safeTaskId(input.jobId);
    await this.requireClient().invokeFunctionWithOptions(
      this.functionName,
      new InvokeFunctionRequest({
        body: Readable.from([Buffer.from(JSON.stringify(input), "utf8")]),
        qualifier: "LATEST"
      }),
      new InvokeFunctionHeaders({
        xFcAsyncTaskId: taskId,
        xFcInvocationType: "Async"
      }),
      new RuntimeOptions({})
    );
    return { taskId };
  }

  async getTask(taskId: string): Promise<FcPrepareTask> {
    const response = await this.requireClient().getAsyncTask(
      this.functionName,
      taskId,
      new GetAsyncTaskRequest({ qualifier: "LATEST" })
    );
    const task = response.body;
    return {
      taskId: task?.taskId ?? taskId,
      status: task?.status ?? "Unknown",
      durationMs: task?.durationMs,
      error: task?.taskErrorMessage,
      returnPayload: task?.returnPayload
    };
  }

  async stop(taskId: string) {
    await this.requireClient().stopAsyncTask(
      this.functionName,
      taskId,
      new StopAsyncTaskRequest({ qualifier: "LATEST" })
    );
  }
}

export const __test = { safeTaskId };
