"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiateMpesaStkPush = exports.verifyMpesaConnection = exports.normalizeKenyanPhoneNumber = void 0;
const env_1 = require("../config/env");
const appError_1 = require("../utils/appError");
const TOKEN_BUFFER_SECONDS = 60;
let cachedToken = null;
const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");
const getMpesaBaseUrl = () => {
    if (env_1.env.MPESA_BASE_URL) {
        return normalizeBaseUrl(env_1.env.MPESA_BASE_URL);
    }
    return env_1.env.MPESA_ENV === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";
};
const requireMpesaConfig = () => {
    if (!env_1.env.MPESA_ENABLED) {
        throw new appError_1.AppError("M-Pesa is not enabled in this environment", 503);
    }
    const missing = [];
    if (!env_1.env.MPESA_CONSUMER_KEY)
        missing.push("MPESA_CONSUMER_KEY");
    if (!env_1.env.MPESA_CONSUMER_SECRET)
        missing.push("MPESA_CONSUMER_SECRET");
    if (!env_1.env.MPESA_SHORTCODE)
        missing.push("MPESA_SHORTCODE");
    if (!env_1.env.MPESA_PASSKEY)
        missing.push("MPESA_PASSKEY");
    if (!env_1.env.MPESA_CALLBACK_BASE_URL)
        missing.push("MPESA_CALLBACK_BASE_URL");
    if (missing.length) {
        throw new appError_1.AppError(`Missing M-Pesa configuration: ${missing.join(", ")}`, 500);
    }
};
const normalizeKenyanPhoneNumber = (input) => {
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
    throw new appError_1.AppError("Invalid Kenyan phone number format for M-Pesa", 422);
};
exports.normalizeKenyanPhoneNumber = normalizeKenyanPhoneNumber;
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
    const credentials = Buffer.from(`${env_1.env.MPESA_CONSUMER_KEY}:${env_1.env.MPESA_CONSUMER_SECRET}`).toString("base64");
    const response = await fetch(`${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
        method: "GET",
        headers: {
            Authorization: `Basic ${credentials}`,
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new appError_1.AppError(`Unable to get M-Pesa access token: ${body}`, 502);
    }
    const json = (await response.json());
    if (!json.access_token) {
        throw new appError_1.AppError("M-Pesa access token response missing token", 502);
    }
    const expiresInSeconds = Number(json.expires_in ?? "3600");
    cachedToken = {
        value: json.access_token,
        expiresAt: Date.now() + Math.max(0, expiresInSeconds - TOKEN_BUFFER_SECONDS) * 1000,
    };
    return json.access_token;
};
const verifyMpesaConnection = async () => {
    const accessToken = await getMpesaAccessToken();
    return {
        mode: env_1.env.MPESA_ENV,
        baseUrl: getMpesaBaseUrl(),
        hasAccessToken: Boolean(accessToken),
    };
};
exports.verifyMpesaConnection = verifyMpesaConnection;
const initiateMpesaStkPush = async (input) => {
    requireMpesaConfig();
    const timestamp = getTimestamp();
    const password = Buffer.from(`${env_1.env.MPESA_SHORTCODE}${env_1.env.MPESA_PASSKEY}${timestamp}`).toString("base64");
    const accessToken = await getMpesaAccessToken();
    const amount = Math.max(1, Math.round(input.amount));
    const payload = {
        BusinessShortCode: env_1.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: env_1.env.MPESA_TRANSACTION_TYPE,
        Amount: amount,
        PartyA: input.phoneNumber,
        PartyB: env_1.env.MPESA_SHORTCODE,
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
    const json = (await response.json());
    if (!response.ok) {
        const message = json.errorMessage ?? json.ResponseDescription ?? "M-Pesa STK push request failed";
        throw new appError_1.AppError(message, 502);
    }
    if (!json.ResponseCode || !json.CheckoutRequestID || !json.MerchantRequestID) {
        throw new appError_1.AppError("Invalid M-Pesa STK push response", 502);
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
exports.initiateMpesaStkPush = initiateMpesaStkPush;
