import PDFDocument from "pdfkit";
import { Router } from "express";
import { z } from "zod";
import { logger } from "../../config/logger";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendReceiptCopyEmail } from "../../utils/notifications";
import { getReceiptByIdForUser, getReceiptByOrderForUser } from "./receipts.service";

const router = Router();

const receiptIdSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ receiptId: z.string().min(1) }),
});

const orderIdSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ orderId: z.string().min(1) }),
});

type ReceiptLineItem = {
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

type ReceiptData = Awaited<ReturnType<typeof getReceiptByIdForUser>>;

const asReceiptItems = (value: unknown): ReceiptLineItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const row = entry as Record<string, unknown>;

      return {
        productName: typeof row.productName === "string" ? row.productName : "Unknown Item",
        quantity: Number(row.quantity ?? 0),
        unitPrice: Number(row.unitPrice ?? 0),
        subtotal: Number(row.subtotal ?? 0),
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && Number.isFinite(item.unitPrice) && Number.isFinite(item.subtotal));
};

const money = (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`;

const renderReceiptPdf = (doc: PDFKit.PDFDocument, receipt: ReceiptData, items: ReceiptLineItem[]) => {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  doc.save();
  doc.rect(0, 0, pageWidth, 92).fill("#C40000");
  doc.restore();

  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(22).text("RedCart Receipt", 48, 30);
  doc.font("Helvetica").fontSize(10).text(`Receipt # ${receipt.receiptNumber}`, 48, 60);

  let y = 110;

  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(12).text("Receipt Details", 48, y);
  y += 18;

  doc.font("Helvetica").fontSize(10);
  doc.text(`Order ID: ${receipt.orderId}`, 48, y);
  y += 14;
  doc.text(`Payment Reference: ${receipt.payment.transactionRef ?? "N/A"}`, 48, y);
  y += 14;
  doc.text(`Issued At: ${new Date(receipt.issuedAt).toLocaleString()}`, 48, y);
  y += 20;

  doc.font("Helvetica-Bold").fontSize(12).text("Payer Information", 48, y);
  y += 18;

  doc.font("Helvetica").fontSize(10);
  doc.text(`Payer Name: ${receipt.payerName ?? "Unavailable"}`, 48, y);
  y += 14;
  doc.text(`Payer Phone: ${receipt.payerPhone ?? "Unavailable"}`, 48, y);
  y += 14;
  doc.text(`Payer Name Source: ${receipt.payerNameSource}`, 48, y);
  y += 20;

  doc.font("Helvetica-Bold").fontSize(12).text("Shipping Information", 48, y);
  y += 18;

  doc.font("Helvetica").fontSize(10);
  doc.text(`Name: ${receipt.order.shippingName}`, 48, y);
  y += 14;
  doc.text(`Phone: ${receipt.order.shippingPhone}`, 48, y);
  y += 14;
  doc.text(`Email: ${receipt.order.shippingEmail}`, 48, y);
  y += 14;
  doc.text(
    `Address: ${receipt.order.shippingStreet}, ${receipt.order.shippingCity}, ${receipt.order.shippingCountry}`,
    48,
    y,
  );
  y += 24;

  const drawTableHeader = () => {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#111111")
      .text("Item", 48, y, { width: 240 })
      .text("Qty", 300, y, { width: 40, align: "right" })
      .text("Unit", 350, y, { width: 90, align: "right" })
      .text("Subtotal", 450, y, { width: 90, align: "right" });

    y += 14;
    doc.moveTo(48, y).lineTo(pageWidth - 48, y).strokeColor("#DDDDDD").stroke();
    y += 8;
  };

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text("Items", 48, y);
  y += 18;
  drawTableHeader();

  for (const item of items) {
    if (y > pageHeight - 120) {
      doc.addPage({ margin: 48 });
      y = 48;
      drawTableHeader();
    }

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#111111")
      .text(item.productName, 48, y, { width: 240 })
      .text(String(item.quantity), 300, y, { width: 40, align: "right" })
      .text(money(item.unitPrice, receipt.currency), 350, y, { width: 90, align: "right" })
      .text(money(item.subtotal, receipt.currency), 450, y, { width: 90, align: "right" });

    y += 16;
  }

  y += 8;
  doc.moveTo(320, y).lineTo(pageWidth - 48, y).strokeColor("#DDDDDD").stroke();
  y += 10;

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#111111")
    .text("Subtotal", 350, y, { width: 90, align: "right" })
    .text(money(receipt.subtotal, receipt.currency), 450, y, { width: 90, align: "right" });
  y += 14;

  doc
    .text("Tax", 350, y, { width: 90, align: "right" })
    .text(money(receipt.tax, receipt.currency), 450, y, { width: 90, align: "right" });
  y += 14;

  doc
    .text("Shipping", 350, y, { width: 90, align: "right" })
    .text(money(receipt.shippingFee, receipt.currency), 450, y, { width: 90, align: "right" });
  y += 14;

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Total", 350, y, { width: 90, align: "right" })
    .text(money(receipt.total, receipt.currency), 450, y, { width: 90, align: "right" });
};

const generateReceiptPdfBuffer = (receipt: ReceiptData) => {
  const items = asReceiptItems(receipt.itemsSnapshot);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: `Receipt ${receipt.receiptNumber}`,
        Author: "RedCart",
      },
    });

    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    doc.on("error", reject);

    renderReceiptPdf(doc, receipt, items);
    doc.end();
  });
};

router.use(authenticate);

router.get("/order/:orderId", validate(orderIdSchema), async (req, res, next) => {
  try {
    const receipt = await getReceiptByOrderForUser(req.params.orderId, req.auth!.userId);
    res.json(receipt);
  } catch (error) {
    next(error);
  }
});

router.get("/:receiptId", validate(receiptIdSchema), async (req, res, next) => {
  try {
    const receipt = await getReceiptByIdForUser(req.params.receiptId, req.auth!.userId);
    res.json(receipt);
  } catch (error) {
    next(error);
  }
});

router.get("/:receiptId/download", validate(receiptIdSchema), async (req, res, next) => {
  try {
    const receipt = await getReceiptByIdForUser(req.params.receiptId, req.auth!.userId);

    const pdfBuffer = await generateReceiptPdfBuffer(receipt);
    const emailResult = await sendReceiptCopyEmail({
      orderId: receipt.orderId,
      email: receipt.order.shippingEmail,
      name: receipt.order.shippingName || "Customer",
      receiptNumber: receipt.receiptNumber,
      pdfBuffer,
    });

    logger.info(
      {
        type: "receipt_email_dispatch",
        receiptId: receipt.id,
        orderId: receipt.orderId,
        receiptNumber: receipt.receiptNumber,
        recipientEmail: receipt.order.shippingEmail,
        status: emailResult.status,
        reason: emailResult.reason,
        messageId: emailResult.messageId,
      },
      "Processed receipt copy email dispatch",
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${receipt.receiptNumber}.pdf"`);
    res.setHeader("X-Receipt-Email-Status", emailResult.status);
    if (emailResult.reason) {
      res.setHeader("X-Receipt-Email-Reason", emailResult.reason);
    }
    if (emailResult.messageId) {
      res.setHeader("X-Receipt-Email-Message-Id", emailResult.messageId);
    }
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

export default router;
