import { readdir, readFile, stat } from "node:fs/promises";

const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const rootFiles = await readdir(".");
if (rootFiles.some((name) => /^pet-.*\.png$/i.test(name))) throw new Error("Removed desktop pet debug screenshots must not stay in the project root.");
const app = await readFile("src/app.js", "utf8");
const html = await readFile("index.html", "utf8");
if (!html.includes("<title>\u5f85\u529e\u5c0f\u4fbf\u7b7e</title>")) throw new Error("HTML title must stay readable Chinese UTF-8.");
if (!/function imagePreviewSrc[\s\S]*nativeAttachmentPreviewSrc/.test(app) || !app.includes('invokeWindow("read_attachment"')) throw new Error("Image preview must fall back to native attachments for cloud-pulled files.");
if (!/async function downloadAttachment[\s\S]*readNativeAttachment/.test(app)) throw new Error("Attachment download must fall back to native attachments for cloud-pulled files.");
if (!/function pruneImagePreviewCache[\s\S]*URL\.revokeObjectURL/.test(app) || !app.includes("pruneImagePreviewCache();")) throw new Error("Image preview object URLs must be pruned after render.");
if (!/function insertRichImage[\s\S]*URL\.createObjectURL\(file\)[\s\S]*imageSrcByFileId\.set\(id, src\)/.test(app)) throw new Error("Pasted image preview URLs must use the pruned image cache.");
if (!/async function putFile[\s\S]*const nativeSaved = await saveNativeAttachment[\s\S]*if \(nativeSaved\) return/.test(app) || !/async function getStoredFile[\s\S]*catch \(error\)[\s\S]*return null/.test(app)) throw new Error("Desktop attachments must fall back when IndexedDB is unavailable.");
if (!/async function startApp[\s\S]*repairNativeAttachmentsFromIndexedDb\(\)[\s\S]*scheduleStartupSync/.test(app) || !/async function repairNativeAttachmentsFromIndexedDb[\s\S]*referencedAttachmentIds\(state\)[\s\S]*saveNativeAttachment/.test(app)) throw new Error("Startup must repair native attachments from IndexedDB before cloud sync.");
if (!/function finishTitleEdit[\s\S]*if \(!nextTitle\.trim\(\)\)[\s\S]*node\.textContent = currentTask\.title/.test(app)) throw new Error("Todo title editing must not save an empty title.");
if (!/function update\(mutator, options = \{\}\)[\s\S]*options\.render !== false/.test(app) || !app.includes("saveDetail(node.dataset.detailId, { render: false })") || !/function finishTitleEdit[\s\S]*\{ render: false \}/.test(app)) throw new Error("Blur saves must not rerender and swallow button clicks.");
if (!/function saveDetail[\s\S]*currentTask\.detailHtml[\s\S]*=== detailHtml\) return/.test(app)) throw new Error("Unchanged detail blur must not rewrite state.");
if (!/function bindTimelineAutosave[\s\S]*scheduleTimelineAutosave/.test(app) || !/function saveTimelineInline\(id, options = \{\}\)[\s\S]*render: closeEditor/.test(app) || !/function renderTimelinePanel[\s\S]*editingId \? .*back-timeline-edit[\s\S]*add-timeline-inline/.test(app)) throw new Error("Timeline editor must autosave and keep the return action beside add.");
if (!/data-action="delete-timeline"/.test(app) || !/async function deleteTimeline[\s\S]*openModal[\s\S]*timeline: s\.timeline\.filter/.test(app)) throw new Error("Timeline list must expose confirmed deletion.");
if (!/function deleteDateBlock[\s\S]*dateInBlock\(task\.date, block\)/.test(app) || !/function dateInBlock[\s\S]*block\.startDate <= date && date <= block\.endDate/.test(app)) throw new Error("Deleting a range block must delete tasks inside the whole range.");
if (!/function renderDatePanel[\s\S]*tasksForDatePanel\(date, range\)/.test(app) || !/function tasksForDatePanel[\s\S]*dateInBlock\(task\.date, range\)/.test(app)) throw new Error("Range panels must show tasks from the whole range.");
const rust = await readFile("src-tauri/src/main.rs", "utf8");
const styles = await readFile("src/styles.css", "utf8");
if (!app.includes("TIMELINE_WINDOW_WIDTH = 760") || !/async function toggleTimelinePanel[\s\S]*set_window_width[\s\S]*timelineRestoreWidth/.test(app)) throw new Error("Opening the timeline must widen the desktop window instead of overlaying the note.");
if (!rust.includes("fn set_window_width") || !rust.includes("set_window_width,")) throw new Error("Desktop must expose set_window_width for side panels.");
if (!/#app\.timeline-open[\s\S]*grid-template-columns:\s*380px 350px/.test(styles) || !/#app\.timeline-open \.timeline-panel[\s\S]*position:\s*static/.test(styles)) throw new Error("Timeline panel must render beside the note, not overlay it.");
const domain = await readFile("src/domain.js", "utf8");
if (app.includes("set_pet_mode") || rust.includes("set_pet_mode") || styles.includes("with-pet-config")) throw new Error("Removed desktop pet window sizing must not come back.");
if (/get_window_frame|close_aux_window|minimize_main_window|close_main_window|close-main/.test(app + rust)) throw new Error("Removed auxiliary pet/config window commands must not come back.");
if (/createPetState|normalizePetState|\bpet\s*:/.test(domain)) throw new Error("Removed desktop pet state must not come back.");
if (!app.includes("loadBrowserState()") || !app.includes("newestState(await loadNativeState(), loadBrowserState())")) throw new Error("Startup must choose the newest local state copy, not blindly prefer AppData.");
if (app.includes("  saveState();\n  render();\n  scheduleStartupSync();")) throw new Error("Startup local write must not schedule a cloud push.");
if (!/if \(action === "close"\) await closeApp\(\);[\s\S]*async function closeApp\(\)[\s\S]*await nativeSaveQueue/.test(app)) throw new Error("Close button must wait for AppData save queue before closing.");
const nsis = config.bundle?.windows?.nsis;
if (JSON.stringify(config.bundle?.targets) !== JSON.stringify(["nsis"])) throw new Error("Release installer must target exactly one NSIS setup exe.");
if (nsis?.installMode !== "both") throw new Error('NSIS installMode must be "both" so users can choose install mode.');
if (!packageJson.scripts?.["build:installer"]?.includes("--require-cloud")) throw new Error("Default installer build must require embedded cloud config.");

const requireCloudConfig = process.argv.includes("--require-cloud");
if (requireCloudConfig) {
  const cloudConfig = await readFile("dist/src/cloud-config.js", "utf8");
  if (!/BUILTIN_SUPABASE_URL = "https:\/\/[^"]+\.supabase\.co"/.test(cloudConfig)) throw new Error("Cloud installer must embed the Supabase URL.");
  if (!/BUILTIN_SUPABASE_ANON_KEY = "[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/.test(cloudConfig)) throw new Error("Cloud installer must embed the Supabase anon public key.");
}

const installerScript = await readFile("src-tauri/target/release/nsis/x64/installer.nsi", "utf8");
if (!installerScript.includes("!insertmacro MUI_PAGE_DIRECTORY")) throw new Error("NSIS installer must include the install directory page.");
if (!/CreateShortcut "\$SMPROGRAMS[^"]*\$\{PRODUCTNAME\}\.lnk" "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/.test(installerScript)) throw new Error("NSIS installer must create a Start Menu shortcut.");
if (!/CreateShortcut "\$DESKTOP\\\$\{PRODUCTNAME\}\.lnk" "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/.test(installerScript)) throw new Error("NSIS installer must create a desktop shortcut.");

const releaseExe = await stat("src-tauri/target/release/daibanshixiang.exe");
if (releaseExe.size <= 0) throw new Error("Release desktop exe is empty.");

const setupDir = "src-tauri/target/release/bundle/nsis";
const setupFiles = (await readdir(setupDir)).filter((name) => name.endsWith("-setup.exe"));
if (setupFiles.length !== 1) throw new Error(`Expected exactly one NSIS setup exe, found ${setupFiles.length}.`);
for (const file of setupFiles) {
  const info = await stat(`${setupDir}/${file}`);
  if (info.size <= 0) throw new Error(`NSIS setup exe is empty: ${file}`);
}

console.log("release checks passed");
