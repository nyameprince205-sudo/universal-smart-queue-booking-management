const prisma = require("../config/db");
const {
  toJSONSafe
} = require("../utils/serialize");
async function submitContactForm(req, res) {
  const {
    name,
    email,
    phone,
    subject,
    message
  } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({
      error: "name, email, and message are required"
    });
  }
  await prisma.contactSubmission.create({
    data: {
      name,
      email,
      phone: phone || null,
      subject: subject || null,
      message
    }
  });
  return res.status(201).json({
    message: "Thanks — we'll get back to you soon."
  });
}
async function listContactSubmissions(req, res) {
  const {
    unreadOnly
  } = req.query;
  const submissions = await prisma.contactSubmission.findMany({
    where: unreadOnly === "true" ? {
      isRead: false
    } : {},
    orderBy: [{
      isRead: "asc"
    }, {
      createdAt: "desc"
    }]
  });
  return res.json(toJSONSafe(submissions));
}
async function markContactSubmissionRead(req, res) {
  const existing = await prisma.contactSubmission.findUnique({
    where: {
      id: BigInt(req.params.id)
    }
  });
  if (!existing) return res.status(404).json({
    error: "Submission not found"
  });
  const updated = await prisma.contactSubmission.update({
    where: {
      id: existing.id
    },
    data: {
      isRead: true
    }
  });
  return res.json(toJSONSafe(updated));
}
module.exports = {
  submitContactForm,
  listContactSubmissions,
  markContactSubmissionRead
};