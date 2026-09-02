export const interfaceMessages = Object.freeze({
  organisations: {
    title: "Organisations",
    emptyTitle: "No organisations yet",
    emptyDescription: "Create the first customer organisation before adding locations, stations or team members."
  },
  locations: {
    title: "Retail locations",
    emptyTitle: "No retail locations yet",
    emptyDescription: "Add the first shop or venue, then create its listening areas and opening hours."
  },
  stations: {
    title: "Stations",
    emptyTitle: "No stations yet",
    emptyDescription: "Create a station, then add its private streaming connection before assigning players."
  },
  musicModes: {
    title: "Music modes",
    emptyTitle: "No music modes yet",
    emptyDescription: "Create a draft music mode now; approved catalogue tracks can be added when they are ready."
  },
  schedules: {
    title: "Music schedules",
    emptyTitle: "No schedules yet",
    emptyDescription: "Create a draft weekly schedule and review it before making it live."
  },
  notifications: {
    title: "Operational notifications",
    emptyTitle: "You are all caught up",
    emptyDescription: "New playback, stream, campaign, billing and school-review alerts will appear here."
  },
  analytics: {
    title: "Operational analytics",
    emptyTitle: "No evidence in this period",
    emptyDescription: "Try a wider date range. Operational totals appear after the platform records activity."
  },
  reports: {
    title: "Proof-of-play reports",
    emptyTitle: "No campaign activity in this period",
    emptyDescription: "Try a wider date range or remove a filter to see confirmed campaign delivery."
  },
  playerSessions: {
    title: "Active shop streams",
    emptyTitle: "No active shop streams",
    emptyDescription: "A player appears here as soon as it starts using one of the organisation's stream slots."
  }
});

export function safeInterfaceMessage(value, fallback, maxLength = 220) {
  const message = typeof value === "string" ? value.trim() : "";
  const safeFallback = typeof fallback === "string" && fallback.trim() ? fallback.trim() : "Something went wrong. Please try again.";
  if (!message) return safeFallback;
  return message.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, maxLength);
}

export function confirmationCopy(action, subject) {
  const safeSubject = typeof subject === "string" && subject.trim() ? subject.trim() : "this item";
  if (action === "DISMISS_NOTIFICATION") return {
    title: "Dismiss this notification?",
    message: `${safeSubject} will leave the active notification list. The underlying operational record is not deleted.`,
    confirmLabel: "Dismiss notification"
  };
  if (action === "ARCHIVE_MUSIC_MODE") return {
    title: "Archive this music mode?",
    message: `${safeSubject} will no longer be available for new scheduling choices. Existing audit records remain available.`,
    confirmLabel: "Archive music mode"
  };
  if (action === "STOP_PLAYER_SESSION") return {
    title: "Stop this live stream session?",
    message: `${safeSubject} will stop using its current stream slot. The enrolled player remains registered and can reconnect later.`,
    confirmLabel: "Stop session"
  };
  return {
    title: "Confirm this action",
    message: `Please confirm the change to ${safeSubject}.`,
    confirmLabel: "Confirm"
  };
}
