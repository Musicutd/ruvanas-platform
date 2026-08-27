import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  flattenGroupZones,
  planGroupAssignmentChanges
} from "@/lib/group-channel-assignments.mjs";
import {
  isRetryableTransactionError,
  runSerializableTransaction
} from "@/lib/transaction-retry.mjs";

const requestSchema = z.object({
  channelId: z.string().trim().min(1),
  dryRun: z.boolean().optional().default(false)
});

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const parsed = requestSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please select a channel." },
        { status: 400 }
      );
    }

    const { channelId, dryRun } = parsed.data;

    const group = await prisma.locationGroup.findUnique({
      where: { id: params.groupId },
      select: {
        id: true,
        organisationId: true,
        name: true,
        locations: {
          select: {
            location: {
              select: {
                id: true,
                name: true,
                zones: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      }
    });

    if (!group) {
      return NextResponse.json(
        { error: "Location group not found." },
        { status: 404 }
      );
    }

    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        organisationId: group.organisationId,
        status: { not: "ARCHIVED" }
      },
      select: { id: true, name: true }
    });

    if (!channel) {
      return NextResponse.json(
        { error: "The selected channel is not available to this organisation." },
        { status: 400 }
      );
    }

    const locations = group.locations.map((membership) => membership.location);
    const zones = flattenGroupZones(locations);
    const zoneIds = zones.map((zone) => zone.id);

    if (zoneIds.length === 0) {
      return NextResponse.json(
        { error: "This location group has no audio zones to update." },
        { status: 400 }
      );
    }

    if (dryRun) {
      const activeAssignments = await prisma.channelAssignment.findMany({
        where: {
          zoneId: { in: zoneIds },
          activeTo: null
        },
        select: { id: true, zoneId: true, channelId: true }
      });
      const plan = planGroupAssignmentChanges(
        zoneIds,
        activeAssignments,
        channel.id
      );

      return NextResponse.json({
        ok: true,
        dryRun: true,
        channel,
        locationCount: locations.length,
        zoneCount: zoneIds.length,
        changedZoneCount: plan.changes.length,
        unchangedZoneCount: plan.unchangedZoneIds.length
      });
    }

    const result = await runSerializableTransaction(prisma, async (tx) => {
      const activeAssignments = await tx.channelAssignment.findMany({
        where: {
          zoneId: { in: zoneIds },
          activeTo: null
        },
        select: { id: true, zoneId: true, channelId: true }
      });

      const plan = planGroupAssignmentChanges(
        zoneIds,
        activeAssignments,
        channel.id
      );

      if (plan.changes.length === 0) {
        return {
          changedZoneCount: 0,
          unchangedZoneCount: plan.unchangedZoneIds.length
        };
      }

      const now = new Date();
      const changedZoneIds = plan.changes.map((change) => change.zoneId);

      await tx.channelAssignment.updateMany({
        where: {
          zoneId: { in: changedZoneIds },
          activeTo: null
        },
        data: { activeTo: now }
      });

      const reusableAssignments = await tx.channelAssignment.findMany({
        where: {
          zoneId: { in: changedZoneIds },
          channelId: channel.id
        },
        select: { id: true, zoneId: true }
      });
      const reusableByZone = new Map(
        reusableAssignments.map((assignment) => [assignment.zoneId, assignment])
      );

      for (const zoneId of changedZoneIds) {
        const reusable = reusableByZone.get(zoneId);

        if (reusable) {
          await tx.channelAssignment.update({
            where: { id: reusable.id },
            data: { activeFrom: now, activeTo: null }
          });
        } else {
          await tx.channelAssignment.create({
            data: {
              channelId: channel.id,
              zoneId,
              activeFrom: now
            }
          });
        }
      }

      const zonesById = new Map(zones.map((zone) => [zone.id, zone]));

      for (const change of plan.changes) {
        const zone = zonesById.get(change.zoneId);

        await tx.auditLog.create({
          data: {
            organisationId: group.organisationId,
            actorUserId: access.user.id,
            action: "ZONE_CHANNEL_ASSIGNED",
            entityType: "Zone",
            entityId: change.zoneId,
            details: {
              source: "LOCATION_GROUP",
              locationGroupId: group.id,
              locationId: zone?.locationId || null,
              previousChannelIds: change.previousChannelIds,
              channelId: channel.id
            }
          }
        });
      }

      await tx.auditLog.create({
        data: {
          organisationId: group.organisationId,
          actorUserId: access.user.id,
          action: "LOCATION_GROUP_CHANNEL_ASSIGNED",
          entityType: "LocationGroup",
          entityId: group.id,
          details: {
            channelId: channel.id,
            channelName: channel.name,
            locationCount: locations.length,
            zoneCount: zoneIds.length,
            changedZoneCount: plan.changes.length,
            unchangedZoneCount: plan.unchangedZoneIds.length
          }
        }
      });

      return {
        changedZoneCount: plan.changes.length,
        unchangedZoneCount: plan.unchangedZoneIds.length
      };
    });

    return NextResponse.json({
      ok: true,
      channel,
      locationCount: locations.length,
      zoneCount: zoneIds.length,
      ...result
    });
  } catch (error) {
    console.error("LOCATION_GROUP_CHANNEL_ASSIGNMENT_ERROR", error);

    if (isRetryableTransactionError(error)) {
      return NextResponse.json(
        { error: "Another channel update is in progress. Please try again." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Unable to assign the group channel. Please try again." },
      { status: 500 }
    );
  }
}
