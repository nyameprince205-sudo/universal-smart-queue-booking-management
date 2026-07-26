// Wraps an async route handler so any thrown error (or rejected promise)
// is forwarded to Express's error-handling middleware instead of crashing
// the process or requiring a try/catch in every single controller.
//
// Usage:
//   router.get("/", asyncHandler(async (req, res) => { ... }));

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
