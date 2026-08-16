const crypto = require("crypto");
const PAYSTACK_BASE_URL = "https://api.paystack.co";
async function initializeTransaction({
  email,
  amountKobo,
  reference,
  callbackUrl,
  metadata
}) {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      amount: amountKobo,
      reference,
      callback_url: callbackUrl,
      metadata
    })
  });
  const data = await response.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack failed to initialize the transaction");
  }
  return data.data;
}
async function verifyTransaction(reference) {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
    }
  });
  const data = await response.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack failed to verify the transaction");
  }
  return data.data;
}
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expectedHash = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  const expected = Buffer.from(expectedHash, "utf8");
  const received = Buffer.from(signatureHeader, "utf8");
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}
module.exports = {
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature
};