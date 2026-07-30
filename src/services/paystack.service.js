const crypto = require("crypto");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

// Starts a payment: Paystack returns a hosted checkout page URL. Your
// frontend (Phase 15) redirects the Org Admin's browser there — nothing
// about card details ever touches your own server, which is exactly why
// hosted checkout is the right choice for an MVP over building your own
// card form (that path drags you into PCI-DSS compliance for something a
// student SaaS project has no business handling directly).
async function initializeTransaction({ email, amountKobo, reference, callbackUrl, metadata }) {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: amountKobo, // Paystack works in the smallest currency unit (kobo/pesewas), never whole cedis
      reference,
      callback_url: callbackUrl,
      metadata,
    }),
  });

  const data = await response.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack failed to initialize the transaction");
  }
  return data.data; // { authorization_url, access_code, reference }
}

// Used two ways in this codebase: (1) the webhook handler calls this after
// verifying the signature, as a double-check that the event is genuine
// before trusting it, and (2) the manual /verify endpoint calls it directly
// — useful for LOCAL DEVELOPMENT, where Paystack's webhook literally cannot
// reach your machine (it can't POST to localhost:4000 from the internet).
// Real deployments should rely on the webhook; manual verify is a dev-time
// stand-in for it, not a replacement.
async function verifyTransaction(reference) {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const data = await response.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack failed to verify the transaction");
  }
  return data.data; // { status: 'success' | 'failed' | 'abandoned', amount, reference, metadata, ... }
}

// Paystack signs every webhook payload with your secret key so you can
// prove a request claiming to be Paystack actually came from Paystack, not
// from anyone who discovered your webhook URL. This is a TIMING-SAFE
// comparison (crypto.timingSafeEqual), not a plain === — a naive string
// comparison leaks timing information an attacker could exploit to guess
// the correct signature one byte at a time. Small detail, real security
// property.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  const expectedHash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  const expected = Buffer.from(expectedHash, "utf8");
  const received = Buffer.from(signatureHeader, "utf8");

  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

module.exports = { initializeTransaction, verifyTransaction, verifyWebhookSignature };
