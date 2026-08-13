const prisma = require("../config/db");

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

// sendEmail exported directly too — auth.controller.js's forgotPassword/
// resendVerification and customer.controller.js's forgotPassword all
// import it directly (bypassing notify()'s DB-tracked pipeline, since a
// password reset link is time-sensitive and doesn't need a persisted
// Notification record the way a booking update does). It was defined
// here all along but never actually exported — every caller importing it
// was getting `undefined` and crashing the instant it tried to send.
module.exports = { notify, notifyInBackground, getPreferredChannel, sendEmail };
