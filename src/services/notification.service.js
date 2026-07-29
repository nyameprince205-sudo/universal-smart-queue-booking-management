const prisma = require("../config/db");

// STUBBED CHANNEL SENDERS
// Every real provider (Africa's Talking for SMS, WhatsApp Business API,
// Nodemailer/SendGrid for email) gets wired in here later, one function at
// a time. Because every sender has the SAME shape — async, takes a contact
// and a message, returns true/false for success — swapping a stub for the
// real thing is a one-line change inside ONE function, not a rewrite of
// anything that calls this service. Nothing in booking.controller.js or
// queue.controller.js needs to change when you plug in a real SMS account.
async function sendSms(phone, message) {
  console.log(`[SMS STUB] to ${phone}: ${message}`);
  return true;
}

async function sendWhatsapp(phone, message) {
  console.log(`[WHATSAPP STUB] to ${phone}: ${message}`);
  return true;
}

async function sendEmail(email, message) {
  console.log(`[EMAIL STUB] to ${email}: ${message}`);
  return true;
}

const SENDERS = { sms: sendSms, whatsapp: sendWhatsapp, email: sendEmail };

// Reads an organization's configured channel preference (from
// organization_settings.notification_settings — set back in Phase 4's
// schema, e.g. {"sms": true, "whatsapp": true, "email": false}) and picks
// the first enabled channel, sms > whatsapp > email. Falls back to sms if
// settings are missing entirely, so notifications never silently go
// nowhere just because an org never touched their settings.
async function getPreferredChannel(organizationId) {
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId } });
  const prefs = settings?.notificationSettings || {};
  if (prefs.sms !== false) return "sms";
  if (prefs.whatsapp) return "whatsapp";
  if (prefs.email) return "email";
  return "sms"; // last-resort default
}

// The single entry point every other controller calls. Always records the
// attempt FIRST with status "pending" — "did we even try to notify this
// person" should never be unanswerable, even if sending then fails.
async function notify({ organizationId, recipientType, recipientId, channel, message }) {
  const notification = await prisma.notification.create({
    data: { organizationId, recipientType, recipientId, channel, message, status: "pending" },
  });

  // The caller only ever has a recipientId — contact details (phone/email)
  // live on the customer/user record itself, so we look them up here
  // rather than making every call site fetch them first.
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

// Fire-and-forget wrapper for callers that must NEVER let a notification
// failure affect their own response — a booking or a queue check-in has
// already succeeded by the time this runs; a flaky SMS provider should
// never turn that into a 500 error for the customer standing at the desk.
function notifyInBackground(params) {
  notify(params).catch((err) => {
    console.error("[notify] background notification failed:", err.message);
  });
}

module.exports = { notify, notifyInBackground, getPreferredChannel };
