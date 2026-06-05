import { Router, type IRouter } from "express";
import { db, draftsTable, mailboxesTable, emailQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { getGmailClient } from "../lib/gmail";
import { getTrackingSettings } from "../lib/tracking-settings";
import { decrypt } from "../lib/crypto";
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";

const router: IRouter = Router();

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function injectTracking(
  html: string,
  trackingId: string,
  baseUrl: string,
  openTracking: boolean,
  clickTracking: boolean
): string {
  let result = html;
  if (clickTracking) {
    result = result.replace(
      /(<a\s[^>]*href=["'])(https?:\/\/[^"']+)(["'])/gi,
      (_match, pre, url, post) => {
        const encoded = encodeURIComponent(url);
        return `${pre}${baseUrl}/api/track/click/${trackingId}?url=${encoded}${post}`;
      }
    );
  }
  if (openTracking) {
    const pixel = `<img src="${baseUrl}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`;
    result = result.includes("</body>")
      ? result.replace(/<\/body>/i, `${pixel}</body>`)
      : result + pixel;
  }
  return result;
}

router.get("/compose/status", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const [mailbox] = await db
    .select()
    .from(mailboxesTable)
    .where(eq(mailboxesTable.userId, user.id));

  res.json({
    gmail: {
      connected: !!user.gmailConnected && !!user.gmailAccessToken,
      email: user.gmailEmail ?? null,
    },
    smtp: {
      connected: !!mailbox,
      email: mailbox?.smtpUser ?? null,
      fromName: mailbox?.fromName ?? null,
      mailboxId: mailbox?.id ?? null,
    },
  });
});

router.post("/compose/send", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const {
    to,
    cc,
    bcc,
    subject,
    htmlBody,
    openTracking = false,
    clickTracking = false,
    attachments = [],
  } = req.body;

  if (!to || !subject || !htmlBody) {
    res.status(400).json({ error: "to, subject, and htmlBody are required" });
    return;
  }

  const [mailbox] = await db
    .select()
    .from(mailboxesTable)
    .where(eq(mailboxesTable.userId, user.id));

  if (!mailbox) {
    res.status(400).json({
      error: "No SMTP mailbox configured. Please set up your mailbox in Mailbox Settings.",
    });
    return;
  }

  const trackingId = openTracking || clickTracking ? randomUUID() : null;
  let finalHtml = htmlBody;

  if (trackingId) {
    try {
      const trackingSettings = await getTrackingSettings();
      const baseUrl =
        trackingSettings.trackingUrl ??
        `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
      finalHtml = injectTracking(htmlBody, trackingId, baseUrl, openTracking, clickTracking);
    } catch {
      logger.warn("[COMPOSE] Failed to get tracking settings — sending without tracking");
    }
  }

  const plainText = htmlToText(htmlBody);
  const fromAddress = mailbox.fromName
    ? `"${mailbox.fromName.replace(/"/g, "")}" <${mailbox.smtpUser}>`
    : mailbox.smtpUser;

  try {
    const pass = decrypt(mailbox.smtpPassEncrypted);
    const isSSL = mailbox.smtpSecure === "ssl";
    const isTLS = mailbox.smtpSecure === "tls";

    const transport = nodemailer.createTransport({
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      secure: isSSL,
      requireTLS: isTLS,
      auth: { user: mailbox.smtpUser, pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 20_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    } as any);

    const mailOptions: any = {
      from: fromAddress,
      to,
      subject,
      text: plainText,
      html: finalHtml,
      replyTo: mailbox.replyTo ?? undefined,
    };
    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;

    if (attachments.length > 0) {
      mailOptions.attachments = attachments.map((att: any) => ({
        filename: att.filename,
        content: Buffer.from(att.content, "base64"),
        contentType: att.contentType,
      }));
    }

    const info = await transport.sendMail(mailOptions);
    transport.close();

    logger.info({ to, subject, messageId: info.messageId }, "[COMPOSE] SMTP email sent");

    const jobId = randomUUID();
    await db
      .insert(emailQueueTable)
      .values({
        jobId,
        userId: user.id,
        mailboxId: mailbox.id,
        templateId: 0,
        email: typeof to === "string" ? to.split(",")[0].trim() : to,
        subject,
        rowDataJson: JSON.stringify({ email: to, cc: cc ?? "", bcc: bcc ?? "" }),
        style: "clean",
        useSignatureBuilder: false,
        status: "success",
        sentAt: new Date(),
        trackingId: trackingId ?? undefined,
      })
      .catch((e) =>
        logger.warn({ err: e.message }, "[COMPOSE] Failed to record in email_queue")
      );

    if (trackingId) {
      await db
        .insert(draftsTable)
        .values({
          userId: user.id,
          email: typeof to === "string" ? to.split(",")[0].trim() : to,
          subject,
          body: htmlBody,
          status: "sent",
          trackingId,
          sentAt: new Date(),
        })
        .catch((e) =>
          logger.warn({ err: e.message }, "[COMPOSE] Failed to record in drafts")
        );
    }

    res.json({ success: true, messageId: info.messageId });
  } catch (err: any) {
    logger.error({ err: err.message }, "[COMPOSE] SMTP send failed");
    res.status(500).json({ error: err.message ?? "Failed to send email" });
  }
});

