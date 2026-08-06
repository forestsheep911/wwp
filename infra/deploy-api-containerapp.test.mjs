import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("./deploy-api-containerapp.ps1", import.meta.url), "utf8");

test("API deployment preserves secret-backed environment variables in the replacement revision", () => {
  const preserveIndex = script.indexOf("$existingEnvironment = @(");
  const replaceIndex = script.indexOf("--replace-env-vars $envVars");

  assert.notEqual(preserveIndex, -1);
  assert.notEqual(replaceIndex, -1);
  assert.ok(preserveIndex < replaceIndex);
  assert.match(script, /\$envVars \+= "\$\(\$entry\.name\)=secretref:\$\(\$entry\.secretRef\)"/);
  assert.match(script, /\$AdminContainerSecretName = "WWPDW_ADMIN_KEY"/);
  assert.match(script, /\$NotionContainerSecretName = "NOTION_READ_ONLY_TOKEN"/);
  assert.match(script, /\$BailianContainerSecretName = "BAILIAN_API_KEY"/);
  assert.match(script, /\$AliyunAccessKeyIdContainerSecretName = "ALIBABA_CLOUD_ACCESS_KEY_ID"/);
  assert.match(script, /\$AliyunAccessKeySecretContainerSecretName = "ALIBABA_CLOUD_ACCESS_KEY_SECRET"/);
});
