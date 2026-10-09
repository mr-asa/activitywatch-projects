// Stages the release: dist/stage/{app/<runtime files>, install.ps1}, then
// zips it to dist/activitywatch-projects.zip with a .sha256 next to it and
// copies install.ps1 as a separate release asset (the one-line installer).
// Usage: node scripts/build-release.mjs [--tag v1.2.3]   (the tag must match version.json)
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));
const { version } = json("version.json");
const tagAt = process.argv.indexOf("--tag");
if (tagAt > 0 && process.argv[tagAt + 1] !== `v${version}`)
  throw new Error(
    `Tag ${process.argv[tagAt + 1]} does not match version.json (${version}).`,
  );
if (json("package.json").version !== version)
  throw new Error("package.json and version.json versions differ.");
const dist = join(root, "dist");
const stage = join(dist, "stage");
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(stage, "app"), { recursive: true });
for (const file of json("runtime-files.json"))
  cpSync(join(root, file), join(stage, "app", file));
for (const script of ["install.ps1", "install.sh"])
  cpSync(join(root, script), join(stage, script));
for (const script of ["install.ps1", "install.sh"])
  cpSync(join(root, script), join(dist, script));
const zip = join(dist, "activitywatch-projects.zip");
if (process.platform === "win32")
  // bsdtar writes a normal zip with forward-slash paths (Compress-Archive in PowerShell 5.1 does not).
  execFileSync(
    join(process.env.SystemRoot, "System32", "tar.exe"),
    ["-a", "-c", "-f", zip, "-C", stage, "."],
    {
      stdio: "inherit",
    },
  );
else execFileSync("zip", ["-qr", zip, "."], { cwd: stage, stdio: "inherit" });
const hash = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${hash}  activitywatch-projects.zip\n`);
console.log(`Built ${zip} (${version}) sha256 ${hash}`);
