import { env } from "../config/env";
import { verifyMpesaConnection } from "../lib/mpesa";

const required = [
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_CALLBACK_BASE_URL",
] as const;

const getValue = (key: (typeof required)[number]) => {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
};

async function main() {
  console.log("[RedCart] M-Pesa configuration check");

  if (!env.MPESA_ENABLED) {
    console.error("MPESA_ENABLED is false. Set MPESA_ENABLED=true to enable real STK push.");
    process.exit(1);
  }

  const missing = required.filter((key) => !getValue(key));

  if (missing.length) {
    console.error(`Missing required keys: ${missing.join(", ")}`);
    process.exit(1);
  }

  try {
    const result = await verifyMpesaConnection();
    console.log(`Mode: ${result.mode}`);
    console.log(`Base URL: ${result.baseUrl}`);
    console.log("OAuth access token: OK");
    console.log("M-Pesa setup is ready for STK push tests.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`M-Pesa connectivity check failed: ${message}`);
    process.exit(1);
  }
}

main();