router.post("/compose/draft", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const {
    to,
    cc,
    bcc,
    subject,
    htmlBody,
    openTracking = false,
    clickTracking = false,
  } = req.body;

  if (!subject || !htmlBody) {
    res.status(400).json({ error: "subject and htmlBody are required" });
    return;
  }

  if (!user.gmailConnected || !user.gmailAccessToken) {
    res.status(400).json({
      error: "Gmail not connected. Please connect Gmail in Settings.",
    });
    return;
  }

  const trackingId = openTracking || clickTracking ? randomUUID() : null;
  let finalHtml = htmlBody;

  if (trackingId) {
    try {
      const trackingSettings = await getTrackingSettings();
      const baseUrl =
        trackingSettings.trackingUrl ??
        `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
      finalHtml = injectTracking(htmlBody, trackingId, baseUrl, openTracking, clickTracking);
    } catch {
      logger.warn("[COMPOSE] Failed to get tracking settings for draft");
    }
  }

  const plainText = htmlToText(htmlBody);

  try {
    const gmail = await getGmailClient(user);
    const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
    const boundary = "====BROKERMAIL_COMPOSE====";

    const headerLines: string[] = [];
    if (to) headerLines.push(`To: ${to}`);
    if (cc) headerLines.push(`Cc: ${cc}`);
    if (bcc) headerLines.push(`Bcc: ${bcc}`);
    headerLines.push(`Subject: ${subjectEncoded}`);
    headerLines.push("MIME-Version: 1.0");
    headerLines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    const textB64 = Buffer.from(plainText, "utf-8").toString("base64");
    const htmlB64 = Buffer.from(finalHtml, "utf-8").toString("base64");

    const rawMessage = [
      ...headerLines,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      textB64,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      htmlB64,
      "",
      `--${boundary}--`,
    ].join("\r\n");

    const encoded = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const draft = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: encoded } },
    });

    const gmailDraftId = draft.data.id ?? "";
    logger.info({ to, subject, gmailDraftId }, "[COMPOSE] Gmail draft created");

    await db
      .insert(draftsTable)
      .values({
        userId: user.id,
        gmailDraftId,
        email: to ?? "",
        subject,
        body: htmlBody,
        status: "sent",
        trackingId: trackingId ?? undefined,
      })
      .catch((e) =>
        logger.warn({ err: e.message }, "[COMPOSE] Failed to record draft in DB")
      );

    res.json({ success: true, gmailDraftId });
  } catch (err: any) {
    logger.error({ err: err.message }, "[COMPOSE] Gmail draft creation failed");
    res.status(500).json({ error: err.message ?? "Failed to create Gmail draft" });
  }
});

export default router;
