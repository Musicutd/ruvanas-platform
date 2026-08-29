export const COMBINED_DELIVERY_NOTICE = "Counts represent device-confirmed audio or visual delivery events. They do not represent listeners, viewers, impressions, audience reach, or commercial outcomes.";

function date(value, label) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error(`${label} is invalid.`);
  return text;
}

export function normaliseCombinedDeliveryFilters(input = {}, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29)).toISOString().slice(0, 10);
  const from = date(input.from || defaultFrom, "From date");
  const to = date(input.to || today, "To date");
  if (to < from) throw new Error("To date cannot be before from date.");
  const fromInstant = new Date(`${from}T00:00:00.000Z`);
  const until = new Date(`${to}T00:00:00.000Z`); until.setUTCDate(until.getUTCDate() + 1);
  if (until.getTime() - fromInstant.getTime() > 93 * 24 * 60 * 60 * 1000) throw new Error("Choose a reporting window of 93 days or fewer.");
  const retailMediaOrderId = String(input.retailMediaOrderId || "").trim() || null;
  if (retailMediaOrderId && !/^[A-Za-z0-9_-]+$/.test(retailMediaOrderId)) throw new Error("Retail-media order is invalid.");
  return { from, to, fromInstant, until, retailMediaOrderId };
}

export function combinedDeliverySummary({ audio = [], visual = [] } = {}) {
  const audioCompleted = audio.filter((event) => event.eventType === "COMPLETED").length;
  const audioFailed = audio.filter((event) => event.eventType === "FAILED").length;
  const visualCompleted = visual.filter((event) => event.eventType === "COMPLETED").length;
  const visualFailed = visual.filter((event) => event.eventType === "FAILED").length;
  const takeoverCompleted = visual.filter((event) => event.eventType === "COMPLETED" && event.takeoverId).length;
  const retailMediaVisualCompleted = visual.filter((event) => event.eventType === "COMPLETED" && event.retailMediaOrderId).length;
  return { audioCompleted, audioFailed, visualCompleted, visualFailed, takeoverCompleted, retailMediaVisualCompleted };
}

function cell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function combinedDeliveryCsv(rows = []) {
  const columns = ["medium", "occurredAt", "eventType", "device", "location", "zone", "content", "campaignOrOrder", "takeover"];
  return [columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\r\n") + "\r\n";
}
