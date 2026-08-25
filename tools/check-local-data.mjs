import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.LOCALAPPDATA || process.env.APPDATA;
if (!base) throw new Error("LOCALAPPDATA or APPDATA is required to check local app data.");

const statePath = join(base, "Todo Sticky", "state.json");
const state = JSON.parse(await readFile(statePath, "utf8"));
if (!Array.isArray(state.tasks)) throw new Error("Local state tasks must be an array.");
if (!Array.isArray(state.customDates)) throw new Error("Local state customDates must be an array.");
if (!Array.isArray(state.timeline)) throw new Error("Local state timeline must be an array.");
if (!Array.isArray(state.ranges)) throw new Error("Local state ranges must be an array.");
if (!state.sync?.localOwnerId || !state.sync?.deviceId) throw new Error("Local sync identity is missing.");
if (state.sync?.enabled) {
  if (state.sync.provider !== "supabase") throw new Error("Enabled sync must use the Supabase provider.");
  if (!state.sync.accountId || !state.sync.accountEmail) throw new Error("Enabled sync account identity is missing.");
  if (!state.sync.accessToken && !state.sync.refreshToken) throw new Error("Enabled sync credentials are missing.");
}

const attachmentRefs = referencedAttachmentIds(state);
const attachmentIndex = await readAttachmentIndex(join(base, "Todo Sticky", "attachments.json"));
const indexedAttachments = new Map(attachmentIndex.map((item) => [item.id, item]));
const missingAttachmentIndex = attachmentRefs.filter((id) => !indexedAttachments.has(id));
const missingAttachmentFiles = [];
for (const item of attachmentIndex) {
  if (!item?.path) continue;
  try {
    await access(item.path);
  } catch {
    missingAttachmentFiles.push(item.id || item.path);
  }
}
if (missingAttachmentFiles.length) throw new Error(`Local attachment files are missing: ${missingAttachmentFiles.join(", ")}.`);

const summary = {
  path: statePath,
  tasks: state.tasks?.length ?? 0,
  customDates: state.customDates?.length ?? 0,
  ranges: state.ranges?.length ?? 0,
  timeline: state.timeline?.length ?? 0,
  sync: {
    provider: state.sync?.provider ?? null,
    enabled: Boolean(state.sync?.enabled),
    accountEmail: state.sync?.accountEmail ?? null,
    hasLocalOwnerId: Boolean(state.sync?.localOwnerId),
    hasDeviceId: Boolean(state.sync?.deviceId)
  },
  attachments: {
    referenced: attachmentRefs.length,
    indexed: attachmentIndex.length,
    missingNativeIndex: missingAttachmentIndex
  }
};

for (const [key, value] of Object.entries({ tasks: summary.tasks, customDates: summary.customDates, timeline: summary.timeline })) {
  const minimum = Number(process.env[`TODO_STICKY_MIN_${key.toUpperCase()}`] || 0);
  if (value < minimum) throw new Error(`Local data check failed: ${key} is ${value}, expected at least ${minimum}.`);
}

console.log(JSON.stringify(summary));

async function readAttachmentIndex(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function referencedAttachmentIds(state) {
  const html = [
    ...(state.tasks || []).map((task) => task.detailHtml),
    ...(state.timeline || []).map((item) => item.contentHtml)
  ].filter(Boolean).join("\n");
  return Array.from(new Set(Array.from(html.matchAll(/data-file-id="([^"]+)"/g), (match) => match[1])));
}
