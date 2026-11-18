export function pilotPreviewEnvironment(organisationIds = ["org-one"]) {
  return { RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "0",
    RUVANAS_PUBLIC_URL: "https://preview.example.invalid", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.invalid", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.invalid",
    RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "true",
    RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: JSON.stringify(organisationIds),
    RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "true" };
}
