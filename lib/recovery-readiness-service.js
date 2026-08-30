import { recoveryReadiness } from "./recovery-readiness.mjs";

export async function getRecoveryReadiness(prismaClient, { environment, now = new Date() }) {
  const [controls, evidence] = await Promise.all([
    prismaClient.recoveryControl.findMany({
      where: { environment },
      include: { updatedBy: { select: { name: true } } },
      orderBy: { assetKind: "asc" }
    }),
    prismaClient.recoveryEvidence.findMany({
      where: { environment },
      include: { recordedBy: { select: { name: true } } },
      orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
      take: 100
    })
  ]);
  const readiness = recoveryReadiness({ controls, evidence, now });
  return {
    generatedAt: now,
    environment,
    status: readiness.status,
    findings: readiness.findings,
    assets: readiness.assets.map((asset) => ({
      ...asset,
      evidence: evidence.filter((item) => item.assetKind === asset.assetKind).slice(0, 20)
    }))
  };
}
