const jwt = require("jsonwebtoken");
function signAccessToken(user) {
  return jwt.sign({
    sub: user.id.toString(),
    role: user.role.name,
    organizationId: user.organizationId ? user.organizationId.toString() : null,
    branchId: user.branchId ? user.branchId.toString() : null
  }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m"
  });
}
function signRefreshToken(user) {
  return jwt.sign({
    sub: user.id.toString()
  }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d"
  });
}
function signCustomerAccessToken(customer) {
  return jwt.sign({
    sub: customer.id.toString(),
    role: "CUSTOMER",
    organizationId: null,
    branchId: null
  }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m"
  });
}
function signCustomerRefreshToken(customer) {
  return jwt.sign({
    sub: customer.id.toString()
  }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d"
  });
}
function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}
function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}
module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signCustomerAccessToken,
  signCustomerRefreshToken
};