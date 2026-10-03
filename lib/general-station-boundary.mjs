// The generic station-management UI is not a Corrections facility workspace.
// Include legacy stations with no product family, but exclude any station that
// owns a Corrections-rights or facility-assigned channel even if its family
// was never labelled. Include inactive child channels: public pages must not
// reveal a private station while playback is paused.
export const GENERAL_STATION_MANAGEMENT_WHERE = {
  OR: [{ productFamily: null }, { productFamily: { not: "CORRECTIONS" } }],
  channels: {
    none: {
      OR: [
        { musicRightsUse: "CORRECTIONS_RADIO" },
        { zoneAssignments: { some: { zone: { location: { correctionsFacility: { isNot: null } } } } } }
      ]
    }
  }
};
