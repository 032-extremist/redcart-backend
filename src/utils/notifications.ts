import nodemailer from "nodemailer";
import dns from "node:dns/promises";
import net from "node:net";
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

type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

let transporter: nodemailer.Transporter | null = null;
let transporterKey: string | null = null;

const smtpConfigured = () =>
  Boolean(env.SMTP_ENABLED && env.SMTP_HOST?.trim() && env.SMTP_PORT && env.SMTP_FROM?.trim());

const resendConfigured = () => Boolean(env.RESEND_API_KEY?.trim() && (env.RESEND_FROM?.trim() || env.SMTP_FROM?.trim()));

const getSmtpAuth = () => {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.replace(/\s+/g, "");

  if (!user || !pass) {
    return undefined;
  }

  return { user, pass };
};

const resolveSmtpConnectHost = async (host: string) => {
  const normalized = host.trim();
  if (!normalized || net.isIP(normalized)) {
    return {
      connectHost: normalized,
      servername: undefined as string | undefined,
      source: "literal",
    };
  }

  if (!env.SMTP_FORCE_IPV4) {
    return {
      connectHost: normalized,
      servername: normalized,
      source: "hostname",
    };
  }

  try {
    const resolved = await dns.lookup(normalized, { family: 4 });
    return {
      connectHost: resolved.address,
      servername: normalized,
      source: "ipv4_lookup",
    };
  } catch (error) {
    logger.warn(
      {
        type: "smtp_ipv4_lookup_failed",
        host: normalized,
        reason: error instanceof Error ? error.message : String(error),
      },
      "Could not resolve SMTP host to IPv4; falling back to hostname",
    );

    return {
      connectHost: normalized,
      servername: normalized,
      source: "hostname_fallback",
    };
  }
};

const getTransporter = async () => {
  const host = env.SMTP_HOST?.trim() ?? "";
  const port = env.SMTP_PORT ?? 587;
  const secure = env.SMTP_SECURE;
  const resolved = await resolveSmtpConnectHost(host);
  const auth = getSmtpAuth();
  const key = [
    resolved.connectHost,
    port,
    secure ? "secure" : "starttls",
    auth?.user ?? "anonymous",
    env.SMTP_FORCE_IPV4 ? "ipv4" : "default",
  ].join("|");

  if (transporter && transporterKey === key) {
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: resolved.connectHost,
    port,
    secure,
    auth,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    tls: {
      servername: resolved.servername,
    },
  });
  transporterKey = key;

  logger.info(
    {
      type: "smtp_transport_created",
      host: resolved.connectHost,
      originalHost: host,
      source: resolved.source,
      port,
      secure,
      forceIpv4: env.SMTP_FORCE_IPV4,
    },
    "SMTP transport initialized",
  );

  return transporter;
};

const sendViaResend = async (payload: EmailPayload, normalizedTo: string): Promise<EmailDispatchResult> => {
  if (!resendConfigured()) {
    logger.warn(
      {
        type: "email_skipped",
        reason: "resend_not_configured",
        provider: "resend",
        to: normalizedTo,
        subject: payload.subject,
        hasApiKey: Boolean(env.RESEND_API_KEY),
        hasFrom: Boolean(env.RESEND_FROM || env.SMTP_FROM),
      },
      "Resend is selected but configuration is incomplete; email not sent",
    );
    return { status: "skipped", reason: "resend_not_configured" };
  }

  const apiKey = env.RESEND_API_KEY!.trim();
  const fromAddress = (env.RESEND_FROM?.trim() || env.SMTP_FROM?.trim()) as string;
  const baseUrl = (env.RESEND_API_BASE_URL ?? "https://api.resend.com").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/emails`;

  const requestBody = {
    from: fromAddress,
    to: [normalizedTo],
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    attachments: payload.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content.toString("base64"),
      ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
    })),
  };

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: abort.signal,
    });

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const parsedRecord = parsed as Record<string, unknown> | null;
      const errorObject =
        parsedRecord && typeof parsedRecord.error === "object" && parsedRecord.error !== null
          ? (parsedRecord.error as Record<string, unknown>)
          : null;
      const errorMessage =
        (errorObject && typeof errorObject.message === "string" ? errorObject.message : null) ||
        (parsedRecord && typeof parsedRecord.message === "string" ? parsedRecord.message : null) ||
        `HTTP ${response.status}`;

      logger.error(
        {
          type: "email_failed",
          provider: "resend",
          to: normalizedTo,
          subject: payload.subject,
          reason: errorMessage,
          statusCode: response.status,
        },
        "Email delivery failed",
      );
      return { status: "failed", reason: errorMessage };
    }

    const parsedRecord = parsed as Record<string, unknown> | null;
    const messageId = parsedRecord && typeof parsedRecord.id === "string" ? parsedRecord.id : undefined;

    logger.info(
      {
        type: "email_sent",
        provider: "resend",
        to: normalizedTo,
        subject: payload.subject,
        messageId,
      },
      "Email delivered",
    );

    return { status: "sent", messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    logger.error(
      {
        type: "email_failed",
        provider: "resend",
        to: normalizedTo,
        subject: payload.subject,
        reason,
        error,
      },
      "Email delivery failed",
    );
    return { status: "failed", reason };
  } finally {
    clearTimeout(timeout);
  }
};

const sendViaSmtp = async (payload: EmailPayload, normalizedTo: string): Promise<EmailDispatchResult> => {
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

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const mailer = await getTransporter();
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
          attempt,
        },
        "Email delivered",
      );

      return { status: "sent", messageId: info.messageId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (attempt === 1) {
        logger.warn(
          {
            type: "email_retry",
            to: normalizedTo,
            subject: payload.subject,
            reason,
          },
          "Email send failed on first attempt; retrying with a fresh SMTP transport",
        );

        transporter = null;
        transporterKey = null;
        continue;
      }

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
  }

  return { status: "failed", reason: "unknown_email_failure" };
};

const sendEmail = async (payload: EmailPayload): Promise<EmailDispatchResult> => {
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

  if (env.EMAIL_PROVIDER === "resend") {
    return sendViaResend(payload, normalizedTo);
  }

  return sendViaSmtp(payload, normalizedTo);
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
