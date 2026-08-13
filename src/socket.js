const { Server } = require("socket.io");

let io;

// Rooms, not a single global broadcast: a socket only joins the room for
// the ONE branch's queue board it's actually watching (a staff dashboard,
// a customer's phone, or a TV screen in a waiting room). That means
// broadcasting an update for Ocean View Restaurant's Osu branch never
// touches a socket watching Accra General Hospital's queue — the same
// tenant-isolation instinct from the REST API, applied to real-time events.
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: "*" }, // MVP-simple; tighten to your real frontend origin before production
  });

  io.on("connection", (socket) => {
    socket.on("join-branch-queue", (branchId) => {
      socket.join(branchRoomName(branchId));
    });

    socket.on("leave-branch-queue", (branchId) => {
      socket.leave(branchRoomName(branchId));
    });

    // A customer's OWN room — separate concept from a branch room above.
    // A customer's bookings can span multiple organizations and branches
    // (see customer.controller.js's getMyOrganizationHistory comment on
    // why customers are platform-wide, not org-scoped), so their live
    // updates can't be tied to any one branch room. Keyed by their own
    // customer id instead, so a booking status change anywhere reaches
    // them regardless of which business it came from — and reaches ONLY
    // them, never another customer watching their own bookings.
    socket.on("join-customer-updates", (customerId) => {
      socket.join(customerRoomName(customerId));
    });

    socket.on("leave-customer-updates", (customerId) => {
      socket.leave(customerRoomName(customerId));
    });
  });

  console.log("Socket.IO initialized");
  return io;
}

// Called by queue.controller.js after any mutation that changes what a
// branch's live board should show (check-in, call-next, serving, complete).
// Broadcasting the WHOLE current board (rather than a small "ticket X
// changed" delta) is a deliberate simplicity choice for the MVP — the
// client just replaces its list wholesale on every event instead of
// needing to merge deltas into local state. Revisit this if board size
// or event frequency ever makes that wasteful.
function emitQueueUpdate(branchId, board) {
  if (!io) return; // not initialized (e.g. under test) — no-op instead of crashing
  io.to(branchRoomName(branchId)).emit("queue:update", board);
}

// Called after a booking's status actually changes (checkIn linking a
// booking, completeTicket finishing one) — see queue.controller.js. Same
// "client just refetches wholesale" simplicity as emitQueueUpdate above;
// this event just says "something about your bookings changed," the
// client re-fetches its own list rather than trying to patch one record
// in place from a payload here.
function emitBookingUpdate(customerId) {
  if (!io) return;
  io.to(customerRoomName(customerId)).emit("booking:update");
}

function branchRoomName(branchId) {
  return `branch:${branchId}`;
}

function customerRoomName(customerId) {
  return `customer:${customerId}`;
}

function getIO() {
  return io;
}

module.exports = { initSocket, emitQueueUpdate, emitBookingUpdate, getIO };
