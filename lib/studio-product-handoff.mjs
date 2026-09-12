export const STUDIO_PRODUCT_DESTINATIONS = Object.freeze({
  RETAIL_PROMOTION: Object.freeze({
    product: "RETAIL",
    label: "Retail promotion",
    description: "Open Promotions with this approved master already selected.",
    entitlement: "retailRadioEnabled"
  }),
  SCHOOL_EPISODE: Object.freeze({
    product: "SCHOOL",
    label: "School episode",
    description: "Submit this master into its linked episode for staff review.",
    entitlement: "schoolRadioEnabled"
  }),
  ONLINE_PODCAST: Object.freeze({
    product: "ONLINE",
    label: "Online podcast",
    description: "Open Podcasts with this approved master already selected.",
    entitlement: "onlineRadioEnabled"
  }),
  HEALTH_ANNOUNCEMENT: Object.freeze({ product: "HEALTH", label: "Health announcement", description: "Send the approved master to the Health channel workspace.", entitlement: "healthRadioEnabled" }),
  HEALTH_PODCAST: Object.freeze({ product: "HEALTH", label: "Health podcast", description: "Open Health podcasts with this approved master selected.", entitlement: "healthRadioEnabled" }),
  FAITH_SERMON: Object.freeze({ product: "FAITH", label: "Sermon or teaching", description: "Open Faith podcasts with this approved teaching selected.", entitlement: "faithRadioEnabled" }),
  FAITH_ANNOUNCEMENT: Object.freeze({ product: "FAITH", label: "Faith announcement", description: "Send the approved master to the Faith channel workspace.", entitlement: "faithRadioEnabled" }),
  FAITH_PODCAST: Object.freeze({ product: "FAITH", label: "Faith podcast", description: "Open Faith podcasts with this approved master selected.", entitlement: "faithRadioEnabled" })
});

export function studioHandoffKey({ renderId, destination, targetEpisodeId = null }) {
  if (!renderId || !STUDIO_PRODUCT_DESTINATIONS[destination]) throw new Error("Choose a valid approved Studio output and destination.");
  return [renderId, destination, targetEpisodeId || "none"].join(":");
}

export function studioWorkflowPath({ destination, promoVersionId, mediaAssetId, targetEpisodeId = null }) {
  if (destination === "RETAIL_PROMOTION") return `/dashboard/promotions?promoVersionId=${encodeURIComponent(promoVersionId)}`;
  if (destination === "SCHOOL_EPISODE") return `/dashboard/school-radio?episodeId=${encodeURIComponent(targetEpisodeId || "")}&studioPromoVersionId=${encodeURIComponent(promoVersionId)}`;
  if (destination === "ONLINE_PODCAST") return `/dashboard/podcasts?mediaAssetId=${encodeURIComponent(mediaAssetId)}`;
  if (destination === "HEALTH_ANNOUNCEMENT") return `/dashboard/health/setup?mediaAssetId=${encodeURIComponent(mediaAssetId)}`;
  if (destination === "HEALTH_PODCAST") return `/dashboard/podcasts?product=HEALTH&mediaAssetId=${encodeURIComponent(mediaAssetId)}`;
  if (destination === "FAITH_SERMON" || destination === "FAITH_PODCAST") return `/dashboard/podcasts?product=FAITH&mediaAssetId=${encodeURIComponent(mediaAssetId)}`;
  if (destination === "FAITH_ANNOUNCEMENT") return `/dashboard/faith/setup?mediaAssetId=${encodeURIComponent(mediaAssetId)}`;
  throw new Error("Choose a supported Ruvanas product workflow.");
}

export function studioDestinationAvailability({ entitlements, project }) {
  return Object.entries(STUDIO_PRODUCT_DESTINATIONS).map(([key, definition]) => {
    const enabled = Boolean(entitlements?.[definition.entitlement]);
    const hasTarget = key !== "SCHOOL_EPISODE" || Boolean(project?.episodeId);
    return {
      key,
      ...definition,
      available: enabled && hasTarget,
      reason: !enabled ? "This product is not included in the organisation's current plan." : !hasTarget ? "Link this Studio project to a School episode first." : null
    };
  });
}

export function assertStudioRenderReady(render) {
  if (!render || render.status !== "SUCCEEDED" || !render.outputMediaAsset || !render.outputPromoVersion) throw new Error("Choose a completed Studio render.");
  if (render.outputMediaAsset.status !== "READY") throw new Error("The rendered audio is not ready yet.");
  if (render.outputPromoVersion.status !== "APPROVED" || render.outputPromoVersion.qcStatus !== "PASSED") throw new Error("Approve the final Studio output after audio validation before sending it to a product.");
  return render;
}
