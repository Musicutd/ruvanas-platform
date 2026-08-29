import { getCurrentSession } from "./auth";
import { prisma } from "./prisma";
import { assertSchoolStudentAccessActive } from "./school-student-access.mjs";

const accessInclude = {
  organisation: {
    include: { schoolSafeguardingReadiness: true }
  },
  contributor: {
    include: {
      studentGroup: true,
      consentRecords: {
        where: { episodeId: null },
        orderBy: { createdAt: "desc" }
      }
    }
  }
};

export async function requireActiveSchoolStudent() {
  const session = await getCurrentSession();
  if (!session) return { ok: false, status: 401, error: "Sign in to open the student workspace." };
  if (session.user.role !== "STUDENT") {
    return { ok: false, status: 403, error: "This workspace is reserved for invited students." };
  }

  const access = await prisma.schoolStudentAccess.findUnique({
    where: { userId: session.userId },
    include: accessInclude
  });

  try {
    assertSchoolStudentAccessActive({ access });
  } catch (error) {
    return { ok: false, status: 403, error: error instanceof Error ? error.message : "Student access is unavailable." };
  }

  return {
    ok: true,
    session,
    user: session.user,
    access,
    organisation: access.organisation,
    contributor: access.contributor
  };
}

export { accessInclude as schoolStudentAccessInclude };
