export function scopeStationScheduleData(payload, stationId) {
  if (!stationId) return payload;
  return {
    ...payload,
    sources: {
      ...payload.sources,
      channels: (payload.sources?.channels || []).filter((channel) => channel.stationId === stationId)
    },
    schedules: (payload.schedules || []).filter((schedule) => schedule.channel?.station?.id === stationId)
  };
}
