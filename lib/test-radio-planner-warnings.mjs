// Read-only draft guidance. These diagnostics cannot approve a plan, select live
// audio, or replace the server's current rights and scheduling checks.
import { compileProgrammeScheduleHorizon, localMinuteToUtc } from "./advanced-scheduler.mjs";
import { isValidIanaTimezone, parseLocalTime } from "./opening-hours.mjs";
import { schedulerLocalInput, schedulerOneOffInstant, schedulerPayloadItem } from "./scheduler-form-time.mjs";

const DAYS = 31, MAX_ITEMS = 200, MAX_WARNINGS = 30;
const clean = (value, fallback) => typeof value === "string" && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) : fallback;
const integer = (value, low, high) => value !== "" && value !== null && Number.isInteger(Number(value)) && Number(value) >= low && Number(value) <= high;
const datePlus = (date, days) => {
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10);
};
const minutesLabel = seconds => `${Math.round(seconds / 60 * 10) / 10} minutes`;

export function testRadioPlannerWarnings(form, sources, { now = new Date() } = {}) {
  const found = { BLOCKING: [], WARNING: [], INFO: [] }, seen = new Set();
  let issueCount = 0;
  const add = (code, severity, message, itemIndexes = []) => {
    const key = `${code}:${itemIndexes.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key); issueCount += 1;
    // Retain enough of each severity so many advisories cannot hide a later
    // blocking overlap. The final list remains bounded even for a full week.
    if (found[severity].length < MAX_WARNINGS) found[severity].push({ code, severity, message: typeof message === "function" ? message() : message, itemIndexes });
  };
  const timezone = form?.timezone;
  const validZone = typeof timezone === "string" && timezone.length <= 100 && isValidIanaTimezone(timezone);
  const instant = now instanceof Date ? new Date(now) : new Date(now);
  const finish = () => {
    const horizon = { code: "DRAFT_REVIEW_HORIZON", severity: "INFO", itemIndexes: [], message: validZone
      ? `Draft checks cover a 31-calendar-day review window starting today in ${timezone}, not live audio. Only administrator approval can change the on-air week.`
      : "Draft checks cover up to 31 local calendar days once the time zone and times are valid. They do not approve or change the on-air week." };
    const issues = [...found.BLOCKING, ...found.WARNING, ...found.INFO];
    if (issueCount <= MAX_WARNINGS - 1) return [horizon, ...issues];
    return [horizon, ...issues.slice(0, MAX_WARNINGS - 2), { code: "MORE_DRAFT_ISSUES", severity: "INFO", itemIndexes: [],
      message: "More draft issues need attention. Fix the listed rows and review again; the current approved week is unchanged." }];
  };
  if (!validZone) add("TIMEZONE_INVALID", "BLOCKING", "Choose a valid planner time zone before checking programme times.");
  if (!Number.isFinite(instant.getTime())) add("REVIEW_TIME_INVALID", "WARNING", "The current time could not be verified. Refresh before checking the next 31 days.");
  if (!Array.isArray(form?.items) || !form.items.length) {
    add("PROGRAMME_REQUIRED", "BLOCKING", "Add a programme, choose a saved playlist and set its day and time before administrator review.");
    return finish();
  }
  if (form.items.length > MAX_ITEMS) add("PROGRAMME_LIMIT", "BLOCKING", "This draft exceeds 200 programmes. Review a shorter draft; only its first 200 rows were checked.");
  const sourceMap = new Map((Array.isArray(sources) ? sources.slice(0, 200) : []).filter(source => source && typeof source.id === "string").map(source => [source.id, source]));
  const timingItems = [], labels = new Map();
  for (const [index, raw] of form.items.slice(0, MAX_ITEMS).entries()) {
    const item = raw && typeof raw === "object" ? raw : {};
    const name = clean(item.label, `Programme ${index + 1}`); labels.set(index, name);
    const named = `“${name}” (row ${index + 1})`;
    if (typeof item.label !== "string" || item.label.trim().length < 2 || item.label.trim().length > 160 || /[\u0000-\u001f\u007f]/.test(item.label))
      add("PROGRAMME_NAME_REQUIRED", "BLOCKING", `Give row ${index + 1} a programme name between 2 and 160 characters.`, [index]);
    const source = sourceMap.get(item.sourceId);
    if (!item.sourceId) add("PLAYLIST_REQUIRED", "BLOCKING", `Choose a saved music playlist for ${named}.`, [index]);
    else if (!source) add("PLAYLIST_UNAVAILABLE", "BLOCKING", `The saved playlist for ${named} is unavailable. Refresh the library or choose another saved playlist.`, [index]);
    else {
      const count = source.eligibleTrackCount;
      const knownCount = Number.isInteger(count) && count >= 0;
      const unavailable = Array.isArray(source.unavailableGenreCodes) ? source.unavailableGenreCodes.filter(code => typeof code === "string").slice(0, 48) : [];
      let blocked = false;
      if (Array.isArray(source.genreCodes) && !source.genreCodes.length) {
        blocked = true; add("PLAYLIST_GENRES_EMPTY", "BLOCKING", `The playlist for ${named} has no selected genres. Choose another saved playlist or prepare a new genre template.`, [index]);
      }
      if (unavailable.length) {
        blocked = true; add("PLAYLIST_GENRE_UNAVAILABLE", "BLOCKING", `The playlist for ${named} has no currently eligible music for ${unavailable.map(code => clean(code, "a selected genre")).join(", ")}. Choose available genres or ask your administrator to review the catalogue.`, [index]);
      }
      if (knownCount && count === 0) {
        blocked = true; add("NO_ELIGIBLE_MUSIC", "BLOCKING", `No currently eligible songs remain in the playlist for ${named}. Choose another playlist or ask your administrator to review its music access.`, [index]);
      } else if (knownCount && count > 64) {
        blocked = true; add("PLAYLIST_TOO_LARGE", "BLOCKING", `${named} matches ${count} eligible songs, above the 64-song scheduled-recipe limit. Choose a narrower genre template.`, [index]);
      }
      if (source.readyForSchedule === false && !blocked) {
        blocked = true; add("PLAYLIST_NOT_READY", "BLOCKING", `The playlist for ${named} is not ready for scheduling. Refresh its library details, choose another saved playlist or ask your administrator to review its limits.`, [index]);
      }
      if (!knownCount || typeof source.readyForSchedule !== "boolean") add("MUSIC_READINESS_UNKNOWN", "WARNING", `Music readiness for ${named} has not been verified. Refresh the library before administrator review.`, [index]);
      if (!blocked && knownCount && count > 0 && count < 3) add("SMALL_MUSIC_POOL", "WARNING", `${named} has only ${count} eligible ${count === 1 ? "song" : "songs"}. Repetition is likely; choose a broader eligible playlist for more variety. This is an advisory, not a playback failure.`, [index]);
      if (!blocked && knownCount && count > 0 && Number.isFinite(source.eligibleDurationSeconds) && source.eligibleDurationSeconds > 0 &&
        integer(item.durationMinutes, 1, 1440) && source.eligibleDurationSeconds < Number(item.durationMinutes) * 60)
        add("MUSIC_MAY_REPEAT", "WARNING", `${named} has about ${minutesLabel(source.eligibleDurationSeconds)} of unique eligible music for a ${Number(item.durationMinutes)}-minute programme. Songs may repeat; choose more eligible music if you want greater variety. This does not mean there will be silence.`, [index]);
    }
    if (!integer(item.durationMinutes, 1, 1440) || !integer(item.priority ?? 50, 0, 100) ||
      !["WEEKLY", "ONE_OFF"].includes(item.recurrence) || item.sourceType && item.sourceType !== "MUSIC_MODE") {
      add("PROGRAMME_TIMING_INVALID", "BLOCKING", `Check ${named}: use a weekly or one-time music programme, a length of 1–1440 minutes and priority 0–100.`, [index]); continue;
    }
    const normalized = { position: index, label: name, sourceType: "MUSIC_MODE", recurrence: item.recurrence,
      musicModeId: typeof item.sourceId === "string" ? item.sourceId : "", durationMinutes: Number(item.durationMinutes), priority: Number(item.priority ?? 50) };
    if (item.recurrence === "WEEKLY") {
      const startMinute = typeof item.startTime === "string" ? parseLocalTime(item.startTime) : null;
      if (!integer(item.weekday, 0, 6) || startMinute === null) {
        add("PROGRAMME_TIMING_INVALID", "BLOCKING", `Choose a valid weekday and start time for ${named}.`, [index]); continue;
      }
      timingItems.push({ ...normalized, weekday: Number(item.weekday), startMinute });
    } else if (validZone) {
      try { timingItems.push({ ...normalized, startsAt: new Date(schedulerPayloadItem(item, timezone).startsAt) }); }
      catch (error) {
        const repeated = /repeats when clocks change/.test(error.message), gap = /does not exist/.test(error.message);
        add(repeated ? "ONE_OFF_AMBIGUOUS_TIME" : gap ? "ONE_OFF_CLOCK_GAP" : "PROGRAMME_TIMING_INVALID", "BLOCKING",
          repeated ? `${named} falls in a repeated clock-change hour. Choose an unambiguous time; an already saved absolute time is preserved.`
            : gap ? `${named} falls in a local time skipped when clocks change. Choose an existing local time.`
            : `Enter a valid one-time date and start time for ${named}.`, [index]);
      }
    }
  }
  if (!validZone || !Number.isFinite(instant.getTime()) || !timingItems.length || found.BLOCKING.length >= MAX_WARNINGS) return finish();
  try {
    const horizon = compileProgrammeScheduleHorizon({ items: [] }, { timezone, startsAt: instant, days: DAYS });
    const firstDate = schedulerLocalInput(horizon.startsAt, timezone).slice(0, 10), occurrences = [], repeatedTimes = new Map();
    const compiledPatterns = new Map(), localTimes = new Map();
    const localTime = value => {
      const key = value.getTime();
      if (!localTimes.has(key)) localTimes.set(key, schedulerLocalInput(value, timezone));
      return localTimes.get(key);
    };
    for (const item of timingItems) {
      let compiled;
      try {
        const pattern = `${item.recurrence}:${item.weekday}:${item.startMinute}:${item.startsAt?.toISOString()}:${item.durationMinutes}`;
        if (!compiledPatterns.has(pattern)) compiledPatterns.set(pattern,
          compileProgrammeScheduleHorizon({ items: [item] }, { timezone, startsAt: instant, days: DAYS }));
        // Dates can be shared, never a different row's identity or priority.
        compiled = { occurrences: compiledPatterns.get(pattern).occurrences.map(occurrence => ({ ...occurrence,
          position: item.position, label: item.label, sourceId: item.musicModeId, priority: item.priority })) };
      }
      catch (error) {
        if (!/does not exist/.test(error.message) || item.recurrence !== "WEEKLY") throw error;
        // A weekly spring-gap occurrence does not conceal other dates or rows.
        // Compile calendar days separately, using the same canonical converter.
        const foundOccurrences = new Map();
        for (let day = 0; day < DAYS; day += 1) {
          const date = datePlus(firstDate, day);
          try {
            const anchor = localMinuteToUtc(date, 12 * 60, timezone);
            const part = compileProgrammeScheduleHorizon({ items: [item] }, { timezone, startsAt: anchor, days: 1 });
            for (const occurrence of part.occurrences) if (occurrence.endsAt > horizon.startsAt && occurrence.startsAt < horizon.endsAt)
              foundOccurrences.set(`${item.position}:${occurrence.startsAt.toISOString()}`, occurrence);
          } catch (inner) {
            if (!/does not exist/.test(inner.message)) throw inner;
            add("WEEKLY_CLOCK_GAP", "WARNING", `“${item.label}” has a start time skipped by the clock change on ${date} in ${timezone}. That occurrence uses random AutoDJ instead; choose another time if the programme must run.`, [item.position]);
          }
        }
        compiled = { occurrences: [...foundOccurrences.values()] };
      }
      for (const occurrence of compiled.occurrences) {
        occurrences.push(occurrence);
        if (item.recurrence === "WEEKLY") {
          const local = localTime(occurrence.startsAt);
          if (!repeatedTimes.has(local)) {
            try { schedulerOneOffInstant(local, timezone); repeatedTimes.set(local, false); }
            catch (error) {
              if (/repeats when clocks change/.test(error.message)) repeatedTimes.set(local, true);
              else throw error;
            }
          }
          if (repeatedTimes.get(local)) add("WEEKLY_REPEATED_TIME", "WARNING",
              `“${item.label}” uses a repeated clock-change hour within the 31-day review window. Ask your administrator to review the saved occurrence time in ${timezone}; do not assume both repeated hours will play.`, [item.position]);
        }
      }
    }
    occurrences.sort((left, right) => left.startsAt - right.startsAt || left.position - right.position);
    overlapChecks: for (let i = 0; i < occurrences.length; i += 1) for (let j = i + 1; j < occurrences.length && occurrences[j].startsAt < occurrences[i].endsAt; j += 1) {
      const left = occurrences[i], right = occurrences[j];
      const indexes = [left.position, right.position].sort((a, b) => a - b);
      const description = () => {
        const start = right.startsAt, end = new Date(Math.min(left.endsAt.getTime(), right.endsAt.getTime()));
        const time = `${localTime(start).replace("T", " ")}–${localTime(end).replace("T", " ")} ${timezone}`;
        return `“${labels.get(left.position)}” and “${labels.get(right.position)}” overlap at ${time} within the 31-day review window`;
      };
      if (left.priority === right.priority) add("SAME_PRIORITY_OVERLAP", "BLOCKING", () => `${description()} with the same priority. Move a programme or deliberately review their priorities before administrator approval.`, indexes);
      else {
        const winner = left.priority > right.priority ? left : right;
        add("PRIORITY_OVERRIDE", "WARNING", () => `${description()}. Higher-priority “${labels.get(winner.position)}” takes over; move the programmes if that interruption is not intended. Administrator approval is still required.`, indexes);
      }
      // Once the visible blocking budget is filled, scanning the remaining
      // quadratic pairs cannot improve the actionable list. The truncation
      // notice explicitly asks for another review after those rows are fixed.
      if (found.BLOCKING.length >= MAX_WARNINGS) break overlapChecks;
    }
  } catch {
    add("TIMING_REVIEW_INCOMPLETE", "WARNING", "The full 31-day timing check could not be completed. Review the time zone and clock-change dates with your administrator; this is not an all-clear.");
  }
  return finish();
}
