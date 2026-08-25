import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const requireCloudConfig = process.argv.includes("--require-cloud");
await run(process.execPath, ["tools/build-frontend.mjs", ...(requireCloudConfig ? ["--require-cloud"] : [])]);

const tempDir = await mkdtemp(join(tmpdir(), "todo-sticky-tauri-"));
const configPath = join(tempDir, "tauri-build-override.json");
await writeFile(configPath, JSON.stringify({ build: { beforeBuildCommand: "" } }), "utf8");
try {
  await run(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "build", "--config", configPath, "--bundles", "nsis"]);
  await run(process.execPath, ["tools/check-release.mjs", ...(requireCloudConfig ? ["--require-cloud"] : [])]);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}