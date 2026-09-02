Warning: truncated output (original token count: 25106)
Total output lines: 2114

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

async function api(path, { method = "GET", body, cookie, origin = baseUrl, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

function sessionCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

function dateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("route-level origin, authentication, tenant, plan, and rate-limit controls", async () => {
  const missingOrigin = await api("/api/auth/login", {
    method: "POST",
    origin: null,
    body: { email: "nobody@example.invalid", password: "not-a-password" }
  });
  assert.equal(missingOrigin.status, 403);
  assert.ok(missingOrigin.headers.get("x-request-id"));

  const foreignOrigin = await api("/api/auth/login", {
    method: "POST",
    origin: "https://attacker.example",
    body: { email: "nobody@example.invalid", password: "not-a-password" }
  });
  assert.equal(foreignOrigin.status, 403);

  const suffix = randomUUID();
  const accountA = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Integration Owner A",
      organisationName: `Integration A ${suffix}`,
      email: `integration-a-${suffix}@example.invalid`,
      password: "correct-horse-battery-staple"
    }
  });
  assert.equal(accountA.status, 201, await accountA.clone().text());
  const accountABody = await accountA.json();
  const cookieA = sessionCookie(accountA);
  assert.ok(cookieA);

  const me = await api("/api/me", { cookie: cookieA });
  assert.equal(me.status, 200);

  const tenantOwnerPlayerHealth = await api("/api/admin/players/health", { cookie: cookieA });
  assert.equal(tenantOwnerPlayerHealth.status, 403);

  const tenantOwnerStreamHealth = await api("/api/admin/streams/health", { cookie: cookieA });
  assert.equal(tenantOwnerStreamHealth.status, 403);

  const tenantOwnerStreamProbe = await api("/api/admin/streams/not-a-station/probe", { method: "POST", cookie: cookieA });
  assert.equal(tenantOwnerStreamProbe.status, 403);

  const tenantOwnerPlayerCommands = await api("/api/admin/players/commands", { cookie: cookieA });
  assert.equal(tenantOwnerPlayerCommands.status, 403);

  const tenantOwnerPlayerLifecycle = await api("/api/admin/players/not-a-player/lifecycle", {
    method: "POST",
    cookie: cookieA,
    body: { action: "REVOKE_SESSION", note: "Tenant users cannot revoke platform players." }
  });
  assert.equal(tenantOwnerPlayerLifecycle.status, 403);

  const tenantOwnerJobs = await api("/api/admin/jobs", { cookie: cookieA });
  assert.equal(tenantOwnerJobs.status, 403);

  const tenantOwnerOperationalHealth = await api("/api/admin/operations/health", { cookie: cookieA });
  assert.equal(tenantOwnerOperationalHealth.status, 403);

  const tenantOwnerRecoveryReadiness = await api("/api/admin/recovery", { cookie: cookieA });
  assert.equal(tenantOwnerRecoveryReadiness.status, 403);

  const tenantOwnerLaunchReadiness = await api("/api/admin/launch-readiness", { cookie: cookieA });
  assert.equal(tenantOwnerLaunchReadiness.status, 403);

  const ownNotifications = await api("/api/notifications", { cookie: cookieA });
  assert.equal(ownNotifications.status, 200, await ownNotifications.clone().text());
  assert.ok(Array.isArray((await ownNotifications.json()).deliveries));

  const ownNotificationPreferences = await api("/api/notifications/preferences", { cookie: cookieA });
  assert.equal(ownNotificationPreferences.status, 200, await ownNotificationPreferences.clone().text());
  const ownNotificationPreferenceBody = await ownNotificationPreferences.json();
  assert.equal(ownNotificationPreferenceBody.emailConfigured, false);
  assert.equal(ownNotificationPreferenceBody.webhookManagedInIntegrations, true);
  assert.ok(ownNotificationPreferenceBody.preferences.some((item) => item.channel === "IN_APP" && item.enabled === true));
  assert.ok(ownNotificationPreferenceBody.preferences.some((item) => item.channel === "EMAIL" && item.enabled === false));

  const unavailableEmailOptIn = await api("/api/notifications/preferences", {
    method: "PATCH",
    cookie: cookieA,
    body: { type: "PLAYER_OFFLINE", channel: "EMAIL", enabled: true }
  });
  assert.equal(unavailableEmailOptIn.status, 409);

  const ownOrganisationSwitch = await api("/api/me/organisation", {
    method: "POST",
    cookie: cookieA,
    body: { organisationId: accountABody.organisation.id }
  });
  assert.equal(ownOrganisationSwitch.status, 200);

  const activeOrganisation = await api("/api/me", { cookie: cookieA });
  assert.equal(activeOrganisation.status, 200);
  assert.equal(
    (await activeOrganisation.json()).organisation.id,
    accountABody.organisation.id
  );

  const unauthenticatedPlayerState = await api("/api/player/state");
  assert.equal(unauthenticatedPlayerState.status, 401);

  const unauthenticatedManifest = await api("/api/player/manifest");
  assert.equal(unauthenticatedManifest.status, 401);

  const unauthenticatedPlayerMedia = await api("/api/player/media/not-an-asset");
  assert.equal(unauthenticatedPlayerMedia.status, 401);

  const unauthenticatedHeartbeat = await api("/api/player/heartbeat", {
    method: "POST"
  });
  assert.equal(unauthenticatedHeartbeat.status, 401);

  const unauthenticatedPlayerCommands = await api("/api/player/commands");
  assert.equal(unauthenticatedPlayerCommands.status, 401);

  const unauthenticatedPlayerCommandAcknowledgement = await api("/api/player/commands/not-a-command/acknowledge", {
    method: "POST",
    body: { outcome: "SUCCEEDED" }
  });
  assert.equal(unauthenticatedPlayerCommandAcknowledgement.status, 401);

  const unauthenticatedPlayerHealth = await api("/api/admin/players/health");
  assert.equal(unauthenticatedPlayerHealth.status, 401);

  const unauthenticatedStreamHealth = await api("/api/admin/streams/health");
  assert.equal(unauthenticatedStreamHealth.status, 401);

  const unauthenticatedStreamProbe = await api("/api/admin/streams/not-a-station/probe", { method: "POST" });
  assert.equal(unauthenticatedStreamProbe.status, 401);

  const unauthenticatedStreamIncidentUpdate = await api("/api/admin/streams/health/not-an-incident", {
    method: "PATCH",
    body: { action: "ACKNOWLEDGE", note: "Unauthorised stream incident note." }
  });
  assert.equal(unauthenticatedStreamIncidentUpdate.status, 401);

  const unauthenticatedPlayerIncidentUpdate = await api("/api/admin/players/health/not-an-incident", {
    method: "PATCH",
    body: { action: "ACKNOWLEDGE", note: "Unauthorised operational note." }
  });
  assert.equal(unauthenticatedPlayerIncidentUpdate.status, 401);

  const unauthenticatedAdminPlayerCommands = await api("/api/admin/players/commands");
  assert.equal(unauthenticatedAdminPlayerCommands.status, 401);

  const unauthenticatedAdminPlayerCommandCreate = await api("/api/admin/players/commands", {
    method: "POST",
    body: { playerId: "not-a-player", kind: "PING" }
  });
  assert.equal(unauthenticatedAdminPlayerCommandCreate.status, 401);

  const unauthenticatedAdminPlayerCommandCancel = await api("/api/admin/players/commands/not-a-command", { method: "PATCH" });
  assert.equal(unauthenticatedAdminPlayerCommandCancel.status, 401);

  const unauthenticatedAdminPlayerLifecycle = await api("/api/admin/players/not-a-player/lifecycle", {
    method: "POST",
    body: { action: "REVOKE_SESSION", note: "Unauthorised lifecycle action." }
  });
  assert.equal(unauthenticatedAdminPlayerLifecycle.status, 401);

  const unauthenticatedJobs = await api("/api/admin/jobs");
  assert.equal(unauthenticatedJobs.status, 401);

  const unauthenticatedOperationalHealth = await api("/api/admin/operations/health");
  assert.equal(unauthenticatedOperationalHealth.status, 401);

  const unauthenticatedRecoveryReadiness = await api("/api/admin/recovery");
  assert.equal(unauthenticatedRecoveryReadiness.status, 401);

  const unauthenticatedLaunchReadiness = await api("/api/admin/launch-readiness");
  assert.equal(unauthenticatedLaunchReadiness.status, 401);

  const unauthenticatedLaunchSignoff = await api("/api/admin/launch-readiness", {
    method: "POST",
    body: { action: "CONFIRM_CHECK", checkId: "CI_ACCEPTANCE_PASSED", evidenceReference: "unauthenticated", note: "Unauthorised sign-off attempt." }
  });
  assert.equal(unauthenticatedLaunchSignoff.status, 401);

  const unauthenticatedRecoveryEvidence = await api("/api/admin/recovery", {
    method: "POST",
    body: { action: "RECORD_EVIDENCE", assetKind: "DATABASE", evidenceKind: "BACKUP_VERIFICATION", result: "PASSED", evidenceReference: "unauthenticated-evidence", performedAt: new Date().toISOString(), notes: "Unauthorised recovery evidence attempt." }
  });
  assert.equal(unauthenticatedRecoveryEvidence.status, 401);

  const unauthenticatedNotifications = await api("/api/notifications");
  assert.equal(unauthenticatedNotifications.status, 401);

  const unauthenticatedNotificationPreferences = await api("/api/notifications/preferences");
  assert.equal(unauthenticatedNotificationPreferences.status, 401);

  const unauthenticatedNotificationUpdate = await api("/api/notifications/not-a-delivery", {
    method: "PATCH",
    body: { action: "READ" }
  });
  assert.equal(unauthenticatedNotificationUpdate.status, 401);

  const unauthenticatedProofOfPlay = await api("/api/player/proof-of-play", {
    method: "POST",
    body: { events: [] }
  });
  assert.equal(unauthenticatedProofOfPlay.status, 401);

  const unauthenticatedPublicLocations = await api("/api/v1/locations");
  assert.equal(unauthenticatedPublicLocations.status, 401);

  const unauthenticatedMetricImport = await api("/api/v1/integration-metrics", { method: "POST", body: { connectionId: "not-a-connection", metrics: [] } });
  assert.equal(unauthenticatedMetricImport.status, 401);

  const unauthenticatedIntegrationCreate = await api("/api/admin/integrations/connections", { method: "POST", body: {} });
  assert.equal(unauthenticatedIntegrationCreate.status, 401);

  const unauthenticatedIntegrationRecovery = await api("/api/admin/integrations/connections/not-a-connection/dispatch", { method: "POST", body: { action: "RECOVER_ABANDONED", note: "Unauthenticated recovery attempt." } });
  assert.equal(unauthenticatedIntegrationRecovery.status, 401);

  const unauthenticatedPromoArchive = await api(
    "/api/admin/promos/example/status",
    { method: "PATCH", body: { status: "ARCHIVED" } }
  );
  assert.equal(unauthenticatedPromoArchive.status, 401);

  const unauthenticatedPromoReview = await api(
    "/api/admin/promos/example/versions/example/review",
    { method: "PATCH", body: { decision: "APPROVE" } }
  );
  assert.equal(unauthenticatedPromoReview.status, 401);

  const unauthenticatedCampaignPreview = await api(
    "/api/admin/campaigns/preview",
    { method: "POST", body: {} }
  );
  assert.equal(unauthenticatedCampaignPreview.status, 401);

  const unauthenticatedCampaignPublish = await api(
    "/api/admin/campaigns/not-a-campaign/publish",
    { method: "PATCH" }
  );
  assert.equal(unauthenticatedCampaignPublish.status, 401);

  const unauthenticatedCampaignReport = await api("/api/reports/campaign-proof");
  assert.equal(unauthenticatedCampaignReport.status, 401);

  const unauthenticatedRetailMedia = await api("/api/admin/retail-media/partners?organisationId=not-an-organisation");
  assert.equal(unauthenticatedRetailMedia.status, 401);

  const unauthenticatedCrossMediaActivation = await api("/api/admin/retail-media/orders/not-an-order/activation", { method: "PATCH", body: { action: "ACTIVATE" } });
  assert.equal(unauthenticatedCrossMediaActivation.status, 404);

  const unauthenticatedSignageAssets = await api("/api/admin/digital-signage/assets?organisationId=not-an-organisation");
  assert.equal(unauthenticatedSignageAssets.status, 401);

  const unauthenticatedSignageLayouts = await api("/api/admin/digital-signage/layouts?organisationId=not-an-organisation");
  assert.equal(unauthenticatedSignageLayouts.status, 401);

  const unauthenticatedSignageDevices = await api("/api/admin/digital-signage/devices?organisationId=not-an-organisation");
  assert.equal(unauthenticatedSignageDevices.status, 401);

  const unauthenticatedSignagePlaylists = await api("/api/admin/digital-signage/playlists?organisationId=not-an-organisation");
  assert.equal(unauthenticatedSignagePlaylists.status, 401);

  const unauthenticatedSignagePlaylistPublish = await api("/api/admin/digital-signage/playlists/not-a-playlist/publish", { method: "PATCH", body: { action: "PUBLISH" } });
  assert.equal(unauthenticatedSignagePlaylistPublish.status, 401);

  const unauthenticatedSignageState = await api("/api/signage/state");
  assert.equal(unauthenticatedSignageState.status, 401);

  const unauthenticatedSignageManifest = await api("/api/signage/manifest");
  assert.equal(unauthenticatedSignageManifest.status, 401);

  const unauthenticatedSignageHeartbeat = await api("/api/signage/heartbeat", { method: "POST" });
  assert.equal(unauthenticatedSignageHeartbeat.status, 401);

  const unauthenticatedSignageProof = await api("/api/signage/proof", { method: "POST", body: { events: [] } });
  assert.equal(unauthenticatedSignageProof.status, 401);

  const unauthenticatedSignageMedia = await api("/api/signage/media/not-an-asset");
  assert.equal(unauthenticatedSignageMedia.status, 401);

  const unauthenticatedSchoolAnnouncements = await api("/api/school-radio/announcements");
  assert.equal(unauthenticatedSchoolAnnouncements.status, 401);

  const unauthenticatedSchoolNoticeboard = await api("/api/school-radio/noticeboard");
  assert.equal(unauthenticatedSchoolNoticeboard.status, 401);

  const unauthenticatedSchoolNoticeboardCancel = await api("/api/school-radio/noticeboard/not-a-post", { method: "PATCH", body: { reason: "Unauthorised" } });
  assert.equal(unauthenticatedSchoolNoticeboardCancel.status, 401);

  const unauthenticatedSchoolEditorial = await api("/api/school-radio/editorial");
  assert.equal(unauthenticatedSchoolEditorial.status, 401);

  const unauthenticatedAudioLab = await api("/api/school-radio/audio-lab");
  assert.equal(unauthenticatedAudioLab.status, 401);

  const unauthenticatedShowBuilder = await api("/api/school-radio/show-builder");
  assert.equal(unauthenticatedShowBuilder.status, 401);

  const unauthenticatedMultitrack = await api("/api/school-radio/multitrack");
  assert.equal(unauthenticatedMultitrack.status, 401);

  const unauthenticatedMultitrackProject = await api("/api/school-radio/multitrack/projects/not-a-project");
  assert.equal(unauthenticatedMultitrackProject.status, 401);

  const unauthenticatedPodcasts = await api("/api/school-radio/podcasts");
  assert.equal(unauthenticatedPodcasts.status, 401);

  const unauthenticatedSchoolPublicationPolicy = await api("/api/school-radio/publication-policy");
  assert.equal(unauthenticatedSchoolPublicationPolicy.status, 401);

  const unauthenticatedSchoolPublicationPolicyChange = await api("/api/school-radio/publication-policy", {
    method: "PATCH",
    body: { publishingPolicy: "PUBLIC", reason: "Unauthorised publication policy change." }
  });
  assert.equal(unauthenticatedSchoolPublicationPolicyChange.status, 401);

  const unauthenticatedSchoolPublicationOperations = await api("/api/school-radio/publication-operations");
  assert.equal(unauthenticatedSchoolPublicationOperations.status, 401);

  const unauthenticatedSchoolPublicationExport = await api("/api/school-radio/publication-operations/export");
  assert.equal(unauthenticatedSchoolPublicationExport.status, 401);

  const unauthenticatedSchoolPilotReadiness = await api("/api/school-radio/pilot-readiness");
  assert.equal(unauthenticatedSchoolPilotReadiness.status, 401);

  const unauthenticatedSchoolPilotReadinessUpdate = await api("/api/school-radio/pilot-readiness", { method: "PATCH", body: {} });
  assert.equal(unauthenticatedSchoolPilotReadinessUpdate.status, 401);

  const unauthenticatedSchoolRetentionHold = await api("/api/school-radio/retention-holds", { method: "POST", body: {} });
  assert.equal(unauthenticatedSchoolRetentionHold.status, 401);

  const unauthenticatedSchoolRetentionHoldRelease = await api("/api/school-radio/retention-holds/not-a-hold", { method: "PATCH", body: {} });
  assert.equal(unauthenticatedSchoolRetentionHoldRelease.status, 401);

  const unauthenticatedSchoolPilotOperations = await api("/api/school-radio/pilot-operations");
  assert.equal(unauthenticatedSchoolPilotOperations.status, 401);

  const unauthenticatedSchoolPilotOperationCreate = await api("/api/school-radio/pilot-operations", { method: "POST", body: {} });
  assert.equal(unauthenticatedSchoolPilotOperationCreate.status, 401);

  const unauthenticatedSchoolPilotOperationUpdate = await api("/api/school-radio/pilot-operations/not-a-record", { method: "PATCH", body: {} });
  assert.equal(unauthenticatedSchoolPilotOperationUpdate.status, 401);

  const unavailablePublicSchoolPage = await api("/api/public/school-radio/not-a-school/episodes");
  assert.equal(unavailablePublicSchoolPage.status, 404);

  const unauthenticatedNewsroom = await api("/api/school-radio/newsroom");
  assert.equal(unauthenticatedNewsroom.status, 401);

  const unauthenticatedLiveStudio = await api("/api/school-radio/live-studio");
  assert.equal(unauthenticatedLiveStudio.status, 401);

  const unauthenticatedLearningWorkspace = await api("/api/school-radio/learning");
  assert.equal(unauthenticatedLearningWorkspace.status, 401);

  const unauthenticatedSchoolNetwork = await api("/api/school-radio/network");
  assert.equal(unauthenticatedSchoolNetwork.status, 401);

  const unauthenticatedSchoolExchange = await api("/api/school-radio/network/exchange");
  assert.equal(unauthenticatedSchoolExchange.status, 401);

  const unauthenticatedSafeguardingReadiness = await api("/api/school-radio/safeguarding-readiness");
  assert.equal(unauthenticatedSafeguardingReadiness.status, 401);

  const unauthenticatedSafeguardingDecision = await api("/api/admin/school-safeguarding", { method: "POST", body: { readinessId: "not-a-readiness", decision: "APPROVED" } });
  assert.equal(unauthenticatedSafeguardingDecision.status, 401);

  const unauthenticatedStudentAccess = await api("/api/school-radio/student-access");
  assert.equal(unauthenticatedStudentAccess.status, 401);

  const unauthenticatedStudentInvitationAccept = await api("/api/school-student/accept", { method: "POST", body: { token: "a".repeat(64), password: "student-password-123" } });
  assert.equal(unauthenticatedStudentInvitationAccept.status, 410);

  const unauthenticatedStudentWorkspace = await api("/api/school-student/workspace");
  assert.equal(unauthenticatedStudentWorkspace.status, 401);

  const unauthenticatedWaveformEditor = await api("/api/school-radio/audio-lab/projects/not-a-project/editor");
  assert.equal(unauthenticatedWaveformEditor.status, 401);

  const unauthenticatedAudioUpload = await api("/api/school-radio/audio-lab/uploads", {
    method: "POST",
    body: {}
  });
  assert.equal(unauthenticatedAudioUpload.status, 401);

  const unauthenticatedAudioPart = await api("/api/school-radio/audio-lab/uploads/not-an-upload/parts/1", {
    method: "PUT",
    body: "audio"
  });
  assert.equal(unauthenticatedAudioPart.status, 401);

  const unauthenticatedAudioComplete = await api("/api/school-radio/audio-lab/uploads/not-an-upload/complete", {
    method: "POST",
    body: {}
  });
  assert.equal(unauthenticatedAudioComplete.status, 401);

  const unauthenticatedSchoolReview = await api("/api/school-radio/episodes/not-an-episode/review", {
    method: "PATCH",
    body: { action: "APPROVE" }
  });
  assert.equal(unauthenticatedSchoolReview.status, 401);

  const unauthenticatedSchoolSlot = await api("/api/school-radio/broadcast-slots", {
    method: "POST",
    body: {}
  });
  assert.equal(unauthenticatedSchoolSlot.status, 401);

  const unauthenticatedProductionOrders = await api("/api/studio/orders");
  assert.equal(unauthenticatedProductionOrders.status, 401);

  const unauthenticatedProductionCredits = await api("/api/studio/credits");
  assert.equal(unauthenticatedProductionCredits.status, 401);

  const unauthenticatedProductionOrderCreate = await api("/api/studio/orders", {
    method: "POST",
    body: {}
  });
  assert.equal(unauthenticatedProductionOrderCreate.status, 401);

  const unauthenticatedProductionOrderStatus = await api("/api/studio/orders/not-an-order/status", {
    method: "PATCH",
    body: { action: "SUBMIT" }
  });
  assert.equal(unauthenticatedProductionOrderStatus.status, 401);

  const unauthenticatedProductionAssignment = await api("/api/studio/orders/not-an-order/assignment", { method: "PATCH", body: { userId: null } });
  assert.equal(unauthenticatedProductionAssignment.status, 401);

  const unauthenticatedProductionFunding = await api("/api/studio/orders/not-an-order/funding", { method: "PATCH", body: { action: "AUTHORISE_PAID_ADD_ON", externalReference: "test" } });
  assert.equal(unauthenticatedProductionFunding.status, 401);

  const unauthenticatedPromoHandoff = await api("/api/studio/orders/not-an-order/promo-handoff", { method: "POST", body: { name: "Test", mediaType: "COMMERCIAL", languageCode: "en" } });
  assert.equal(unauthenticatedPromoHandoff.status, 401);

  const unauthenticatedProductionScript = await api("/api/studio/orders/not-an-order/scripts", { method: "POST", body: { languageCode: "en", content: "Unauthenticated script content." } });
  assert.equal(unauthenticatedProductionScript.status, 401);

  const unauthenticatedProductionFile = await api("/api/studio/files/not-a-file");
  assert.equal(unauthenticatedProductionFile.status, 401);

  const unauthenticatedSchoolEntitlement = await api(
    "/api/admin/organisations/not-an-organisation/school-radio",
    { method: "PATCH", body: { enabled: true } }
  );
  assert.equal(unauthenticatedSchoolEntitlement.status, 401);

  const unauthenticatedOrganisationCreate = await api("/api/admin/organisations", {
    method: "POST",
    body: { name: "Unauthenticated organisation", planId: "not-a-plan" }
  });
  assert.equal(unauthenticatedOrganisationCreate.status, 401);

  const unauthenticatedCampaignExport = await api("/api/reports/campaign-proof/exports", {
    method: "POST",
    body: { from: dateOffset(-1), to: dateOffset(1) }
  });
  assert.equal(unauthenticatedCampaignExport.status, 401);

  const unauthenticatedOperationalAnalytics = await api(`/api/reports/operational?from=${dateOffset(-1)}&to=${dateOffset(1)}`);
  assert.equal(unauthenticatedOperationalAnalytics.status, 401);

  const unauthenticatedOperationalExport = await api("/api/reports/operational/exports", {
    method: "POST",
    body: { from: dateOffset(-1), to: dateOffset(1) }
  });
  assert.equal(unauthenticatedOperationalExport.status, 401);

  const unauthenticatedCompliance = await api("/api/admin/compliance", {
    method: "POST",
    body: { action: "PREVIEW_RETENTION", organisationId: "not-an-organisation" }
  });
  assert.equal(unauthenticatedCompliance.status, 401);

  const unauthenticatedAIDraft = await api("/api/admin/ai/jobs", {
    method: "POST",
    body: { organisationId: "not-an-organisation" }
  });
  assert.equal(unauthenticatedAIDraft.status, 401);

  const unauthenticatedAIReview = await api("/api/admin/ai/jobs/not-a-job/review", {
    method: "PATCH",
    body: { decision: "APPROVED", editedText: "Unauthenticated review attempt." }
  });
  assert.equal(unauthenticatedAIReview.status, 401);

  const unauthenticatedSupportTicket = await api("/api/admin/support/tickets", {
    method: "POST",
    body: { subject: "No session", description: "No session", priority: "NORMAL" }
  });
  assert.equal(unauthenticatedSupportTicket.status, 401);

  const unauthenticatedSubscriberSupportList = await api("/api/support/requests");
  assert.equal(unauthenticatedSubscriberSupportList.status, 401);

  const unauthenticatedSubscriberSupportCreate = await api("/api/support/requests", {
    method: "POST",
    body: { category: "PLAYER", subject: "No session", description: "No session can create this request." }
  });
  assert.equal(unauthenticatedSubscriberSupportCreate.status, 401);

  const invalidPlayerEnrolment = await api("/api/player/enrol", {
    method: "POST",
    body: { code: "invalid-enrolment-code" }
  });
  assert.equal(invalidPlayerEnrolment.status, 400);

  const unauthenticatedStation = await api("/api/stations", {
    method: "POST",
    body: { name: "Unauthenticated station" }
  });
  assert.equal(unauthenticatedStation.status, 401);

  const unauthenticatedGroupAssignment = await api(
    "/api/admin/location-groups/not-a-group/channel",
    {
      method: "POST",
      body: { channelId: "not-a-channel" }
    }
  );
  assert.equal(unauthenticatedGroupAssignment.status, 401);

  const unauthenticatedOpeningHours = await api(
    "/api/admin/locations/not-a-location/opening-hours",
    { method: "PUT", body: { weeklyHours: [], exceptions: [] } }
  );
  assert.equal(unauthenticatedOpeningHours.status, 401);

  const unauthenticatedMusicMode = await api("/api/admin/music-modes", {
    method: "POST",
    body: { organisationId: "not-an-organisation", name: "No session" }
  });
  assert.equal(unauthenticatedMusicMode.status, 401);

  const unauthenticatedMusicSchedule = await api("/api/admin/music-schedules", {
    method: "POST",
    body: { organisationId: "not-an-organisation", targetType: "LOCATION", targetId: "not-a-location", name: "No session", slots: [] }
  });
  assert.equal(unauthenticatedMusicSchedule.status, 401);

  const unauthenticatedCatalogueUpload = await fetch(
    `${baseUrl}/api/admin/catalogue/upload`,
    {
      method: "POST",
      headers: { origin: baseUrl },
      body: new FormData()
    }
  );
  assert.equal(unauthenticatedCatalogueUpload.status, 401);

  const station = await api("/api/stations", {
    method: "POST",
    cookie: cookieA,
    body: { name: `Integration Station ${suffix}` }
  });
  assert.equal(station.status, 200, await station.text());

  const stationOverLimit = await api("/api/stations", {
    method: "POST",
    cookie: cookieA,
    body: { name: `Second Integration Station ${suffix}` }
  });
  assert.equal(stationOverLimit.status, 403);

  const accountB = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Integration Owner B",
      organisationName: `Integration B ${suffix}`,
      email: `integration-b-${suffix}@example.invalid`,
      password: "correct-horse-battery-staple"
    }
  });
  assert.equal(accountB.status, 201, await accountB.clone().text());
  const cookieB = sessionCookie(accountB);
  const accountBBody = await accountB.json();

  const crossTenantOrganisationSwitch = await api("/api/me/organisation", {
    method: "POST",
    cookie: cookieB,
    body: { organisationId: accountABody.organisation.id }
  });
  assert.equal(crossTenantOrganisationSwitch.status, 403);

  const crossTenantStation = await api("/api/stations", {
    method: "POST",
    cookie: cookieB,
    body: {
      name: "Cross-tenant attempt",
      organisationId: accountABody.organisation.id
    }
  });
  assert.equal(crossTenantStation.status, 403);

  const ownerAdminAttempt = await api("/api/admin/stations", {
    method: "POST",
    cookie: cookieA,
    body: { name: "Forbidden admin action" }
  });
  assert.equal(ownerAdminAttempt.status, 403);

  const ownerSafeguardingDecisionAttempt = await api("/api/admin/school-safeguarding", {
    method: "POST",
    cookie: cookieA,
    body: { readinessId: "not-a-readiness", decision: "APPROVED" }
  });
  assert.equal(ownerSafeguardingDecisionAttempt.status, 403);

  const ownerBulkAssignmentAttempt = await api(
    "/api/admin/location-groups/not-a-group/channel",
    {
      method: "POST",
      cookie: cookieA,
      body: { channelId: "not-a-channel" }
    }
  );
  assert.equal(ownerBulkAssignmentAttempt.status, 403);

  const ownerOpeningHoursAttempt = await api(
    "/api/admin/locations/not-a-location/opening-hours",
    { method: "PUT", cookie: cookieA, body: { weeklyHours: [], exceptions: [] } }
  );
  assert.equal(ownerOpeningHoursAttempt.status, 403);

  const ownerMusicModeAttempt = await api("/api/admin/music-modes", {
    method: "POST",
    cookie: cookieA,
    body: {
      organisationId: accountABody.organisation.id,
      name: "Forbidden music mode"
    }
  });
  assert.equal(ownerMusicModeAttempt.status, 403);

  const ownerMusicScheduleAttempt = await api("/api/admin/music-schedules", {
    method: "POST",
    cookie: cookieA,
    body: { organisationId: accountABody.organisation.id, targetType: "LOCATION", targetId: "not-a-location", name: "Forbidden schedule", slots: [] }
  });
  assert.equal(ownerMusicScheduleAttempt.status, 403);

  const ownerCatalogueUploadAttempt = await fetch(
    `${baseUrl}/api/admin/catalogue/upload`,
    {
      method: "POST",
      headers: { origin: baseUrl, cookie: cookieA },
      body: new FormData()
    }
  );
  assert.equal(ownerCatalogueUploadAttempt.status, 403);

  const ownerSchoolEntitlementAttempt = await api(
    `/api/admin/organisations/${accountABody.organisation.id}/school-radio`,
    { method: "PATCH", cookie: cookieA, body: { enabled: true } }
  );
  assert.equal(ownerSchoolEntitlementAttempt.status, 403);

  const ownerOrg…10106 tokens truncated…tatus, 200, await viewerSwitchSchool.clone().text());
    const viewerActiveOrganisation = await api("/api/me", { cookie: cookieB });
    assert.equal((await viewerActiveOrganisation.json()).organisation.id, accountABody.organisation.id);
    assert.equal(await db.auditLog.count({ where: { schoolNetworkId: schoolNetwork.id, action: "SCHOOL_NETWORK_SCHOOL_ACCESS_GRANTED" } }), 1);

    const viewerOperationalAnalytics = await api(`/api/reports/operational?from=${dateOffset(-1)}&to=${dateOffset(1)}`, { cookie: cookieB });
    assert.equal(viewerOperationalAnalytics.status, 200, await viewerOperationalAnalytics.clone().text());
    const viewerAnalyticsBody = await viewerOperationalAnalytics.json();
    assert.equal(viewerAnalyticsBody.canExport, false);
    assert.equal(viewerAnalyticsBody.report.school.studentIdentitiesIncluded, false);
    assert.equal(JSON.stringify(viewerAnalyticsBody).includes(`Integration Radio Club ${suffix}`), false);

    const viewerOperationalExport = await api("/api/reports/operational/exports", {
      method: "POST", cookie: cookieB, body: { from: dateOffset(-1), to: dateOffset(1) }
    });
    assert.equal(viewerOperationalExport.status, 403);

    const restoreViewerOrganisation = await api("/api/me/organisation", {
      method: "POST", cookie: cookieB, body: { organisationId: accountBBody.organisation.id }
    });
    assert.equal(restoreViewerOrganisation.status, 200, await restoreViewerOrganisation.clone().text());

    const switchToSecondSchool = await api("/api/me/organisation", {
      method: "POST", cookie: cookieA, body: { organisationId: createdOrganisation.id }
    });
    assert.equal(switchToSecondSchool.status, 200);

    const isolatedEditorial = await api("/api/school-radio/editorial", { cookie: cookieA });
    assert.equal(isolatedEditorial.status, 200, await isolatedEditorial.clone().text());
    assert.deepEqual((await isolatedEditorial.json()).groups, []);
    const crossTenantContributor = await api("/api/school-radio/editorial", {
      method: "POST", cookie: cookieA,
      body: { action: "CREATE_CONTRIBUTOR", studentGroupId: schoolGroup.id, displayName: "Must not cross tenants" }
    });
    assert.equal(crossTenantContributor.status, 404);
    const crossTenantEpisodeReview = await api(`/api/school-radio/episodes/${schoolEpisode.id}/review`, {
      method: "PATCH", cookie: cookieA, body: { action: "APPROVE" }
    });
    assert.equal(crossTenantEpisodeReview.status, 404);
    assert.equal(await db.schoolEpisode.count({ where: { organisationId: createdOrganisation.id } }), 0);

    const targetExchangeLibrary = await api("/api/school-radio/network/exchange", { cookie: cookieA });
    assert.equal(targetExchangeLibrary.status, 200, await targetExchangeLibrary.clone().text());
    const targetExchangeBody = await targetExchangeLibrary.json();
    assert.equal(targetExchangeBody.offers.length, 1);
    assert.equal(targetExchangeBody.offers[0].sourceSchool.id, accountABody.organisation.id);
    assert.equal(JSON.stringify(targetExchangeBody).includes(schoolEpisode.id), false);
    assert.equal(JSON.stringify(targetExchangeBody).includes(exchangePromoVersion.id), false);
    assert.equal(targetExchangeBody.safety.studentIdentitiesShared, false);

    const requestExchangeAccess = await api("/api/school-radio/network/exchange", {
      method: "POST", cookie: cookieA,
      body: { action: "REQUEST_ACCESS", offerId: exchangeOffer.id, intendedUse: "A supervised media-literacy lesson for the receiving school." }
    });
    assert.equal(requestExchangeAccess.status, 201, await requestExchangeAccess.clone().text());
    const exchangeRequest = (await requestExchangeAccess.json()).result;

    const switchBackToAccountA = await api("/api/me/organisation", {
      method: "POST", cookie: cookieA, body: { organisationId: accountABody.organisation.id }
    });
    assert.equal(switchBackToAccountA.status, 200);

    const approveExchangeRequest = await api("/api/school-radio/network/exchange", {
      method: "POST", cookie: cookieA,
      body: { action: "DECIDE_REQUEST", requestId: exchangeRequest.id, decision: "APPROVE" }
    });
    assert.equal(approveExchangeRequest.status, 200, await approveExchangeRequest.clone().text());

    const switchToExchangeTarget = await api("/api/me/organisation", {
      method: "POST", cookie: cookieA, body: { organisationId: createdOrganisation.id }
    });
    assert.equal(switchToExchangeTarget.status, 200);
    const importExchange = await api("/api/school-radio/network/exchange", {
      method: "POST", cookie: cookieA, body: { action: "IMPORT_REQUEST", requestId: exchangeRequest.id }
    });
    assert.equal(importExchange.status, 201, await importExchange.clone().text());
    const importedAnnouncement = (await importExchange.json()).result;
    assert.equal(importedAnnouncement.organisationId, createdOrganisation.id);
    assert.equal(importedAnnouncement.promoVersionId, exchangePromoVersion.id);
    assert.equal(importedAnnouncement.status, "IN_REVIEW");

    const returnToExchangeSource = await api("/api/me/organisation", {
      method: "POST", cookie: cookieA, body: { organisationId: accountABody.organisation.id }
    });
    assert.equal(returnToExchangeSource.status, 200);
    const revokeExchange = await api("/api/school-radio/network/exchange", {
      method: "POST", cookie: cookieA,
      body: { action: "REVOKE_REQUEST", requestId: exchangeRequest.id, reason: "Integration safeguarding revocation." }
    });
    assert.equal(revokeExchange.status, 200, await revokeExchange.clone().text());
    assert.equal((await db.schoolAnnouncement.findUnique({ where: { id: importedAnnouncement.id } })).status, "ARCHIVED");
    assert.equal(await db.auditLog.count({ where: { schoolNetworkId: schoolNetwork.id, action: "SCHOOL_EPISODE_EXCHANGE_REQUEST_REVOKE", entityId: exchangeRequest.id } }), 1);

    const invalidCatalogueUploadForm = new FormData();
    invalidCatalogueUploadForm.set("title", "Invalid catalogue file");
    invalidCatalogueUploadForm.set("artist", "Ruvanas Test Artist");
    invalidCatalogueUploadForm.set("rightsHolder", "Ruvanas Test Rights");
    invalidCatalogueUploadForm.set("rightsReference", "TEST-LICENCE");
    invalidCatalogueUploadForm.set("permittedTerritories", "Worldwide");
    invalidCatalogueUploadForm.set("rightsConfirmed", "true");
    invalidCatalogueUploadForm.set(
      "file",
      new Blob(["not audio content"], { type: "audio/mpeg" }),
      "fake.mp3"
    );
    const invalidCatalogueUpload = await fetch(
      `${baseUrl}/api/admin/catalogue/upload`,
      {
        method: "POST",
        headers: { origin: baseUrl, cookie: cookieA },
        body: invalidCatalogueUploadForm
      }
    );
    assert.equal(invalidCatalogueUpload.status, 400);

    const catalogueRegistrationWithoutRights = await api("/api/admin/tracks", {
      method: "POST",
      cookie: cookieA,
      body: {
        mediaAssetId: "not-a-catalogue-asset",
        title: "Missing rights declaration",
        artist: "Ruvanas Test Artist"
      }
    });
    assert.equal(catalogueRegistrationWithoutRights.status, 400);

    const musicMode = await api("/api/admin/music-modes", {
      method: "POST",
      cookie: cookieA,
      body: {
        organisationId: accountABody.organisation.id,
        name: `Morning Energy ${suffix}`,
        description: "Integration draft mode",
        tracks: []
      }
    });
    assert.equal(musicMode.status, 201, await musicMode.clone().text());
    const musicModeBody = await musicMode.json();
    assert.equal(musicModeBody.mode.status, "DRAFT");
    assert.equal(
      await db.auditLog.count({
        where: {
          organisationId: accountABody.organisation.id,
          action: "MUSIC_MODE_CREATED",
          entityId: musicModeBody.mode.id
        }
      }),
      1
    );

    const catalogueAsset = await db.mediaAsset.create({
      data: {
        name: `Rights-cleared track ${suffix}`,
        originalName: "integration.mp3",
        storageKey: `integration/catalogue/${suffix}.mp3`,
        mimeType: "audio/mpeg",
        sizeBytes: 1024n,
        durationSeconds: 180,
        mediaType: "MUSIC",
        libraryType: "RUVANAS_CATALOGUE",
        status: "READY"
      }
    });
    const track = await db.track.create({
      data: {
        mediaAssetId: catalogueAsset.id,
        title: `Integration Track ${suffix}`,
        artist: "Ruvanas Test Artist",
        status: "READY"
      }
    });
    await assert.rejects(
      db.musicModeTrack.create({
        data: {
          musicModeId: musicModeBody.mode.id,
          trackId: track.id,
          weight: 0
        }
      })
    );
    await db.musicModeTrack.create({ data: { musicModeId: musicModeBody.mode.id, trackId: track.id, weight: 100 } });
    const activateMode = await api(`/api/admin/music-modes/${musicModeBody.mode.id}/status`, {
      method: "PATCH", cookie: cookieA, body: { status: "ACTIVE" }
    });
    assert.equal(activateMode.status, 200, await activateMode.clone().text());

    const location = await db.location.create({
      data: {
        organisationId: accountABody.organisation.id,
        name: `Bulk Assignment Location ${suffix}`,
        slug: `bulk-location-${suffix}`
      }
    });
    const zones = await Promise.all([
      db.zone.create({
        data: { locationId: location.id, name: "Main floor", slug: "main-floor" }
      }),
      db.zone.create({
        data: { locationId: location.id, name: "Cafe", slug: "cafe" }
      })
    ]);
    const openingHours = await api(
      `/api/admin/locations/${location.id}/opening-hours`,
      {
        method: "PUT",
        cookie: cookieA,
        body: {
          weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            isClosed: false,
            opensAt: "00:00",
            closesAt: "23:59"
          })),
          exceptions: [
            { date: "2026-12-25", label: "Christmas", isClosed: true },
            { date: "2026-12-31", label: "New Year's Eve", isClosed: false, opensAt: "09:00", closesAt: "14:00" }
          ]
        }
      }
    );
    assert.equal(openingHours.status, 200, await openingHours.clone().text());
    assert.equal(await db.locationOpeningHour.count({ where: { locationId: location.id } }), 7);
    assert.equal(await db.locationOpeningException.count({ where: { locationId: location.id } }), 2);
    assert.equal(await db.auditLog.count({ where: { action: "LOCATION_OPENING_HOURS_UPDATED", entityId: location.id } }), 1);

    const promoMedia = await db.mediaAsset.create({
      data: {
        organisationId: accountABody.organisation.id,
        name: `Campaign promo ${suffix}`,
        originalName: "campaign-promo.mp3",
        storageKey: `integration/promos/${suffix}.mp3`,
        mimeType: "audio/mpeg",
        sizeBytes: 2048n,
        durationSeconds: 20,
        mediaType: "COMMERCIAL",
        libraryType: "ORGANISATION_PROMO",
        status: "READY"
      }
    });
    const promoAsset = await db.promoAsset.create({
      data: {
        organisationId: accountABody.organisation.id,
        name: `Campaign promo ${suffix}`,
        mediaType: "COMMERCIAL",
        languageCode: "en"
      }
    });
    const promoVersion = await db.promoVersion.create({
      data: {
        promoAssetId: promoAsset.id,
        mediaAssetId: promoMedia.id,
        version: 1,
        status: "APPROVED",
        qcStatus: "PASSED",
        languageCode: "en",
        durationSeconds: 20,
        reviewedAt: new Date()
      }
    });
    await db.promoAsset.update({ where: { id: promoAsset.id }, data: { currentApprovedVersionId: promoVersion.id } });

    const campaignPayload = {
      organisationId: accountABody.organisation.id,
      promoVersionId: promoVersion.id,
      name: `Lunch offer ${suffix}`,
      priority: "NORMAL",
      schedulingMode: "PLAYS_PER_HOUR",
      playsPerHour: 12,
      effectiveFrom: dateOffset(-1),
      effectiveTo: dateOffset(1),
      maxPromoMinutesPerHour: 12,
      minSamePromoGapMinutes: 5,
      minAnyPromoGapMinutes: 2,
      respectOpeningHours: true,
      targets: [{ targetType: "LOCATION", targetId: location.id }],
      schedules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startsAt: "00:00", endsAt: "23:59" }))
    };
    const campaignPreview = await api("/api/admin/campaigns/preview", {
      method: "POST",
      cookie: cookieA,
      body: campaignPayload
    });
    assert.equal(campaignPreview.status, 200, await campaignPreview.clone().text());
    const campaignPreviewBody = await campaignPreview.json();
    assert.equal(campaignPreviewBody.preview.canPublish, true);
    assert.equal(campaignPreviewBody.preview.targetZoneCount, 2);
    assert.ok(campaignPreviewBody.preview.estimatedTotalPlays > 0);

    const campaignDraft = await api("/api/admin/campaigns", {
      method: "POST",
      cookie: cookieA,
      body: campaignPayload
    });
    assert.equal(campaignDraft.status, 201, await campaignDraft.clone().text());
    const campaignDraftBody = await campaignDraft.json();
    assert.equal(campaignDraftBody.campaign.status, "DRAFT");
    assert.equal(await db.campaignTarget.count({ where: { campaignId: campaignDraftBody.campaign.id } }), 1);
    assert.equal(await db.campaignSchedule.count({ where: { campaignId: campaignDraftBody.campaign.id } }), 7);

    const publishedCampaign = await api(`/api/admin/campaigns/${campaignDraftBody.campaign.id}/publish`, {
      method: "PATCH",
      cookie: cookieA
    });
    assert.equal(publishedCampaign.status, 200, await publishedCampaign.clone().text());
    const publishedCampaignBody = await publishedCampaign.json();
    assert.equal(publishedCampaignBody.campaign.status, "PUBLISHED");
    assert.equal(publishedCampaignBody.campaign.publicationRevision, 1);
    assert.match(publishedCampaignBody.campaign.publishedConfigurationHash, /^[0-9a-f]{64}$/);
    assert.equal(await db.auditLog.count({ where: { action: "CAMPAIGN_DRAFT_CREATED", entityId: campaignDraftBody.campaign.id } }), 1);
    assert.equal(await db.auditLog.count({ where: { action: "CAMPAIGN_PUBLISHED", entityId: campaignDraftBody.campaign.id } }), 1);

    const publishedSchedule = await api("/api/admin/music-schedules", {
      method: "POST",
      cookie: cookieA,
      body: {
        organisationId: accountABody.organisation.id,
        targetType: "LOCATION",
        targetId: location.id,
        name: `Retail week ${suffix}`,
        publish: true,
        slots: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startsAt: "00:00", endsAt: "23:59", musicModeId: musicModeBody.mode.id, priority: 10 }))
      }
    });
    assert.equal(publishedSchedule.status, 201, await publishedSchedule.clone().text());
    const publishedScheduleBody = await publishedSchedule.json();
    assert.equal(publishedScheduleBody.schedule.status, "PUBLISHED");
    assert.equal(publishedScheduleBody.schedule.version, 1);
    assert.equal(await db.auditLog.count({ where: { action: "MUSIC_SCHEDULE_PUBLISHED", entityId: publishedScheduleBody.schedule.id } }), 1);

    const resolvedSchedule = await api(`/api/admin/music-schedules/resolve?zoneId=${zones[0].id}&at=2026-08-31T10%3A00%3A00.000Z`, { cookie: cookieA });
    assert.equal(resolvedSchedule.status, 200, await resolvedSchedule.clone().text());
    const resolvedScheduleBody = await resolvedSchedule.json();
    assert.equal(resolvedScheduleBody.resolution.musicMode.id, musicModeBody.mode.id);
    assert.equal(resolvedScheduleBody.resolution.reason, "LOCATION_SLOT");

    const rawPlayerToken = `integration-player-${suffix}`;
    await db.player.create({ data: {
      organisationId: accountABody.organisation.id,
      zoneId: zones[0].id,
      name: `Integration Player ${suffix}`,
      status: "ONLINE",
      sessionTokenHash: hashPlayerToken(rawPlayerToken, process.env.SESSION_SECRET),
      enrolledAt: new Date(),
      lastHeartbeatAt: new Date()
    } });
    const playerInstanceId = randomUUID();
    const playerManifest = await api("/api/player/manifest", {
      cookie: `ruvanas_player=${rawPlayerToken}`,
      headers: { "x-ruvanas-player-instance": playerInstanceId }
    });
    assert.equal(playerManifest.status, 200, await playerManifest.clone().text());
    const playerManifestBody = await playerManifest.json();
    assert.equal(playerManifestBody.state, "READY");
    assert.equal(playerManifestBody.musicMode.id, musicModeBody.mode.id);
    assert.equal(playerManifestBody.playlist[0].trackId, track.id);
    assert.equal(playerManifestBody.playlist[0].itemType, "MUSIC");
    assert.match(playerManifestBody.playlist[0].scheduleItemId, /^[0-9a-f]{64}$/);
    assert.equal("storageKey" in playerManifestBody.playlist[0], false);
    assert.match(playerManifestBody.playlist[0].proofToken, /^[0-9a-f]{64}$/);
    assert.equal(playerManifestBody.insertions.length, 1);
    assert.equal(playerManifestBody.insertions[0].itemType, "PROMO");
    assert.equal(playerManifestBody.insertions[0].campaignId, campaignDraftBody.campaign.id);
    assert.equal(playerManifestBody.insertions[0].promoVersionId, promoVersion.id);
    assert.equal(await db.playoutIntent.count({ where: { scheduleItemId: playerManifestBody.insertions[0].scheduleItemId } }), 1);

    const playbackEventId = randomUUID();
    const playbackEvent = {
      eventId: playbackEventId,
      manifestVersion: playerManifestBody.version,
      proofToken: playerManifestBody.playlist[0].proofToken,
      scheduleItemId: playerManifestBody.playlist[0].scheduleItemId,
      itemType: "MUSIC",
      trackId: track.id,
      eventType: "STARTED",
      occurredAt: new Date().toISOString(),
      positionSeconds: 0
    };
    const proofOfPlay = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: `ruvanas_player=${rawPlayerToken}`,
      body: { events: [playbackEvent] }
    });
    assert.equal(proofOfPlay.status, 200, await proofOfPlay.clone().text());
    assert.equal((await proofOfPlay.json()).accepted, 1);

    const duplicateProofOfPlay = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: `ruvanas_player=${rawPlayerToken}`,
      body: { events: [playbackEvent] }
    });
    assert.equal(duplicateProofOfPlay.status, 200, await duplicateProofOfPlay.clone().text());
    assert.equal((await duplicateProofOfPlay.json()).duplicates, 1);
    assert.equal(await db.proofOfPlayEvent.count({ where: { playerId: playerManifestBody.player.id, clientEventId: playbackEventId } }), 1);

    const promoPlaybackEventId = randomUUID();
    const promoProofOfPlay = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: `ruvanas_player=${rawPlayerToken}`,
      body: { events: [{
        eventId: promoPlaybackEventId,
        manifestVersion: playerManifestBody.version,
        proofToken: playerManifestBody.insertions[0].proofToken,
        scheduleItemId: playerManifestBody.insertions[0].scheduleItemId,
        itemType: "PROMO",
        eventType: "COMPLETED",
        occurredAt: new Date().toISOString(),
        positionSeconds: 20
      }] }
    });
    assert.equal(promoProofOfPlay.status, 200, await promoProofOfPlay.clone().text());
    assert.equal((await promoProofOfPlay.json()).accepted, 1);
    const storedPromoProof = await db.proofOfPlayEvent.findUnique({ where: { clientEventId: promoPlaybackEventId } });
    assert.equal(storedPromoProof.itemType, "PROMO");
    assert.equal(storedPromoProof.campaignId, campaignDraftBody.campaign.id);
    assert.equal(storedPromoProof.promoVersionId, promoVersion.id);
    assert.equal(storedPromoProof.trackId, null);

    const campaignReport = await api(
      `/api/reports/campaign-proof?from=${dateOffset(-1)}&to=${dateOffset(1)}&campaignId=${campaignDraftBody.campaign.id}`,
      { cookie: cookieA }
    );
    assert.equal(campaignReport.status, 200, await campaignReport.clone().text());
    const campaignReportBody = await campaignReport.json();
    assert.equal(campaignReportBody.organisation.id, accountABody.organisation.id);
    assert.equal(campaignReportBody.report.summary.planned, 1);
    assert.equal(campaignReportBody.report.summary.completed, 1);
    assert.equal(campaignReportBody.report.summary.audienceMeasurement, false);
    assert.equal(campaignReportBody.report.rows[0].campaignId, campaignDraftBody.campaign.id);

    const foreignCampaignReport = await api(
      `/api/reports/campaign-proof?from=${dateOffset(-1)}&to=${dateOffset(1)}&campaignId=${campaignDraftBody.campaign.id}`,
      { cookie: cookieB }
    );
    assert.equal(foreignCampaignReport.status, 200);
    assert.equal((await foreignCampaignReport.json()).report.summary.planned, 0);

    const exportRequest = await api("/api/reports/campaign-proof/exports", {
      method: "POST",
      cookie: cookieA,
      body: { from: dateOffset(-1), to: dateOffset(1), campaignId: campaignDraftBody.campaign.id }
    });
    assert.equal(exportRequest.status, 202, await exportRequest.clone().text());
    const exportRequestBody = await exportRequest.json();
    const foreignExportStatus = await api(exportRequestBody.job.statusUrl, { cookie: cookieB });
    assert.equal(foreignExportStatus.status, 404);

    let exportJob;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const statusResponse = await api(exportRequestBody.job.statusUrl, { cookie: cookieA });
      assert.equal(statusResponse.status, 200, await statusResponse.clone().text());
      exportJob = (await statusResponse.json()).job;
      if (exportJob.status === "READY") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(exportJob.status, "READY", exportJob.error || "Export did not complete");
    const exportDownload = await api(exportJob.downloadUrl, { cookie: cookieA });
    assert.equal(exportDownload.status, 200, await exportDownload.clone().text());
    assert.match(exportDownload.headers.get("content-type"), /text\/csv/);
    assert.match(exportDownload.headers.get("content-disposition"), /attachment/);
    const csv = await exportDownload.text();
    assert.match(csv, /device-confirmed playback/);
    assert.match(csv, new RegExp(campaignPayload.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(await db.auditLog.count({ where: { action: "CAMPAIGN_PROOF_EXPORT_COMPLETED", entityId: exportJob.id } }), 1);

    const operationalReport = await api(`/api/reports/operational?from=${dateOffset(-1)}&to=${dateOffset(1)}`, { cookie: cookieA });
    assert.equal(operationalReport.status, 200, await operationalReport.clone().text());
    const operationalBody = await operationalReport.json();
    assert.equal(operationalBody.organisation.id, accountABody.organisation.id);
    assert.equal(operationalBody.canExport, true);
    assert.ok(operationalBody.report.summary.playbackCompletedCount >= 1);
    assert.equal(operationalBody.report.school.studentIdentitiesIncluded, false);

    const operationalExportRequest = await api("/api/reports/operational/exports", {
      method: "POST", cookie: cookieA, body: { from: dateOffset(-1), to: dateOffset(1) }
    });
    assert.equal(operationalExportRequest.status, 202, await operationalExportRequest.clone().text());
    const operationalExportRequestBody = await operationalExportRequest.json();
    const foreignOperationalExportStatus = await api(operationalExportRequestBody.job.statusUrl, { cookie: cookieB });
    assert.equal(foreignOperationalExportStatus.status, 404);

    let operationalExportJob;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const statusResponse = await api(operationalExportRequestBody.job.statusUrl, { cookie: cookieA });
      assert.equal(statusResponse.status, 200, await statusResponse.clone().text());
      operationalExportJob = (await statusResponse.json()).job;
      if (operationalExportJob.status === "READY") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(operationalExportJob.status, "READY", operationalExportJob.error || "Operational export did not complete");
    const invalidOperationalUrl = operationalExportJob.downloadUrl.replace(
      /token=([0-9a-f])/,
      (_match, firstCharacter) => `token=${firstCharacter === "0" ? "1" : "0"}`
    );
    const invalidOperationalDownload = await api(invalidOperationalUrl, { cookie: cookieA });
    assert.equal(invalidOperationalDownload.status, 403);
    const operationalDownload = await api(operationalExportJob.downloadUrl, { cookie: cookieA });
    assert.equal(operationalDownload.status, 200, await operationalDownload.clone().text());
    const operationalCsv = await operationalDownload.text();
    assert.match(operationalCsv, /Device-confirmed operational evidence/);
    assert.match(operationalCsv, /Audience measured/);
    assert.equal(await db.auditLog.count({ where: { action: "OPERATIONAL_ANALYTICS_EXPORT_COMPLETED", entityId: operationalExportJob.id } }), 1);

    const tamperedProofOfPlay = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: `ruvanas_player=${rawPlayerToken}`,
      body: { events: [{ ...playbackEvent, eventId: randomUUID(), proofToken: "0".repeat(64) }] }
    });
    assert.equal(tamperedProofOfPlay.status, 400);

    const listenerToken = new URL(playerManifestBody.playlist[0].mediaUrl, baseUrl).searchParams.get("listener");
    const unavailablePlayerMedia = await api(`/api/player/media/not-an-asset?listener=${encodeURIComponent(listenerToken)}`, { cookie: `ruvanas_player=${rawPlayerToken}` });
    assert.equal(unavailablePlayerMedia.status, 404);
    const channels = await Promise.all([
      db.channel.create({
        data: {
          organisationId: accountABody.organisation.id,
          name: `Original Channel ${suffix}`,
          slug: `original-channel-${suffix}`
        }
      }),
      db.channel.create({
        data: {
          organisationId: accountABody.organisation.id,
          name: `Group Channel ${suffix}`,
          slug: `group-channel-${suffix}`
        }
      })
    ]);
    await db.channelAssignment.create({
      data: { channelId: channels[0].id, zoneId: zones[0].id }
    });
    const locationGroup = await db.locationGroup.create({
      data: {
        organisationId: accountABody.organisation.id,
        name: `Integration Group ${suffix}`,
        slug: `integration-group-${suffix}`,
        locations: { create: { locationId: location.id } }
      }
    });

    const bulkAssignment = await api(
      `/api/admin/location-groups/${locationGroup.id}/channel`,
      {
        method: "POST",
        cookie: cookieA,
        body: { channelId: channels[1].id, dryRun: true }
      }
    );
    assert.equal(bulkAssignment.status, 200, await bulkAssignment.clone().text());
    const bulkResult = await bulkAssignment.json();
    assert.equal(bulkResult.changedZoneCount, 2);
    assert.equal(bulkResult.unchangedZoneCount, 0);
    assert.equal(bulkResult.dryRun, true);

    const assignmentsBeforeApply = await db.channelAssignment.findMany({
      where: { zoneId: { in: zones.map((zone) => zone.id) }, activeTo: null }
    });
    assert.equal(assignmentsBeforeApply.length, 1);
    assert.equal(assignmentsBeforeApply[0].channelId, channels[0].id);

    const appliedAssignment = await api(
      `/api/admin/location-groups/${locationGroup.id}/channel`,
      {
        method: "POST",
        cookie: cookieA,
        body: { channelId: channels[1].id }
      }
    );
    assert.equal(appliedAssignment.status, 200, await appliedAssignment.clone().text());
    const appliedResult = await appliedAssignment.json();
    assert.equal(appliedResult.changedZoneCount, 2);
    assert.equal(appliedResult.unchangedZoneCount, 0);

    const activeAssignments = await db.channelAssignment.findMany({
      where: { zoneId: { in: zones.map((zone) => zone.id) }, activeTo: null },
      orderBy: { zoneId: "asc" }
    });
    assert.equal(activeAssignments.length, 2);
    assert.ok(activeAssignments.every((assignment) => assignment.channelId === channels[1].id));

    await assert.rejects(
      db.channelAssignment.create({
        data: {
          channelId: channels[0].id,
          zoneId: zones[1].id
        }
      }),
      (error) => error?.code === "P2002"
    );

    const repeatedAssignment = await api(
      `/api/admin/location-groups/${locationGroup.id}/channel`,
      {
        method: "POST",
        cookie: cookieA,
        body: { channelId: channels[1].id }
      }
    );
    assert.equal(repeatedAssignment.status, 200);
    const repeatedResult = await repeatedAssignment.json();
    assert.equal(repeatedResult.changedZoneCount, 0);
    assert.equal(repeatedResult.unchangedZoneCount, 2);

    const batchAudits = await db.auditLog.count({
      where: {
        organisationId: accountABody.organisation.id,
        action: "LOCATION_GROUP_CHANNEL_ASSIGNED",
        entityId: locationGroup.id
      }
    });
    assert.equal(batchAudits, 1);
  } finally {
    await db.$disconnect();
  }

  const fakeAudio = new FormData();
  fakeAudio.set("organisationId", accountABody.organisation.id);
  fakeAudio.set("name", "Renamed executable");
  fakeAudio.set("mediaType", "JINGLE");
  fakeAudio.set("file", new Blob(["not audio content"], { type: "audio/mpeg" }), "fake.mp3");
  const invalidUpload = await fetch(`${baseUrl}/api/media/upload`, {
    method: "POST",
    headers: { origin: baseUrl, cookie: cookieA },
    body: fakeAudio
  });
  assert.equal(invalidUpload.status, 400);

  const limitedEmail = `rate-limit-${suffix}@example.invalid`;
  let lastResponse;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    lastResponse = await api("/api/auth/login", {
      method: "POST",
      body: { email: limitedEmail, password: "incorrect-password" }
    });
  }
  assert.equal(lastResponse.status, 429);
  assert.ok(Number(lastResponse.headers.get("retry-after")) > 0);
});


