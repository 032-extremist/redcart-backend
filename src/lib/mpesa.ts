import { env } from "../config/env";
import { AppError } from "../utils/appError";

const TOKEN_BUFFER_SECONDS = 60;

let cachedToken: { value: string; expiresAt: number } | null = null;

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const getMpesaBaseUrl = () => {
  if (env.MPESA_BASE_URL) {
    return normalizeBaseUrl(env.MPESA_BASE_URL);
  }

  return env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
};

const requireMpesaConfig = () => {
  if (!env.MPESA_ENABLED) {
    throw new AppError("M-Pesa is not enabled in this environment", 503);
  }

  const missing: string[] = [];

  if (!env.MPESA_CONSUMER_KEY) missing.push("MPESA_CONSUMER_KEY");
  if (!env.MPESA_CONSUMER_SECRET) missing.push("MPESA_CONSUMER_SECRET");
  if (!env.MPESA_SHORTCODE) missing.push("MPESA_SHORTCODE");
  if (!env.MPESA_PASSKEY) missing.push("MPESA_PASSKEY");
  if (!env.MPESA_CALLBACK_BASE_URL) missing.push("MPESA_CALLBACK_BASE_URL");

  if (missing.length) {
    throw new AppError(`Missing M-Pesa configuration: ${missing.join(", ")}`, 500);
  }
};

export const normalizeKenyanPhoneNumber = (input: string) => {
  const digits = input.replace(/\D+/g, "");

  if (/^254\d{9}$/.test(digits)) {
    return digits;
  }

  if (/^0\d{9}$/.test(digits)) {
    return `254${digits.slice(1)}`;
  }

  if (/^\d{9}$/.test(digits)) {
    return `254${digits}`;
  }

  throw new AppError("Invalid Kenyan phone number format for M-Pesa", 422);
};

const getTimestamp = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");

  return `${yyyy}${mm}${dd}${hh}${min}${sec}`;
};

const getMpesaAccessToken = async () => {
  requireMpesaConfig();

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const credentials = Buffer.from(`${env.MPESA_CONSUMER_KEY!}:${env.MPESA_CONSUMER_SECRET!}`).toString("base64");
  const response = await fetch(`${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(`Unable to get M-Pesa access token: ${body}`, 502);
  }

  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: string;
  };

  if (!json.access_token) {
    throw new AppError("M-Pesa access token response missing token", 502);
  }

  const expiresInSeconds = Number(json.expires_in ?? "3600");
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(0, expiresInSeconds - TOKEN_BUFFER_SECONDS) * 1000,
  };

  return json.access_token;
};

export const verifyMpesaConnection = async () => {
  const accessToken = await getMpesaAccessToken();

  return {
    mode: env.MPESA_ENV,
    baseUrl: getMpesaBaseUrl(),
    hasAccessToken: Boolean(accessToken),
  };
};

export interface MpesaStkPushInput {
  amount: number;
  phoneNumber: string;
  reference: string;
  description: string;
  callbackUrl: string;
}

export interface MpesaStkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
  requestTimestamp: string;
}

export interface MpesaStkQueryInput {
  checkoutRequestId: string;
}

export interface MpesaStkQueryResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  resultCode: number | null;
  resultDesc: string | null;
  mpesaReceiptNumber: string | null;
  requestTimestamp: string;
  raw: unknown;
}

export const initiateMpesaStkPush = async (input: MpesaStkPushInput): Promise<MpesaStkPushResult> => {
  requireMpesaConfig();

  const timestamp = getTimestamp();
  const password = Buffer.from(`${env.MPESA_SHORTCODE!}${env.MPESA_PASSKEY!}${timestamp}`).toString("base64");
  const accessToken = await getMpesaAccessToken();
  const amount = Math.max(1, Math.round(input.amount));

  const payload = {
    BusinessShortCode: env.MPESA_SHORTCODE!,
    Password: password,
    Timestamp: timestamp,
    TransactionType: env.MPESA_TRANSACTION_TYPE,
    Amount: amount,
    PartyA: input.phoneNumber,
    PartyB: env.MPESA_SHORTCODE!,
    PhoneNumber: input.phoneNumber,
    CallBackURL: input.callbackUrl,
    AccountReference: input.reference,
    TransactionDesc: input.description,
  };

  const response = await fetch(`${getMpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as {
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    ResponseCode?: string;
    ResponseDescription?: string;
    CustomerMessage?: string;
    errorMessage?: string;
    errorCode?: string;
  };

  if (!response.ok) {
    const message = json.errorMessage ?? json.ResponseDescription ?? "M-Pesa STK push request failed";
    throw new AppError(message, 502);
  }

  if (!json.ResponseCode || !json.CheckoutRequestID || !json.MerchantRequestID) {
    throw new AppError("Invalid M-Pesa STK push response", 502);
  }

  return {
    merchantRequestId: json.MerchantRequestID,
    checkoutRequestId: json.CheckoutRequestID,
    responseCode: json.ResponseCode,
    responseDescription: json.ResponseDescription ?? "",
    customerMessage: json.CustomerMessage ?? "",
    requestTimestamp: timestamp,
  };
};

const toOptionalNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

export const queryMpesaStkPushStatus = async (input: MpesaStkQueryInput): Promise<MpesaStkQueryResult> => {
  requireMpesaConfig();

  const timestamp = getTimestamp();
  const password = Buffer.from(`${env.MPESA_SHORTCODE!}${env.MPESA_PASSKEY!}${timestamp}`).toString("base64");
  const accessToken = await getMpesaAccessToken();

  const payload = {
    BusinessShortCode: env.MPESA_SHORTCODE!,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: input.checkoutRequestId,
  };

  const response = await fetch(`${getMpesaBaseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as {
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    ResponseCode?: string;
    ResponseDescription?: string;
    ResultCode?: string | number;
    ResultDesc?: string;
    MpesaReceiptNumber?: string;
    errorMessage?: string;
    errorCode?: string;
  };

  if (!response.ok) {
    const message = json.errorMessage ?? json.ResponseDescription ?? "M-Pesa STK status query failed";
    throw new AppError(message, 502);
  }

  if (!json.ResponseCode) {
    throw new AppError("Invalid M-Pesa STK status response", 502);
  }

  return {
    merchantRequestId: json.MerchantRequestID ?? "",
    checkoutRequestId: json.CheckoutRequestID ?? input.checkoutRequestId,
    responseCode: json.ResponseCode,
    responseDescription: json.ResponseDescription ?? "",
    resultCode: toOptionalNumber(json.ResultCode),
    resultDesc: json.ResultDesc ?? null,
    mpesaReceiptNumber: json.MpesaReceiptNumber ?? null,
    requestTimestamp: timestamp,
    raw: json,
  };
};
