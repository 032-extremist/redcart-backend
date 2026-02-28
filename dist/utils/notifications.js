"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendReceiptCopyEmail = exports.sendOrderConfirmationEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const env_1 = require("../config/env");
const logger_1 = require("../config/logger");
let transporter = null;
const smtpConfigured = () => Boolean(env_1.env.SMTP_ENABLED && env_1.env.SMTP_HOST?.trim() && env_1.env.SMTP_PORT && env_1.env.SMTP_FROM?.trim());
const getSmtpAuth = () => {
    const user = env_1.env.SMTP_USER?.trim();
    const pass = env_1.env.SMTP_PASS?.replace(/\s+/g, "");
    if (!user || !pass) {
        return undefined;
    }
    return { user, pass };
};
const getTransporter = () => {
    if (transporter) {
        return transporter;
    }
    transporter = nodemailer_1.default.createTransport({
        host: env_1.env.SMTP_HOST,
        port: env_1.env.SMTP_PORT,
        secure: env_1.env.SMTP_SECURE,
        auth: getSmtpAuth(),
    });
    return transporter;
};
const sendEmail = async (payload) => {
    const normalizedTo = String(payload.to ?? "")
        .trim()
        .toLowerCase();
    if (!normalizedTo) {
        logger_1.logger.warn({
            type: "email_skipped",
            reason: "missing_recipient",
            subject: payload.subject,
        }, "Recipient email is missing; email not sent");
        return { status: "skipped", reason: "missing_recipient" };
    }
    if (!smtpConfigured()) {
        logger_1.logger.warn({
            type: "email_skipped",
            reason: "smtp_not_configured",
            to: normalizedTo,
            subject: payload.subject,
            smtpEnabled: env_1.env.SMTP_ENABLED,
            hasSmtpHost: Boolean(env_1.env.SMTP_HOST),
            hasSmtpPort: Boolean(env_1.env.SMTP_PORT),
            hasSmtpFrom: Boolean(env_1.env.SMTP_FROM),
        }, "SMTP is disabled or incomplete; email not sent");
        return { status: "skipped", reason: "smtp_not_configured" };
    }
    const mailer = getTransporter();
    try {
        const info = await mailer.sendMail({
            from: env_1.env.SMTP_FROM.trim(),
            to: normalizedTo,
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
            attachments: payload.attachments,
        });
        logger_1.logger.info({
            type: "email_sent",
            to: normalizedTo,
            subject: payload.subject,
            messageId: info.messageId,
        }, "Email delivered");
        return { status: "sent", messageId: info.messageId };
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger_1.logger.error({
            type: "email_failed",
            to: normalizedTo,
            subject: payload.subject,
            reason,
            error,
        }, "Email delivery failed");
        return { status: "failed", reason };
    }
};
const sendOrderConfirmationEmail = async (payload) => {
    logger_1.logger.info({
        type: "order_confirmation_email",
        orderId: payload.orderId,
        email: payload.email,
        total: payload.total,
    }, `Email notification queued for ${payload.name}`);
    return sendEmail({
        to: payload.email,
        subject: `RedCart Order Confirmation - ${payload.orderId}`,
        text: `Hello ${payload.name}, your order ${payload.orderId} has been confirmed. Total paid: ${payload.total.toFixed(2)} KES.`,
        html: `
        <div style="font-family: Arial, sans-serif; color: #111;">
          <h2 style="color: #C40000;">RedCart Order Confirmed</h2>
          <p>Hello ${payload.name},</p>
          <p>Your order <strong>${payload.orderId}</strong> has been confirmed.</p>
          <p>Total paid: <strong>${payload.total.toFixed(2)} KES</strong></p>
        </div>
      `,
    });
};
exports.sendOrderConfirmationEmail = sendOrderConfirmationEmail;
const sendReceiptCopyEmail = async (payload) => {
    return sendEmail({
        to: payload.email,
        subject: `RedCart Receipt Copy - ${payload.receiptNumber}`,
        text: `Hello ${payload.name}, attached is your receipt copy (${payload.receiptNumber}) for order ${payload.orderId}.`,
        html: `
        <div style="font-family: Arial, sans-serif; color: #111;">
          <h2 style="color: #C40000;">RedCart Receipt Copy</h2>
          <p>Hello ${payload.name},</p>
          <p>As requested, a copy of your receipt is attached.</p>
          <p>Receipt: <strong>${payload.receiptNumber}</strong></p>
          <p>Order: <strong>${payload.orderId}</strong></p>
        </div>
      `,
        attachments: [
            {
                filename: `${payload.receiptNumber}.pdf`,
                content: payload.pdfBuffer,
                contentType: "application/pdf",
            },
        ],
    });
};
exports.sendReceiptCopyEmail = sendReceiptCopyEmail;
