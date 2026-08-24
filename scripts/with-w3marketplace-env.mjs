import { spawn } from "node:child_process";

const TARGET_SCHEMA = "w3marketplace";
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node --env-file=.env scripts/with-w3marketplace-env.mjs <command> [...args]");
  process.exit(1);
}

const childEnv = { ...process.env };
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  const raw = childEnv[key];
  if (!raw) {
    console.error(`${key} is required.`);
    process.exit(1);
  }
  const url = new URL(raw);
  url.searchParams.set("schema", TARGET_SCHEMA);
  childEnv[key] = url.toString();
}

const child = spawn(command, args, {
  env: childEnv,
  stdio: "inherit",
  shell: false,
});

child.once("error", (error) => {
  console.error(`Could not start ${command}: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`${command} stopped by ${signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
