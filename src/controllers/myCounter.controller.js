const prisma = require("../config/db");
async function getMyCounter(req, res) {
  const userId = BigInt(req.auth.userId);
  const counter = await prisma.serviceCounter.findFirst({
    where: {
      assignedUserId: userId,
      organizationId: req.tenant.organizationId
    },
    select: {
      id: true,
      name: true,
      status: true,
      branchId: true,
      branch: {
        select: {
          name: true
        }
      }
    }
  });
  if (!counter) {
    return res.json({
      counter: null,
      message: "No counter has been assigned to you yet. Ask your Org Admin to assign one."
    });
  }
  return res.json({
    counter: {
      id: counter.id.toString(),
      name: counter.name,
      status: counter.status,
      branchId: counter.branchId.toString(),
      branchName: counter.branch?.name || null
    }
  });
}
async function assignCounter(req, res) {
  const counterId = BigInt(req.params.id);
  const {
    userId
  } = req.body;
  const counter = await prisma.serviceCounter.findFirst({
    where: {
      id: counterId,
      organizationId: req.tenant.organizationId
    }
  });
  if (!counter) return res.status(404).json({
    error: "Counter not found"
  });
  if (userId === null || userId === undefined || userId === "") {
    await prisma.serviceCounter.update({
      where: {
        id: counterId
      },
      data: {
        assignedUserId: null
      }
    });
    return res.json({
      counterId: counterId.toString(),
      assignedUserId: null
    });
  }
  const staffId = BigInt(userId);
  const staff = await prisma.user.findFirst({
    where: {
      id: staffId,
      organizationId: req.tenant.organizationId
    },
    select: {
      id: true,
      name: true,
      branchId: true
    }
  });
  if (!staff) return res.status(404).json({
    error: "Staff member not found"
  });
  if (staff.branchId && String(staff.branchId) !== String(counter.branchId)) {
    return res.status(400).json({
      error: "That staff member works at a different branch to this counter."
    });
  }
  await prisma.serviceCounter.updateMany({
    where: {
      assignedUserId: staffId,
      organizationId: req.tenant.organizationId
    },
    data: {
      assignedUserId: null
    }
  });
  await prisma.serviceCounter.update({
    where: {
      id: counterId
    },
    data: {
      assignedUserId: staffId
    }
  });
  return res.json({
    counterId: counterId.toString(),
    assignedUserId: staffId.toString(),
    assignedUserName: staff.name
  });
}
module.exports = {
  getMyCounter,
  assignCounter
};