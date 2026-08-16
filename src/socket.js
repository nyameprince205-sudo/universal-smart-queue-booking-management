const {
  Server
} = require("socket.io");
let io;
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173"
    }
  });
  io.on("connection", socket => {
    socket.on("join-branch-queue", branchId => {
      socket.join(branchRoomName(branchId));
    });
    socket.on("leave-branch-queue", branchId => {
      socket.leave(branchRoomName(branchId));
    });
    socket.on("join-customer-updates", customerId => {
      socket.join(customerRoomName(customerId));
    });
    socket.on("leave-customer-updates", customerId => {
      socket.leave(customerRoomName(customerId));
    });
  });
  console.log("Socket.IO initialized");
  return io;
}
function emitQueueUpdate(branchId, board) {
  if (!io) return;
  io.to(branchRoomName(branchId)).emit("queue:update", board);
}
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
module.exports = {
  initSocket,
  emitQueueUpdate,
  emitBookingUpdate,
  getIO
};