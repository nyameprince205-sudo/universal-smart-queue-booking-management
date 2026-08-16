const prisma = require("../config/db");
const {
  Resend
} = require("resend");
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: process.env.ARKESEL_SENDER_ID || "USQBMS",
        message,
        recipients: [phone]
      })
    });
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
  console.log(`[WHATSAPP STUB] to ${phone}: ${message}`);
  return true;
}
async function sendEmail(email, message) {
  if (!resend) {
    console.log(`[EMAIL STUB — no RESEND_API_KEY set] to ${email}: ${message}`);
    return true;
  }
  try {
    const {
      data,
      error
    } = await resend.emails.send({
      from: process.env.NOTIFICATION_FROM_EMAIL || "Universal Smart Queue & Booking Management System <onboarding@resend.dev>",
      to: email,
      subject: "Universal Smart Queue & Booking Management System Notification",
      text: message
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
const SENDERS = {
  sms: sendSms,
  whatsapp: sendWhatsapp,
  email: sendEmail
};
async function getPreferredChannel(organizationId) {
  const settings = await prisma.organizationSettings.findUnique({
    where: {
      organizationId
    }
  });
  const prefs = settings?.notificationSettings || {};
  if (prefs.sms !== false) return "sms";
  if (prefs.whatsapp) return "whatsapp";
  if (prefs.email) return "email";
  return "sms";
}
async function notify({
  organizationId,
  recipientType,
  recipientId,
  channel,
  message
}) {
  const notification = await prisma.notification.create({
    data: {
      organizationId,
      recipientType,
      recipientId,
      channel,
      message,
      status: "pending"
    }
  });
  let contact = null;
  if (recipientType === "customer") {
    const customer = await prisma.customer.findUnique({
      where: {
        id: recipientId
      }
    });
    contact = channel === "email" ? customer?.email : customer?.phone;
  } else {
    const user = await prisma.user.findUnique({
      where: {
        id: recipientId
      }
    });
    contact = channel === "email" ? user?.email : user?.phone;
  }
  let sent = false;
  if (!contact) {
    console.warn(`[notify] no ${channel} contact on file for ${recipientType} ${recipientId} — marking failed`);
  } else {
    sent = await SENDERS[channel](contact, message);
  }
  await prisma.notification.update({
    where: {
      id: notification.id
    },
    data: {
      status: sent ? "sent" : "failed",
      sentAt: sent ? new Date() : null
    }
  });
  return sent;
}
function notifyInBackground(params) {
  notify(params).catch(err => {
    console.error("[notify] background notification failed:", err.message);
  });
}
module.exports = {
  notify,
  notifyInBackground,
  getPreferredChannel,
  sendEmail,
  sendSms
};