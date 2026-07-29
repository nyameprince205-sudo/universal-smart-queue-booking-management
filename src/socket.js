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
      socket.join(roomName(branchId));
    });

    socket.on("leave-branch-queue", (branchId) => {
      socket.leave(roomName(branchId));
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
  io.to(roomName(branchId)).emit("queue:update", board);
}

function roomName(branchId) {
  return `branch:${branchId}`;
}

function getIO() {
  return io;
}

module.exports = { initSocket, emitQueueUpdate, getIO };
