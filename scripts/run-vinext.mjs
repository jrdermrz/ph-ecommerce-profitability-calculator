import { spawn } from "node:child_process";

const commandName = process.argv[2];
const allowedCommands = new Set(["dev", "build", "start"]);

if (!allowedCommands.has(commandName)) {
  console.error("Expected one of: dev, build, start");
  process.exit(1);
}

const isWindows = process.platform === "win32";
const executable = isWindows ? process.env.ComSpec ?? "cmd.exe" : "node_modules/.bin/vinext";
const args = isWindows
  ? ["/d", "/s", "/c", `node_modules\\.bin\\vinext.cmd ${commandName}`]
  : [commandName];

const child = spawn(executable, args, {
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
  },
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
