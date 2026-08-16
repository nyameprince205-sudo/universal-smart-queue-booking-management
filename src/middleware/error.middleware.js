function errorHandler(err, req, res, next) {
  console.error(err);
  if (err.code === "P2002") {
    return res.status(409).json({
      error: "A record with that value already exists."
    });
  }
  if (err.code === "P2025") {
    return res.status(404).json({
      error: "Record not found."
    });
  }
  const status = err.status || 500;
  const message = status === 500 && process.env.NODE_ENV === "production" ? "Something went wrong." : err.message;
  return res.status(status).json({
    error: message
  });
}
module.exports = errorHandler;