"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const envBoolean = zod_1.z.preprocess((value) => {
    if (typeof value === "string") {
        return value.toLowerCase() === "true";
    }
    return value;
}, zod_1.z.boolean());
const optionalUrl = zod_1.z.preprocess((value) => {
    if (typeof value === "string" && value.trim() === "") {
        return undefined;
    }
    return value;
}, zod_1.z.string().url().optional());
const optionalString = zod_1.z.preprocess((value) => {
    if (typeof value === "string" && value.trim() === "") {
        return undefined;
    }
    return value;
}, zod_1.z.string().optional());
const optionalNumber = zod_1.z.preprocess((value) => {
    if (typeof value === "string" && value.trim() === "") {
        return undefined;
    }
    return value;
}, zod_1.z.coerce.number().optional());
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(["development", "test", "production"]).default("development"),
    PORT: zod_1.z.coerce.number().default(4000),
    DATABASE_URL: zod_1.z.string().min(1),
    JWT_SECRET: zod_1.z.string().min(16),
    JWT_EXPIRES_IN: zod_1.z.string().default("2h"),
    CLIENT_URL: zod_1.z.string().default("http://localhost:5173"),
    MPESA_ENABLED: envBoolean.default(false),
    MPESA_ENV: zod_1.z.enum(["sandbox", "production"]).default("sandbox"),
    MPESA_BASE_URL: optionalUrl,
    MPESA_CONSUMER_KEY: zod_1.z.string().optional(),
    MPESA_CONSUMER_SECRET: zod_1.z.string().optional(),
    MPESA_SHORTCODE: zod_1.z.string().optional(),
    MPESA_PASSKEY: zod_1.z.string().optional(),
    MPESA_CALLBACK_BASE_URL: optionalUrl,
    MPESA_TRANSACTION_TYPE: zod_1.z.enum(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]).default("CustomerPayBillOnline"),
    SMTP_ENABLED: envBoolean.default(false),
    SMTP_HOST: optionalString,
    SMTP_PORT: optionalNumber,
    SMTP_SECURE: envBoolean.default(false),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: optionalString,
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
    process.exit(1);
}
exports.env = parsed.data;
