import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPath = join(
  root,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "轻盘.app",
);
const dmgDir = join(root, "src-tauri", "target", "release", "bundle", "dmg");
const architecture = process.arch === "arm64" ? "aarch64" : "x64";
const dmgPath = join(dmgDir, `轻盘_0.1.0_${architecture}.dmg`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败，退出码 ${result.status ?? "unknown"}`);
  }
}

run(join(root, "node_modules", ".bin", "tauri"), ["build", "--bundles", "app"]);

if (!process.env.APPLE_SIGNING_IDENTITY) {
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
}
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

await mkdir(dmgDir, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), "qingpan-dmg-"));
try {
  await cp(appPath, join(stage, "轻盘.app"), { recursive: true });
  await symlink("/Applications", join(stage, "Applications"));
  run("hdiutil", [
    "create",
    "-volname",
    "轻盘",
    "-srcfolder",
    stage,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);
} finally {
  await rm(stage, { recursive: true, force: true });
}

console.log(`\n轻盘桌面安装包已生成：${dmgPath}`);
