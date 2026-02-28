import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logger } from "../config/logger";

interface OrderEmailPayload {
  orderId: string;
  email: string;
  name: string;
  total: number;
}

interface ReceiptEmailPayload {
  orderId: string;
  email: string;
  name: string;
  receiptNumber: string;
  pdfBuffer: Buffer;
}

export type EmailDispatchResult = {
  status: "sent" | "skipped" | "failed";
  reason?: string;
  messageId?: string;
};

let transporter: nodemailer.Transporter | null = null;

const smtpConfigured = () =>
  Boolean(env.SMTP_ENABLED && env.SMTP_HOST?.trim() && env.SMTP_PORT && env.SMTP_FROM?.trim());

const getSmtpAuth = () => {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.replace(/\s+/g, "");

  if (!user || !pass) {
    return undefined;
  }

  return { user, pass };
};

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: getSmtpAuth(),
  });

  return transporter;
};

const sendEmail = async (payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}): Promise<EmailDispatchResult> => {
  const normalizedTo = String(payload.to ?? "")
    .trim()
    .toLowerCase();
  if (!normalizedTo) {
    logger.warn(
      {
        type: "email_skipped",
        reason: "missing_recipient",
        subject: payload.subject,
      },
      "Recipient email is missing; email not sent",
    );
    return { status: "skipped", reason: "missing_recipient" };
  }

  if (!smtpConfigured()) {
    logger.warn(
      {
        type: "email_skipped",
        reason: "smtp_not_configured",
        to: normalizedTo,
        subject: payload.subject,
        smtpEnabled: env.SMTP_ENABLED,
        hasSmtpHost: Boolean(env.SMTP_HOST),
        hasSmtpPort: Boolean(env.SMTP_PORT),
        hasSmtpFrom: Boolean(env.SMTP_FROM),
      },
      "SMTP is disabled or incomplete; email not sent",
    );
    return { status: "skipped", reason: "smtp_not_configured" };
  }

  const mailer = getTransporter();
  try {
    const info = await mailer.sendMail({
      from: env.SMTP_FROM!.trim(),
      to: normalizedTo,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      attachments: payload.attachments,
    });

    logger.info(
      {
        type: "email_sent",
        to: normalizedTo,
        subject: payload.subject,
        messageId: info.messageId,
      },
      "Email delivered",
    );

    return { status: "sent", messageId: info.messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        type: "email_failed",
        to: normalizedTo,
        subject: payload.subject,
        reason,
        error,
      },
      "Email delivery failed",
    );
    return { status: "failed", reason };
  }
};

export const sendOrderConfirmationEmail = async (payload: OrderEmailPayload): Promise<EmailDispatchResult> => {
  logger.info(
    {
      type: "order_confirmation_email",
      orderId: payload.orderId,
      email: payload.email,
      total: payload.total,
    },
    `Email notification queued for ${payload.name}`,
  );

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

export const sendReceiptCopyEmail = async (payload: ReceiptEmailPayload): Promise<EmailDispatchResult> => {
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
