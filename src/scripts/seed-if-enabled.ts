import { spawnSync } from "node:child_process";

if (process.env.SEED_DATABASE_ON_BUILD !== "true") {
  console.log("Skipping database seed. Set SEED_DATABASE_ON_BUILD=true to seed during build.");
  process.exit(0);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", "prisma:seed"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
