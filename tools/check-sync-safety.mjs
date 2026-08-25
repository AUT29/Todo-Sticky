import { readFile } from "node:fs/promises";

const app = await readFile("src/app.js", "utf8");
const start = app.indexOf("function cloudSafeSyncState(sync) {");
const end = app.indexOf("async function pushAttachmentsToSupabase", start);
if (start < 0 || end < 0) throw new Error("cloudSafeSyncState is missing.");
const body = app.slice(start, end);
for (const field of ["supabaseUrl", "supabaseAnonKey", "accessToken", "refreshToken", "localOwnerId"]) {
  if (!body.includes(field)) throw new Error(`cloudSafeSyncState must strip ${field}.`);
}
if (!body.includes("accessToken: null") || !body.includes("refreshToken: null")) {
  throw new Error("Cloud sync state must write null auth tokens.");
}
if (!app.includes("loginSupabaseEmailAccount") || !app.includes("grant_type=password")) {
  throw new Error("Email/password login is missing.");
}
if (!app.includes("const remoteState = runRollover(normalizeState(remote.state), todayKey());")) throw new Error("Cloud-pulled state must run local rollover before rendering.");
if (!/async function applyRemoteState[\s\S]*try \{[\s\S]*pullAttachmentsFromSupabase[\s\S]*Attachment pull skipped[\s\S]*const remoteState = runRollover/.test(app)) throw new Error("Cloud-pulled state must not be blocked by attachment pull failures.");
const accountStart = app.indexOf("async function handleAccountResult(result) {");
const accountEnd = app.indexOf("function isEmail(value) {", accountStart);
if (accountStart < 0 || accountEnd < 0) throw new Error("Account handler is missing.");
const accountBody = app.slice(accountStart, accountEnd);
if (!accountBody.includes("loginSupabaseEmailAccount(loginSync, password)")) throw new Error("Account login must use a prepared loginSync.");
if (!accountBody.includes("resetSyncAccount(nextSync)")) throw new Error("Account switching must clear credentials before login without saving them first.");
if (accountBody.includes("state = { ...state, sync: nextSync };\n  saveState();")) throw new Error("Account changes must not be saved before login succeeds.");
if (!app.includes("isEmailConfirmationError") || !app.includes("not confirmed") || !app.includes("/auth/v1/resend")) {
  throw new Error("Email confirmation flow is missing.");
}
if (!app.includes("isEmailRateLimitError") || !app.includes("email rate limit exceeded")) {
  throw new Error("Email rate limit handling is missing.");
}
if (app.includes("sendSupabaseOtp") || app.includes("verifySupabaseOtp") || app.includes("/auth/v1/otp") || app.includes("pseudoAccountEmail")) {
  throw new Error("Email/password sync must not use OTP or pseudo-account emails.");
}
if (/password:\s*[^,}]+/.test(body)) {
  throw new Error("Cloud sync state must not store passwords.");
}

if (!/async function pushStateToSupabase[\s\S]*await nativeSaveQueue/.test(app)) {
  throw new Error("Cloud push must wait for pending AppData saves.");
}
const pushAttachmentsStart = app.indexOf("async function pushAttachmentsToSupabase");
const pullAttachmentsStart = app.indexOf("async function pullAttachmentsFromSupabase");
if (pushAttachmentsStart < 0 || pullAttachmentsStart < 0) throw new Error("Attachment sync functions are missing.");
const pushAttachmentsBody = app.slice(pushAttachmentsStart, pullAttachmentsStart);
const pullAttachmentsBody = app.slice(pullAttachmentsStart, app.indexOf("function attachmentStoragePath", pullAttachmentsStart));
if (!pushAttachmentsBody.includes("Attachment upload skipped") || !pushAttachmentsBody.includes("try {") || !pushAttachmentsBody.includes("catch (error)")) {
  throw new Error("Attachment upload failures must not block state sync.");
}
if (!pullAttachmentsBody.includes("Attachment download skipped") || !pullAttachmentsBody.includes("try {") || !pullAttachmentsBody.includes("catch (error)")) {
  throw new Error("Attachment download failures must not block state sync.");
}

console.log("sync safety checks passed");
