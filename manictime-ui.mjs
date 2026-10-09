import { openModal } from "./dialogs.mjs";
import { hours, prepareImport, runImport } from "./manictime-core.mjs";
const BIG_FILE = 400 * 1024 * 1024;
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
// The SQLite engine (sql.js, WebAssembly) is loaded only when needed.
let engine;
function loadEngine() {
  engine ??= new Promise((resolve, reject) => {
    const script = node("script");
    script.src = "./vendor/sql-wasm.js";
    script.onload = () =>
      window
        .initSqlJs({ locateFile: (file) => `./vendor/${file}` })
        .then(resolve, reject);
    script.onerror = () => reject(Error("Could not load the SQLite engine."));
    document.head.append(script);
  });
  return engine;
}
function queryOf(db) {
  return (sql, params = []) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      const out = [];
      while (statement.step()) out.push(statement.getAsObject());
      return out;
    } finally {
      statement.free();
    }
  };
}
// "Import ManicTime": the same import as scripts/import-manictime.mjs, with
// the database read in the browser (the file is never uploaded anywhere).
export function setupManicTime({ api, load, notice, resizeFrame }) {
  const button = node("button", "Import ManicTime");
  button.type = "button";
  document.getElementById("tool-buttons").append(button);
  const dialog = node("dialog", undefined, "workflow-dialog");
  dialog.id = "manictime-dialog";
  const heading = node("div", undefined, "dialog-heading");
  const close = node("button", "Close");
  close.type = "button";
  close.onclick = () => dialog.close();
  heading.append(node("h2", "Import ManicTime history"), close);
  const intro = node(
    "p",
    "Brings your ManicTime history into ActivityWatch: only the time before ActivityWatch's first recording, so nothing is overwritten or double-counted. The file is read in this browser and never uploaded.",
  );
  const sizeNote = node(
    "p",
    "This is the simple way for a small database: the file is loaded into memory, roughly twice its size. For a very large one (about 400 MB or more) use the command-line script instead: node scripts/import-manictime.mjs (needs Node.js 22+; see the header of the script).",
    "field-help",
  );
  const where = node(
    "p",
    "Choose ManicTimeReports.db, usually in %LOCALAPPDATA%\\Finkit\\ManicTime. Closing ManicTime first makes sure the latest data is in the file.",
    "field-help",
  );
  const file = node("input");
  file.type = "file";
  file.accept = ".db,.sqlite,.sqlite3";
  file.setAttribute("aria-label", "ManicTime database");
  const summary = node("p", "", "field-help");
  summary.setAttribute("role", "status");
  const confirmLabel = node("label", undefined, "check-label");
  const confirm = node("input");
  confirm.type = "checkbox";
  confirmLabel.append(
    confirm,
    " I understand the import adds events to my ActivityWatch history and cannot be undone here.",
  );
  confirmLabel.hidden = true;
  const run = node("button", "Import into ActivityWatch");
  run.type = "button";
  run.disabled = true;
  const actions = node("div", undefined, "dialog-actions");
  actions.append(node("span", undefined, "spacer"), run);
  dialog.append(
    heading,
    intro,
    sizeNote,
    where,
    file,
    summary,
    confirmLabel,
    actions,
  );
  document.body.append(dialog);
  let prepared = null;
  const reset = () => {
    prepared = null;
    summary.textContent = "";
    confirm.checked = false;
    confirmLabel.hidden = true;
    run.disabled = true;
  };
  button.onclick = () => {
    file.value = "";
    reset();
    openModal(dialog);
    resizeFrame?.();
  };
  file.onchange = async () => {
    reset();
    const chosen = file.files[0];
    if (!chosen) return;
    try {
      summary.textContent =
        chosen.size > BIG_FILE
          ? "Reading a large file in the browser; this can fail for lack of memory (then use the script)…"
          : "Reading…";
      const SQL = await loadEngine();
      const db = new SQL.Database(new Uint8Array(await chosen.arrayBuffer()));
      try {
        prepared = await prepareImport({ api, query: queryOf(db) });
      } finally {
        db.close();
      }
      const { windows, afk, firstReal, first } = prepared;
      summary.textContent = `Found ${windows.length} window events (${hours(windows)} h) and ${afk.length} activity events (active ${hours(afk, (e) => e.data.status === "not-afk")} h) from ${first ? new Date(first).toLocaleDateString() : "—"} up to ${new Date(firstReal).toLocaleDateString()}, where ActivityWatch's own history begins.`;
      if (!windows.length && !afk.length)
        summary.textContent =
          "Nothing to import before ActivityWatch's first recording.";
      else {
        confirmLabel.hidden = false;
        run.disabled = !confirm.checked;
      }
    } catch (error) {
      summary.textContent = `Could not read this file: ${error.message}`;
    }
  };
  confirm.onchange = () => {
    run.disabled = !confirm.checked || !prepared;
  };
  run.onclick = async () => {
    run.disabled = true;
    file.disabled = true;
    try {
      await runImport({
        api,
        prepared,
        progress: (id, done, total) => {
          summary.textContent = `${id}: ${done} / ${total}`;
        },
      });
      dialog.close();
      await load();
      notice("ManicTime history imported.", "success");
    } catch (error) {
      summary.textContent = `Import failed: ${error.message}`;
    } finally {
      file.disabled = false;
    }
  };
}
