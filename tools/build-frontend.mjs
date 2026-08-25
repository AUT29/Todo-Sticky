import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const cloudConfig = getCloudConfig();

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "src"), { recursive: true });

await copyFile(join(root, "index.html"), join(dist, "index.html"));
await copyFile(join(root, "src", "app.js"), join(dist, "src", "app.js"));
await copyFile(join(root, "src", "domain.js"), join(dist, "src", "domain.js"));
await writeCloudConfig(cloudConfig);
await copyFile(join(root, "src", "styles.css"), join(dist, "src", "styles.css"));

console.log("Built frontend assets into dist/");

function jsString(value) {
  return JSON.stringify(String(value || ""));
}

function getCloudConfig() {
  const url = normalizeSupabaseUrl(process.env.TODO_STICKY_SUPABASE_URL);
  const anonKey = String(process.env.TODO_STICKY_SUPABASE_ANON_KEY || "").trim();
  const requireCloudConfig = process.argv.includes("--require-cloud");
  if (!url && !anonKey) {
    if (requireCloudConfig) throw new Error("TODO_STICKY_SUPABASE_URL and TODO_STICKY_SUPABASE_ANON_KEY are required for a login-ready installer.");
    return null;
  }
  if (!url || !anonKey) throw new Error("Set both TODO_STICKY_SUPABASE_URL and TODO_STICKY_SUPABASE_ANON_KEY, or set neither for local developer config.");
  if (isPlaceholderSupabaseUrl(url)) throw new Error("TODO_STICKY_SUPABASE_URL still looks like a placeholder project URL.");
  if (anonKey === "your-anon-public-key") throw new Error("TODO_STICKY_SUPABASE_ANON_KEY still contains the placeholder value.");
  if (!isProbablyJwt(anonKey)) throw new Error("TODO_STICKY_SUPABASE_ANON_KEY must be the Supabase anon public key, not a placeholder or random string.");
  verifySupabaseAnonKey(url, anonKey);
  return { url, anonKey };
}

async function writeCloudConfig(config) {
  if (!config) {
    await copyFile(join(root, "src", "cloud-config.js"), join(dist, "src", "cloud-config.js"));
    return;
  }
  await writeFile(
    join(dist, "src", "cloud-config.js"),
    [
      `export const BUILTIN_SUPABASE_URL = ${jsString(config.url)};`,
      `export const BUILTIN_SUPABASE_ANON_KEY = ${jsString(config.anonKey)};`,
      ""
    ].join("\n"),
    "utf8"
  );
  console.log("Embedded Supabase config for account login.");
}

function normalizeSupabaseUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https:\/\/[^\s/]+\.supabase\.co$/.test(url)) {
    throw new Error("TODO_STICKY_SUPABASE_URL must look like https://your-project.supabase.co");
  }
  return url;
}

function isPlaceholderSupabaseUrl(value) {
  const host = new URL(value).hostname.split(".")[0].toLowerCase();
  return ["demo", "example", "your-project"].includes(host);
}

function isProbablyJwt(value) {
  return value.length >= 80 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function verifySupabaseAnonKey(url, anonKey) {
  const projectRef = new URL(url).hostname.split(".")[0];
  let payload;
  try {
    payload = JSON.parse(Buffer.from(anonKey.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("TODO_STICKY_SUPABASE_ANON_KEY must be a readable Supabase JWT.");
  }
  if (payload.ref !== projectRef || payload.role !== "anon") {
    throw new Error("TODO_STICKY_SUPABASE_ANON_KEY does not match TODO_STICKY_SUPABASE_URL.");
  }
}
