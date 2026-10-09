import { execFileSync } from "node:child_process";

// Encode the argument array, never interpolate caller input into shell code.
// Windows az is a .cmd launcher; macOS executes az directly.
export function azureJson(args) {
  const argv = [...args, "--only-show-errors", "-o", "json"];
  try {
    let output;
    const options = { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 60000, maxBuffer: 16 * 1024 * 1024 };
    if (process.platform === "win32") {
      const payload = Buffer.from(JSON.stringify(argv)).toString("base64");
      const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; $a = @(ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')))); & az @a; exit $LASTEXITCODE`;
      output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], options);
    } else {
      output = execFileSync("az", argv, options);
    }
    return output.trim() ? JSON.parse(output) : null;
  } catch {
    // CLI output may contain secrets. Never include stdout/stderr in errors.
    throw new Error(`Azure CLI ${args.slice(0, 2).join(" ")} failed; check az login, subscription, RBAC and service quota.`);
  }
}
