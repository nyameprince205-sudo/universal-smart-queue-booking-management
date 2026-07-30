const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const routes = require("./routes");
const errorHandler = require("./middleware/error.middleware");

// This file builds the Express app but does NOT start it listening — that
// separation (app.js vs server.js) is deliberate and pays off the moment
// you write automated tests: a test file can `require("./app")` and make
// requests against it directly (via supertest) without ever binding a real
// port. If app.js and server.js were merged, every test run would fight
// over port 4000.
const app = express();

// --- Global middleware, in an order that matters ---

// 1. CORS must run before routes so preflight requests are handled correctly.
app.use(cors());

// 2. morgan logs every incoming request — invaluable while you're building
//    and testing manually with Postman; "dev" format is concise and colorized.
app.use(morgan("dev"));

// 3. Body parsers must run before any route that reads req.body.
// The `verify` hook stashes the exact raw bytes onto req.rawBody BEFORE
// Express parses them into JSON — the Paystack webhook needs those exact
// original bytes to verify the signature (a re-serialized JSON.stringify
// of the parsed body can differ in whitespace/key order and would make
// every signature check fail). Every other route ignores req.rawBody
// entirely; this costs nothing for routes that don't need it.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// --- Routes ---
app.use("/api/v1", routes);

// Catch-all for unmatched routes — without this, a typo'd URL returns
// Express's default (ugly, implementation-detail-leaking) HTML 404 page.
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Error handler MUST be registered last — Express identifies error-handling
// middleware by its four-argument signature (err, req, res, next), and only
// calls it when something upstream calls next(err) or throws inside an
// async handler wrapped by asyncHandler.
app.use(errorHandler);

module.exports = app;
