// The generic station-management UI is not a Corrections facility workspace.
// Include legacy stations with no product family, but exclude any station that
// owns a Corrections-rights channel even if its family was never labelled.
export const GENERAL_STATION_MANAGEMENT_WHERE = {
  OR: [{ productFamily: null }, { productFamily: { not: "CORRECTIONS" } }],
  channels: { none: { musicRightsUse: "CORRECTIONS_RADIO" } }
};
