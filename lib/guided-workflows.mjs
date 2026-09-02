function orderedSteps(items) {
  const firstIncomplete = items.findIndex((item) => !item.complete);
  return items.map((item, index) => ({
    id: item.id,
    label: item.label,
    detail: item.detail,
    status: item.complete
      ? "COMPLETE"
      : index === (firstIncomplete === -1 ? items.length - 1 : firstIncomplete)
        ? "CURRENT"
        : "UPCOMING"
  }));
}

export function stationWorkflowSteps({ stationCreated = false, streamConnected = false } = {}) {
  return orderedSteps([
    { id: "IDENTITY", label: "Station details", detail: "Name your station and describe its purpose.", complete: stationCreated },
    { id: "STREAM", label: "Connect streaming", detail: "Add the private streaming-server details.", complete: streamConnected },
    { id: "REVIEW", label: "Review and go live", detail: "Confirm the station status and service limits.", complete: streamConnected }
  ]);
}

export function scheduleWorkflowSteps({ organisationSelected = false, targetSelected = false, slotsReady = false, saved = false } = {}) {
  return orderedSteps([
    { id: "ORGANISATION", label: "Choose customer", detail: "Select the organisation that owns this schedule.", complete: organisationSelected },
    { id: "TARGET", label: "Choose playback area", detail: "Select the location or zone that should receive it.", complete: targetSelected },
    { id: "PROGRAMME", label: "Build the week", detail: "Add local-time slots and active music modes.", complete: slotsReady },
    { id: "SAVE", label: "Review and save", detail: "Keep a draft or publish the verified schedule.", complete: saved }
  ]);
}

export function playerWorkflowSteps({ configured = false, enrolled = false, connected = false, playbackConfirmed = false } = {}) {
  return orderedSteps([
    { id: "CONFIGURE", label: "Prepare player", detail: "Create one secure player for the shop or zone.", complete: configured },
    { id: "ENROL", label: "Enrol device", detail: "Enter its one-time code on the shop device.", complete: enrolled },
    { id: "CONNECT", label: "Connect audio", detail: "Keep the enrolled device online with a channel assigned.", complete: connected },
    { id: "CONFIRM", label: "Confirm playback", detail: "Wait for recent proof that audio started successfully.", complete: playbackConfirmed }
  ]);
}

export function mediaWorkflowSteps({ fileSelected = false, detailsReviewed = false, uploaded = false } = {}) {
  return orderedSteps([
    { id: "FILE", label: "Choose audio", detail: "Select the audio file from this device.", complete: fileSelected },
    { id: "DETAILS", label: "Describe it", detail: "Check its name, type, language and duration.", complete: detailsReviewed },
    { id: "UPLOAD", label: "Upload for review", detail: "Send the file securely and confirm its review status.", complete: uploaded }
  ]);
}

export function safeWorkflowMessage(error, fallback) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = message.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 300) : fallback;
}
