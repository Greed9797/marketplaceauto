import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

const TARGET_SCHEMA = "w3marketplace";
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);

if (!output || !path.isAbsolute(output) || output === path.parse(output).root) {
  console.error("Use --output=/absolute/path/to/w3marketplace-backup.dump.");
  process.exit(1);
}
try {
  await stat(output);
  console.error("Refusing to overwrite an existing backup.");
  process.exit(1);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL is required.");
  process.exit(1);
}
const url = new URL(process.env.DIRECT_URL);
const databaseName = url.pathname.replace(/^\//, "");
if (!url.hostname || !databaseName) {
  console.error("DIRECT_URL is invalid.");
  process.exit(1);
}

const args = [
  "--host",
  url.hostname,
  "--port",
  url.port || "5432",
  "--username",
  decodeURIComponent(url.username),
  "--dbname",
  databaseName,
  "--schema",
  TARGET_SCHEMA,
  "--format",
  "custom",
  "--no-owner",
  "--no-privileges",
  "--file",
  output,
];
const child = spawn("pg_dump", args, {
  env: {
    ...process.env,
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || "require",
  },
  stdio: "inherit",
  shell: false,
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) reject(new Error(`pg_dump stopped by ${signal}.`));
    else resolve(code ?? 1);
  });
});
if (exitCode !== 0) {
  console.error(`pg_dump failed with exit code ${exitCode}.`);
  process.exit(exitCode);
}
const info = await stat(output);
if (!info.isFile() || info.size === 0) {
  console.error("Backup verification failed.");
  process.exit(1);
}
console.log(JSON.stringify({ backup: output, schema: TARGET_SCHEMA, bytes: info.size }));
