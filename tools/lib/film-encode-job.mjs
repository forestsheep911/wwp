import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { assertStoragePath } from "./film-media-runtime.mjs";

export function atomicJson(file, data) {
  const next = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(next, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(next, file);
}

export function claimEncodeJob(output, tempDir, plan, { resume = false, restart = false, recoverLock = false } = {}) {
  const lock = `${output}.wwp-lock`;
  if (fs.existsSync(output)) throw new Error(`Output already exists; preserve it and choose another path: ${output}`);
  if (recoverLock && fs.existsSync(lock)) {
    const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
    if (owner.hostname !== os.hostname()) throw new Error("Lock belongs to another machine; inspect that machine before recovery");
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; }
    if (alive) throw new Error(`Encode owner is still running: PID ${owner.pid}`);
    fs.unlinkSync(lock);
  }
  const lockFd = fs.openSync(lock, "wx");
  fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, hostname: os.hostname(), output, startedAt: new Date().toISOString() }));
  fs.closeSync(lockFd);
  try {
    const id = createHash("sha256").update(fs.realpathSync(path.dirname(output)) + "/" + path.basename(output)).digest("hex").slice(0, 24);
    const directory = path.join(tempDir, `.wwp-encode-${id}`);
    fs.mkdirSync(directory, { recursive: true });
    const stateFile = path.join(directory, "state.json");
    const fingerprint = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null;
    if (state && state.fingerprint !== fingerprint) throw new Error(`Retained job has a different source or plan: ${directory}; use another output path`);
    if (state && !resume && !restart) throw new Error(`Retained job exists: ${directory}; inspect state/log and use --resume or --restart-work`);
    if (restart) {
      fs.rmSync(directory, { recursive: true });
      fs.mkdirSync(directory);
      state = null;
    }
    state ||= { fingerprint, plan, stage: "prepared", createdAt: new Date().toISOString() };
    const save = stage => { state.stage = stage; state.updatedAt = new Date().toISOString(); atomicJson(stateFile, state); };
    save(state.stage);
    return { directory, state, save, release: () => fs.rmSync(lock, { force: true }) };
  } catch (error) {
    fs.rmSync(lock, { force: true });
    throw error;
  }
}

export async function runMedia(command, args, label, job, { onProgress, timeoutMs = 0, noProgressTimeoutMs = 180_000, killGraceMs = 5000 } = {}) {
  console.log(`${label}: ${command} ${args.map(value => JSON.stringify(value)).join(" ")}`);
  const log = fs.openSync(path.join(job.directory, "ffmpeg.log"), "a");
  fs.writeSync(log, `\n${label}: ${JSON.stringify(args)}\n`);
  try {
    await new Promise((resolve, reject) => {
      const fontConfig = path.join(job.directory, "fontconfig.xml");
      const child = spawn(command, args, { cwd: job.directory, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
        env: fs.existsSync(fontConfig) ? { ...process.env, FONTCONFIG_FILE: fontConfig } : process.env });
      let tail = "", diagnostic = null, progressBuffer = "", signal = null;
      let lastProgress = Date.now(), lastTime = -1, escalation;
      const terminate = received => {
        child.kill(received);
        escalation ??= setTimeout(() => child.kill("SIGKILL"), killGraceMs);
      };
      const stop = received => { signal = received; terminate(received); };
      const deadline = timeoutMs > 0 ? setTimeout(() => {
        diagnostic = new Error(`${label}: exceeded bounded job timeout (${timeoutMs} ms)`);
        terminate("SIGTERM");
      }, timeoutMs) : null;
      const watchdog = noProgressTimeoutMs > 0 ? setInterval(() => {
        if (!diagnostic && Date.now() - lastProgress > noProgressTimeoutMs) {
          diagnostic = new Error(`${label}: no advancing media progress for ${noProgressTimeoutMs} ms; inspect source/subtitle interval`);
          terminate("SIGTERM");
        }
      }, Math.min(1000, noProgressTimeoutMs)) : null;
      const onInt = () => stop("SIGINT"), onTerm = () => stop("SIGTERM");
      process.once("SIGINT", onInt);
      process.once("SIGTERM", onTerm);
      child.stdout.on("data", chunk => {
        process.stdout.write(chunk);
        fs.writeSync(log, chunk);
        progressBuffer += chunk.toString();
        const lines = progressBuffer.split("\n");
        progressBuffer = lines.pop();
        for (const line of lines) {
          const match = line.match(/^out_time_us=(\d+)$/u);
          if (match && Number(match[1]) > lastTime) {
            lastTime = Number(match[1]); lastProgress = Date.now();
          }
          if (match && onProgress) {
            try { onProgress(Number(match[1]) / 1e6); }
            catch (error) { diagnostic = error; terminate("SIGTERM"); }
          }
        }
      });
      child.stderr.on("data", chunk => {
        process.stderr.write(chunk);
        fs.writeSync(log, chunk);
        tail = (tail + chunk.toString()).slice(-65536);
        if (!diagnostic && /fontselect: failed to find any fallback with glyph|Glyph .* not found/iu.test(tail)) {
          diagnostic = new Error(`${label}: missing subtitle glyph; configure --fonts-dir and inspect the dialogue frame`);
          terminate("SIGTERM");
        }
        if (!diagnostic && args.includes("-xerror") && /Could not find ref with POC|Error constructing the frame RPS|error while decoding|corrupt decoded frame|Invalid data found when processing input/iu.test(tail)) {
          diagnostic = new Error(`${label}: strict smoke failed on decoder error`);
          terminate("SIGTERM");
        }
      });
      child.once("error", error => { diagnostic = error; });
      child.once("close", (code, childSignal) => {
        clearTimeout(deadline); clearTimeout(escalation); clearInterval(watchdog);
        process.removeListener("SIGINT", onInt);
        process.removeListener("SIGTERM", onTerm);
        if (diagnostic) reject(diagnostic);
        else if (code !== 0 || signal) reject(new Error(`${label} failed: exit=${code} signal=${signal ?? childSignal ?? "none"}\n${tail.trim()}`));
        else resolve();
      });
    });
  } finally { fs.closeSync(log); }
}

export async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function publishEncodedFile(part, output, expectedBytes) {
  assertStoragePath(output);
  const staged = `${output}.publishing-${process.pid}.mp4`;
  if (fs.existsSync(output)) throw new Error(`Output appeared during encode: ${output}`);
  await fs.promises.copyFile(part, staged, fs.constants.COPYFILE_EXCL);
  // Keep the original intermediate on every failure, including network disconnects.
  if (fs.statSync(staged).size !== expectedBytes || await fileHash(staged) !== await fileHash(part)) {
    throw new Error(`Output copy verification failed: ${staged}`);
  }
  if (fs.existsSync(output)) throw new Error(`Output appeared during publication: ${output}`);
  fs.renameSync(staged, output);
  fs.rmSync(part);
}
