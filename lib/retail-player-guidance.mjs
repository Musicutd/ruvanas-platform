// Presentation only: readiness and access remain decided by the existing player services.
export function retailPlayerGuidance({ players = [], hasZones = false, canManage = false } = {}) {
  const active = players.filter(player => player.status !== "DISABLED");
  if (!active.length) return canManage
    ? { kind: hasZones ? "CREATE_PLAYER" : "ADD_SHOP", title: hasZones ? "Connect your first shop device" : "Add your first shop", detail: hasZones ? "Choose its listening area and give the player a name." : "Start with the shop name and its listening area. You can then connect its device." }
    : { kind: "VIEW_ONLY", title: "No shop devices yet", detail: "Your organisation’s owner or manager can connect a shop device." };
  const attention = active.find(player => !player.readiness?.ready);
  if (!attention) return { kind: "READY", title: "Your shop devices are ready", detail: "Recent playback is confirmed for each connected shop device." };
  const code = attention.readiness?.code;
  const messages = {
    WAITING_FOR_ENROLMENT: ["Connect the shop device", "Enter its one-time code on the device that will stay in the shop. Keep the player page open."],
    WAITING_FOR_CONNECTION: ["Open the player in your shop", "The device has been registered. Open its player and keep it connected to the internet."],
    OFFLINE: ["Reconnect the shop device", "Open the player on the shop device and check its internet connection."],
    CHANNEL_REQUIRED: ["Music needs assigning to this shop", "Ask your administrator to assign the shop’s music channel. You can continue planning your music and commercials."],
    WAITING_FOR_SOURCE: ["Checking the shop audio", "Keep the player open. Its audio connection has not been confirmed yet."],
    SOURCE_ATTENTION: ["Check the shop player", "Open the player on the shop device and check its audio message. Contact your administrator if it persists."],
    WAITING_FOR_PLAYBACK: ["Press play on the shop device", "Allow audio if the browser asks. This page will confirm when it receives recent playback information."]
  };
  const [title, detail] = messages[code] || ["Check the shop device", "Open its connection details below to see what still needs attention."];
  return { kind: "CHECK_PLAYER", playerId: attention.id, playerName: attention.name, title, detail };
}

export function retailPlayerStatusLabel(readiness = {}) {
  const labels = {
    READY: "Playback confirmed", DISABLED: "Retired", WAITING_FOR_ENROLMENT: "Needs connecting",
    WAITING_FOR_CONNECTION: "Waiting for device", OFFLINE: "Offline", CHANNEL_REQUIRED: "Music not assigned",
    WAITING_FOR_SOURCE: "Checking audio", SOURCE_ATTENTION: "Check audio", WAITING_FOR_PLAYBACK: "Waiting for playback"
  };
  return labels[readiness.code] || "Status not confirmed";
}
