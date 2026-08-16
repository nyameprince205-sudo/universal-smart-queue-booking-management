const bcrypt = require("bcryptjs");
const prisma = require("../config/db");
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} = require("../utils/jwt");
const {
  issueToken,
  consumeToken
} = require("../services/authToken.service");
const {
  sendEmail
} = require("../services/notification.service");
const {
  validatePasswordStrength
} = require("../utils/passwordStrength");
async function login(req, res) {
  const {
    email,
    password
  } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      error: "email and password are required"
    });
  }
  const user = await prisma.user.findUnique({
    where: {
      email
    },
    include: {
      role: true
    }
  });
  if (!user || user.status !== "active") {
    return res.status(401).json({
      error: "Invalid email or password"
    });
  }
  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return res.status(401).json({
      error: "Invalid email or password"
    });
  }
  if (process.env.REQUIRE_EMAIL_VERIFICATION === "true" && !user.emailVerified) {
    return res.status(403).json({
      error: "Please verify your email address before logging in."
    });
  }
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await prisma.user.update({
    where: {
      id: user.id
    },
    data: {
      lastLoginAt: new Date()
    }
  });
  return res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id.toString(),
      name: user.name,
      email: user.email,
      role: user.role.name,
      organizationId: user.organizationId ? user.organizationId.toString() : null,
      branchId: user.branchId ? user.branchId.toString() : null
    }
  });
}
async function refresh(req, res) {
  const {
    refreshToken
  } = req.body;
  if (!refreshToken) {
    return res.status(400).json({
      error: "refreshToken is required"
    });
  }
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    return res.status(401).json({
      error: "Invalid or expired refresh token"
    });
  }
  const user = await prisma.user.findUnique({
    where: {
      id: BigInt(payload.sub)
    },
    include: {
      role: true
    }
  });
  if (!user || user.status !== "active") {
    return res.status(401).json({
      error: "Invalid or expired refresh token"
    });
  }
  if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
    return res.status(401).json({
      error: "Your password was changed. Please log in again."
    });
  }
  const accessToken = signAccessToken(user);
  return res.json({
    accessToken
  });
}
async function getMe(req, res) {
  const user = await prisma.user.findUnique({
    where: {
      id: BigInt(req.auth.userId)
    },
    include: {
      role: true
    }
  });
  if (!user) {
    return res.status(404).json({
      error: "User not found"
    });
  }
  return res.json({
    id: user.id.toString(),
    name: user.name,
    email: user.email,
    role: user.role.name,
    organizationId: user.organizationId ? user.organizationId.toString() : null,
    branchId: user.branchId ? user.branchId.toString() : null,
    lastLoginAt: user.lastLoginAt
  });
}
async function forgotPassword(req, res) {
  const {
    email
  } = req.body;
  if (!email) return res.status(400).json({
    error: "email is required"
  });
  const user = await prisma.user.findUnique({
    where: {
      email
    }
  });
  if (user && user.status === "active") {
    const rawToken = await issueToken({
      type: "password_reset",
      ownerType: "user",
      ownerId: user.id
    });
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
    await sendEmail(user.email, `Reset your password: ${resetLink} (this link expires in 30 minutes)`);
  }
  return res.json({
    message: "If an account exists with that email, a password reset link has been sent."
  });
}
async function resetPassword(req, res) {
  const {
    token,
    newPassword
  } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({
      error: "token and newPassword are required"
    });
  }
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) return res.status(400).json({
    error: strengthError
  });
  const result = await consumeToken({
    rawToken: token,
    type: "password_reset"
  });
  if (!result) {
    return res.status(400).json({
      error: "This reset link is invalid or has expired. Please request a new one."
    });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date();
  if (result.ownerType === "user") {
    await prisma.user.update({
      where: {
        id: result.ownerId
      },
      data: {
        passwordHash,
        passwordChangedAt: now
      }
    });
  } else {
    await prisma.customer.update({
      where: {
        id: result.ownerId
      },
      data: {
        passwordHash,
        passwordChangedAt: now
      }
    });
  }
  return res.json({
    message: "Password reset successfully. Please log in with your new password."
  });
}
async function verifyEmail(req, res) {
  const {
    token
  } = req.body;
  if (!token) return res.status(400).json({
    error: "token is required"
  });
  const result = await consumeToken({
    rawToken: token,
    type: "email_verification"
  });
  if (!result) {
    return res.status(400).json({
      error: "This verification link is invalid or has expired."
    });
  }
  if (result.ownerType === "user") {
    await prisma.user.update({
      where: {
        id: result.ownerId
      },
      data: {
        emailVerified: true
      }
    });
  }
  return res.json({
    message: "Email verified successfully."
  });
}
async function resendVerification(req, res) {
  const {
    email
  } = req.body;
  if (!email) return res.status(400).json({
    error: "email is required"
  });
  const user = await prisma.user.findUnique({
    where: {
      email
    }
  });
  if (user && user.status === "active" && !user.emailVerified) {
    const rawToken = await issueToken({
      type: "email_verification",
      ownerType: "user",
      ownerId: user.id
    });
    const verifyLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${rawToken}`;
    await sendEmail(user.email, `Verify your email: ${verifyLink} (this link expires in 24 hours)`);
  }
  return res.json({
    message: "If an account exists and needs verification, a new verification email has been sent."
  });
}
module.exports = {
  login,
  refresh,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification
};