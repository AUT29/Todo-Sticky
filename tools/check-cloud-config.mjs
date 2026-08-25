import { cp, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const cloudEnv = {
  ...process.env,
  TODO_STICKY_SUPABASE_URL: "https://codexcheck.supabase.co",
  TODO_STICKY_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvZGV4Y2hlY2siLCJyb2xlIjoiYW5vbiJ9.cccccccccccccccccccccccccccccccc"
};

const backupDir = await mkdtemp(join(tmpdir(), "todo-sticky-dist-"));
const backupDist = join(backupDir, "dist");
try {
  await cp("dist", backupDist, { recursive: true, force: true });
  await run(process.execPath, ["tools/build-frontend.mjs", "--require-cloud"], { env: cloudEnv });
  await run(process.execPath, ["tools/check-release.mjs", "--require-cloud"]);
  console.log("cloud config checks passed");
} finally {
  await rm("dist", { recursive: true, force: true });
  await cp(backupDist, "dist", { recursive: true, force: true }).catch(() => {});
  await rm(backupDir, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, ...options });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}