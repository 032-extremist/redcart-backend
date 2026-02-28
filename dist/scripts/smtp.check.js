"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const env_1 = require("../config/env");
const args = process.argv.slice(2);
const sendTest = args.includes("--send-test");
const targetArg = args.find((arg) => arg.startsWith("--to="));
const testRecipient = targetArg?.slice(5) || env_1.env.SMTP_USER;
const getSmtpAuth = () => {
    const user = env_1.env.SMTP_USER?.trim();
    const pass = env_1.env.SMTP_PASS?.replace(/\s+/g, "");
    if (!user || !pass) {
        return undefined;
    }
    return { user, pass };
};
async function main() {
    console.log("[RedCart] SMTP configuration check");
    if (!env_1.env.SMTP_ENABLED) {
        console.error("SMTP_ENABLED=false. Set SMTP_ENABLED=true to enable email delivery.");
        process.exit(1);
    }
    const missing = [
        ["SMTP_HOST", env_1.env.SMTP_HOST],
        ["SMTP_PORT", env_1.env.SMTP_PORT],
        ["SMTP_FROM", env_1.env.SMTP_FROM],
    ].filter(([, value]) => !value);
    if (missing.length > 0) {
        console.error(`Missing SMTP config: ${missing.map(([name]) => name).join(", ")}`);
        process.exit(1);
    }
    if (!env_1.env.SMTP_USER || !env_1.env.SMTP_PASS) {
        console.warn("SMTP auth is not configured (SMTP_USER/SMTP_PASS). Continuing without auth.");
    }
    const transporter = nodemailer_1.default.createTransport({
        host: env_1.env.SMTP_HOST,
        port: env_1.env.SMTP_PORT,
        secure: env_1.env.SMTP_SECURE,
        auth: getSmtpAuth(),
    });
    try {
        await transporter.verify();
        console.log("SMTP verification: OK");
    }
    catch (error) {
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
                from: env_1.env.SMTP_FROM?.trim(),
                to: testRecipient,
                subject: "RedCart SMTP Test",
                text: "This is a test email from RedCart SMTP check.",
                html: "<p>This is a test email from <strong>RedCart SMTP check</strong>.</p>",
            });
            console.log(`Test email sent to ${testRecipient}. messageId=${info.messageId}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Test email failed: ${message}`);
            process.exit(1);
        }
    }
}
main();
