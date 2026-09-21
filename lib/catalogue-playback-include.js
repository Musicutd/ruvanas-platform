// Every playback eligibility check must receive the provider status and
// canonical genre. Promo Only tracks fail closed when these are absent.
export const cataloguePlaybackTrackInclude = {
  mediaAsset: { include: { genres: { include: { mediaGenre: true } } } },
  distributorItems: { select: {
    status: true,
    autoDjReady: true,
    canonicalGenre: { select: { active: true, providerReviewStatus: true, minimumCatalogueLevel: true, slug: true, name: true } }
  } }
};
