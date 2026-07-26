// Express treats any middleware with FOUR arguments (err, req, res, next) as
// an error handler. Because asyncHandler forwards every thrown error here
// via next(err), this is the one place that decides what error responses
// look like — instead of every controller inventing its own error shape.
function errorHandler(err, req, res, next) {
  console.error(err);

  // Prisma's "unique constraint failed" error — surface it as a clean 409
  // instead of a raw stack trace leaking internal column names to the client.
  if (err.code === "P2002") {
    return res.status(409).json({
      error: "A record with that value already exists.",
    });
  }

  // Prisma's "record not found" error (e.g. .update() on a missing id).
  if (err.code === "P2025") {
    return res.status(404).json({ error: "Record not found." });
  }

  const status = err.status || 500;
  const message =
    status === 500 && process.env.NODE_ENV === "production"
      ? "Something went wrong."
      : err.message;

  return res.status(status).json({ error: message });
}

module.exports = errorHandler;
