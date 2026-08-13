const prisma = require("../config/db");
const { Resend } = require("resend");

// Real providers now wired in, one function at a time exactly as this
// file's original comment said they would be — nothing outside this file
// changed. booking.controller.js, queue.controller.js, staff.controller.js,
// and everywhere else that calls notify()/notifyInBackground() needed zero
// changes to start sending real emails and real texts.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Arkesel has no official Node SDK — their own documentation uses plain
// fetch() calls directly against the REST API, so that's what this does
// too rather than pulling in an unnecessary dependency.
const ARKESEL_SEND_URL = "https://sms.arkesel.com/api/v2/sms/send";

async function sendSms(phone, message) {
  if (!process.env.ARKESEL_API_KEY) {
    console.log(`[SMS STUB — no ARKESEL_API_KEY set] to ${phone}: ${message}`);
    return true;
  }
  try {
    const response = await fetch(ARKESEL_SEND_URL, {
      method: "POST",
      headers: {
        "api-key": process.env.ARKESEL_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Arkesel enforces an 11-character limit on sender IDs — the full
        // project name can't fit here the way it can in an email's from
        // name below, so this stays short. Override via ARKESEL_SENDER_ID
        // once you've registered your own short sender ID with Arkesel.
        sender: process.env.ARKESEL_SENDER_ID || "USQBMS",
        message,
        recipients: [phone],
      }),
    });

    // The HTTP status code is the most reliable success/failure signal
    // Arkesel documents (401/400/403/422 for the various failure modes) —
    // checked first and primarily, rather than depending on one exact
    // error body shape that older third-party wrappers for this same API
    // don't even agree on (some use a completely different response
    // format from an older version of this API).
    if (!response.ok) {
      const body = await response.text();
      console.error(`[SMS] Arkesel rejected the send to ${phone} (HTTP ${response.status}):`, body);
      return false;
    }

    const data = await response.json();
    const success = data?.status === "success";
    if (!success) {
      console.warn(`[SMS] Arkesel returned 200 but did not report success for ${phone}:`, JSON.stringify(data));
    }
    return success;
  } catch (err) {
    console.error(`[SMS] Arkesel send failed for ${phone}:`, err.message || err);
    return false;
  }
}

async function sendWhatsapp(phone, message) {
  // Still a stub — a real WhatsApp Business API integration needs its own
  // separate business approval process this project doesn't need yet.
  // Email and SMS were the two channels asked for.
  console.log(`[WHATSAPP STUB] to ${phone}: ${message}`);
  return true;
}

async function sendEmail(email, message) {
  if (!resend) {
    console.log(`[EMAIL STUB — no RESEND_API_KEY set] to ${email}: ${message}`);
    return true;
  }
  try {
    const { data, error } = await resend.emails.send({
      // onboarding@resend.dev is Resend's own shared test sender — works
      // immediately with zero domain setup, exactly for this kind of
      // "does this actually work" testing. Swap FROM_EMAIL once you've
      // verified your own domain with Resend for real production sending.
      from: process.env.NOTIFICATION_FROM_EMAIL || "Universal Smart Queue & Booking Management System <onboarding@resend.dev>",
      to: email,
      subject: "Universal Smart Queue & Booking Management System Notification",
      text: message,
    });
    if (error) {
      console.error(`[EMAIL] Resend rejected the send to ${email}:`, error.message || error);
      return false;
    }
    return !!data?.id;
  } catch (err) {
    console.error(`[EMAIL] Resend send failed for ${email}:`, err.message || err);
    return false;
  }
}

const SENDERS = { sms: sendSms, whatsapp: sendWhatsapp, email: sendEmail };

async function getPreferredChannel(organizationId) {
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId } });
  const prefs = settings?.notificationSettings || {};
  if (prefs.sms !== false) return "sms";
  if (prefs.whatsapp) return "whatsapp";
  if (prefs.email) return "email";
  return "sms";
}

async function notify({ organizationId, recipientType, recipientId, channel, message }) {
  const notification = await prisma.notification.create({
    data: { organizationId, recipientType, recipientId, channel, message, status: "pending" },
  });

  let contact = null;
  if (recipientType === "customer") {
    const customer = await prisma.customer.findUnique({ where: { id: recipientId } });
    contact = channel === "email" ? customer?.email : customer?.phone;
  } else {
    const user = await prisma.user.findUnique({ where: { id: recipientId } });
    contact = channel === "email" ? user?.email : user?.phone;
  }

  let sent = false;
  if (!contact) {
    console.warn(`[notify] no ${channel} contact on file for ${recipientType} ${recipientId} — marking failed`);
  } else {
    sent = await SENDERS[channel](contact, message);
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: sent ? "sent" : "failed", sentAt: sent ? new Date() : null },
  });

  return sent;
}

function notifyInBackground(params) {
  notify(params).catch((err) => {
    console.error("[notify] background notification failed:", err.message);
  });
}

module.exports = { notify, notifyInBackground, getPreferredChannel, sendEmail, sendSms };
