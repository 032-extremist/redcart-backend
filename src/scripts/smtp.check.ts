import nodemailer from "nodemailer";
import { env } from "../config/env";

const args = process.argv.slice(2);
const sendTest = args.includes("--send-test");
const targetArg = args.find((arg) => arg.startsWith("--to="));
const testRecipient = targetArg?.slice(5) || env.SMTP_USER;

const getSmtpAuth = () => {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.replace(/\s+/g, "");

  if (!user || !pass) {
    return undefined;
  }

  return { user, pass };
};

async function main() {
  console.log("[RedCart] SMTP configuration check");

  if (!env.SMTP_ENABLED) {
    console.error("SMTP_ENABLED=false. Set SMTP_ENABLED=true to enable email delivery.");
    process.exit(1);
  }

  const missing = [
    ["SMTP_HOST", env.SMTP_HOST],
    ["SMTP_PORT", env.SMTP_PORT],
    ["SMTP_FROM", env.SMTP_FROM],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    console.error(`Missing SMTP config: ${missing.map(([name]) => name).join(", ")}`);
    process.exit(1);
  }

  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn("SMTP auth is not configured (SMTP_USER/SMTP_PASS). Continuing without auth.");
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: getSmtpAuth(),
  });

  try {
    await transporter.verify();
    console.log("SMTP verification: OK");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`SMTP verification failed: ${message}`);
    process.exit(1);
  }

  if (sendTest) {
    if (!testRecipient) {
      console.error("No test recipient available. Provide --to=<email> or set SMTP_USER.");
      process.exit(1);
    }

    try {
      const info = await transporter.sendMail({
        from: env.SMTP_FROM?.trim(),
        to: testRecipient,
        subject: "RedCart SMTP Test",
        text: "This is a test email from RedCart SMTP check.",
        html: "<p>This is a test email from <strong>RedCart SMTP check</strong>.</p>",
      });

      console.log(`Test email sent to ${testRecipient}. messageId=${info.messageId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Test email failed: ${message}`);
      process.exit(1);
    }
  }
}

main();
