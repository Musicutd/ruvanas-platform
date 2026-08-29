export const SCHOOL_NOTICEBOARD_POLICY_VERSION = "school-noticeboard-v1";
export const SCHOOL_NOTICEBOARD_MAX_WINDOW_DAYS = 31;

const themes = new Set(["INFORMATION", "CELEBRATION", "IMPORTANT"]);

function clean(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function instant(value, label) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return parsed;
}

function integer(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function normaliseSchoolNoticeboardPost(input = {}) {
  const announcementId = clean(input.announcementId, 100);
  const locationId = clean(input.locationId, 100) || null;
  const zoneId = clean(input.zoneId, 100) || null;
  const startsAt = instant(input.startsAt, "Noticeboard start");
  const endsAt = instant(input.endsAt, "Noticeboard end");
  const priority = integer(input.priority ?? 50, "Priority", 0, 100);
  const displaySeconds = integer(input.displaySeconds ?? 15, "Display duration", 8, 120);
  const theme = themes.has(input.theme) ? input.theme : "INFORMATION";

  if (!announcementId) throw new Error("Choose an approved school announcement.");
  if (Boolean(locationId) === Boolean(zoneId)) throw new Error("Choose exactly one school location or zone.");
  if (endsAt <= startsAt) throw new Error("The noticeboard end must be after its start.");
  if (endsAt.getTime() - startsAt.getTime() > SCHOOL_NOTICEBOARD_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`A noticeboard post may run for no more than ${SCHOOL_NOTICEBOARD_MAX_WINDOW_DAYS} days.`);
  }

  return { announcementId, locationId, zoneId, startsAt, endsAt, priority, displaySeconds, theme };
}

export function compileSchoolNoticeboard({ posts = [], device, instant: current = new Date() }) {
  if (!device?.id || !device?.organisationId || !device?.zone?.id || !device?.zone?.location?.id) return [];
  return posts
    .filter((post) => (
      post?.organisationId === device.organisationId &&
      post.status === "SCHEDULED" &&
      post.announcement?.status === "APPROVED" &&
      new Date(post.startsAt) <= current &&
      new Date(post.endsAt) > current &&
      (post.zoneId === device.zone.id || (post.locationId === device.zone.location.id && !post.zoneId))
    ))
    .sort((left, right) => (
      right.priority - left.priority ||
      new Date(right.startsAt) - new Date(left.startsAt) ||
      left.id.localeCompare(right.id)
    ))
    .slice(0, 20)
    .map((post) => ({
      id: post.id,
      title: clean(post.announcement.title, 160),
      body: clean(post.announcement.summary, 1000),
      theme: themes.has(post.theme) ? post.theme : "INFORMATION",
      priority: post.priority,
      displaySeconds: post.displaySeconds,
      startsAt: new Date(post.startsAt).toISOString(),
      endsAt: new Date(post.endsAt).toISOString(),
      policyVersion: post.policyVersion || SCHOOL_NOTICEBOARD_POLICY_VERSION
    }));
}
