import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envBoolean = z.preprocess((value) => {
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return value;
}, z.boolean());

const optionalUrl = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().url().optional());

const optionalString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().optional());

const optionalNumber = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.coerce.number().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("2h"),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  MPESA_ENABLED: envBoolean.default(false),
  MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_BASE_URL: optionalUrl,
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_BASE_URL: optionalUrl,
  MPESA_TRANSACTION_TYPE: z.enum(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]).default("CustomerPayBillOnline"),
  SMTP_ENABLED: envBoolean.default(false),
  SMTP_HOST: optionalString,
  SMTP_PORT: optionalNumber,
  SMTP_SECURE: envBoolean.default(false),
  SMTP_FORCE_IPV4: envBoolean.default(true),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: optionalString,
  EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
  RESEND_API_KEY: optionalString,
  RESEND_FROM: optionalString,
  RESEND_API_BASE_URL: optionalUrl,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
