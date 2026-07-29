import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const RamClient = require("@alicloud/ram20150501").default;
const OpenApi = require("@alicloud/openapi-client");
const {
  AttachPolicyToRoleRequest,
  CreatePolicyRequest,
  CreatePolicyVersionRequest,
  CreateRoleRequest,
  GetPolicyRequest,
  GetRoleRequest
} = require("@alicloud/ram20150501/dist/models/model");

const roleName = "WWPDWFCOSSPrepareRole";
const policyName = "WWPDWFCOSSPreparePolicy";
const bucket = "bxu-dev-001";
const objectPrefix = "wwpdw/prepared";
const accountId = "1812145568680204";

async function readLocalEnvironment() {
  const values = new Map();
  const contents = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const name = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (value) values.set(name, value);
  }
  return {
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim()
      || values.get("ALIBABA_CLOUD_ACCESS_KEY_ID"),
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim()
      || values.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
  };
}

function isMissing(error) {
  return error?.statusCode === 404
    || error?.code === "EntityNotExist.Role"
    || error?.code === "EntityNotExist.Policy";
}

const trustPolicy = JSON.stringify({
  Version: "1",
  Statement: [{
    Effect: "Allow",
    Action: "sts:AssumeRole",
    Principal: { Service: ["fc.aliyuncs.com"] }
  }]
});

const permissionPolicy = JSON.stringify({
  Version: "1",
  Statement: [{
    Effect: "Allow",
    Action: [
      "oss:PutObject",
      "oss:GetObject",
      "oss:DeleteObject",
      "oss:AbortMultipartUpload",
      "oss:ListParts"
    ],
    Resource: [`acs:oss:*:${accountId}:${bucket}/${objectPrefix}/*`]
  }]
});

async function main() {
  const credentials = await readLocalEnvironment();
  if (!credentials.accessKeyId || !credentials.accessKeySecret) {
    throw new Error("Alibaba Cloud access key is missing from process environment or .env.");
  }
  const client = new RamClient(new OpenApi.Config({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    endpoint: "ram.aliyuncs.com"
  }));

  let role;
  try {
    role = (await client.getRole(new GetRoleRequest({ roleName }))).body?.role;
  } catch (error) {
    if (!isMissing(error)) throw error;
    role = (await client.createRole(new CreateRoleRequest({
      roleName,
      description: "WWPDW FC3 role for preparing Notion video files into the restricted OSS prefix.",
      maxSessionDuration: 3600,
      assumeRolePolicyDocument: trustPolicy
    }))).body?.role;
  }

  let policyExists = true;
  try {
    await client.getPolicy(new GetPolicyRequest({ policyName, policyType: "Custom" }));
  } catch (error) {
    if (!isMissing(error)) throw error;
    policyExists = false;
  }
  if (policyExists) {
    await client.createPolicyVersion(new CreatePolicyVersionRequest({
      policyName,
      policyDocument: permissionPolicy,
      setAsDefault: true,
      rotateStrategy: "DeleteOldestNonDefaultVersionWhenLimitExceeded"
    }));
  } else {
    await client.createPolicy(new CreatePolicyRequest({
      policyName,
      description: "Write-only preparation access for WWPDW OSS video objects.",
      policyDocument: permissionPolicy
    }));
  }
  try {
    await client.attachPolicyToRole(new AttachPolicyToRoleRequest({
      policyName,
      policyType: "Custom",
      roleName
    }));
  } catch (error) {
    if (error?.code !== "EntityAlreadyExists.Role.Policy") throw error;
  }

  const roleArn = role?.arn || `acs:ram::${accountId}:role/${roleName}`;
  console.log(JSON.stringify({
    ok: true,
    roleName,
    roleArn,
    policyName,
    bucket,
    objectPrefix
  }, null, 2));
}

await main();
