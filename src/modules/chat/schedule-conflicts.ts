export interface CalendarBusyEvent {
  id?: string;
  title: string;
  start: Date;
  end: Date;
  source?: 'google' | 'local';
}

export interface ScheduleConflict {
  id?: string;
  title: string;
  startDateTime: string;
  endDateTime: string;
  overlapMinutes: number;
  source?: 'google' | 'local';
}

export interface NeighboringSchedule {
  id?: string;
  title: string;
  startDateTime: string;
  endDateTime: string;
  gapMinutes: number;
  source?: 'google' | 'local';
}

export interface ScheduleConflictAnalysis {
  hasConflict: boolean;
  hasTightBuffer: boolean;
  conflicts: ScheduleConflict[];
  nearestBefore?: NeighboringSchedule;
  nearestAfter?: NeighboringSchedule;
  recommendedStartDateTime?: string;
  recommendedEndDateTime?: string;
}

export interface AnalyzeScheduleConflictsOptions {
  minimumBufferMinutes?: number;
  recommendationStepMinutes?: number;
  tightBufferStepMinutes?: number;
  outputOffset?: string;
}

const DEFAULT_MINIMUM_BUFFER_MINUTES = 30;
const DEFAULT_RECOMMENDATION_STEP_MINUTES = 30;
const DEFAULT_TIGHT_BUFFER_STEP_MINUTES = 60;

export function analyzeScheduleConflicts(
  proposedStart: Date,
  proposedEnd: Date,
  events: CalendarBusyEvent[],
  options: AnalyzeScheduleConflictsOptions = {},
): ScheduleConflictAnalysis {
  const minimumBufferMinutes =
    options.minimumBufferMinutes ?? DEFAULT_MINIMUM_BUFFER_MINUTES;
  const recommendationStepMinutes =
    options.recommendationStepMinutes ?? DEFAULT_RECOMMENDATION_STEP_MINUTES;
  const tightBufferStepMinutes =
    options.tightBufferStepMinutes ?? DEFAULT_TIGHT_BUFFER_STEP_MINUTES;
  const outputOffset = options.outputOffset ?? '+00:00';

  const sortedEvents = events
    .filter((event) => event.end.getTime() > event.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const durationMs = proposedEnd.getTime() - proposedStart.getTime();

  const conflicts = sortedEvents
    .filter((event) =>
      overlaps(proposedStart, proposedEnd, event.start, event.end),
    )
    .map((event) => ({
      id: event.id,
      title: event.title,
      startDateTime: isoWithOffset(event.start, outputOffset),
      endDateTime: isoWithOffset(event.end, outputOffset),
      overlapMinutes: minutesBetween(
        maxDate(proposedStart, event.start),
        minDate(proposedEnd, event.end),
      ),
      source: event.source,
    }));

  const nearestBefore = findNearestBefore(
    proposedStart,
    sortedEvents,
    outputOffset,
  );
  const nearestAfter = findNearestAfter(
    proposedEnd,
    sortedEvents,
    outputOffset,
  );
  const hasTightBuffer =
    conflicts.length === 0 &&
    ((nearestBefore?.gapMinutes ?? Number.POSITIVE_INFINITY) <
      minimumBufferMinutes ||
      (nearestAfter?.gapMinutes ?? Number.POSITIVE_INFINITY) <
        minimumBufferMinutes);

  let recommendationCursor: Date | undefined;
  let stepMinutes = recommendationStepMinutes;

  if (conflicts.length > 0) {
    recommendationCursor = maxDate(
      proposedStart,
      ...conflicts.map((conflict) => new Date(conflict.endDateTime)),
    );
  } else if (hasTightBuffer && nearestBefore) {
    recommendationCursor = new Date(
      new Date(nearestBefore.endDateTime).getTime() +
        minimumBufferMinutes * 60_000,
    );
    stepMinutes = tightBufferStepMinutes;
  } else if (hasTightBuffer && nearestAfter) {
    recommendationCursor = new Date(
      new Date(nearestAfter.endDateTime).getTime(),
    );
  }

  const recommendedStart =
    recommendationCursor &&
    findAvailableSlotAtOrAfter(
      recommendationCursor,
      durationMs,
      sortedEvents,
      stepMinutes,
      minimumBufferMinutes,
    );

  return {
    hasConflict: conflicts.length > 0,
    hasTightBuffer,
    conflicts,
    nearestBefore,
    nearestAfter,
    recommendedStartDateTime: recommendedStart
      ? isoWithOffset(recommendedStart, outputOffset)
      : undefined,
    recommendedEndDateTime: recommendedStart
      ? isoWithOffset(
          new Date(recommendedStart.getTime() + durationMs),
          outputOffset,
        )
      : undefined,
  };
}

export function extractIsoOffset(isoDateTime: string): string {
  const match = isoDateTime.match(/(Z|[+-]\d{2}:\d{2})$/);

  if (!match) {
    return '+00:00';
  }

  return match[1] === 'Z' ? '+00:00' : match[1];
}

export function getOffsetDayBounds(isoDateTime: string) {
  const date = isoDateTime.slice(0, 10);
  const offset = extractIsoOffset(isoDateTime);
  const nextDate = addDaysToDateOnly(date, 1);

  return {
    timeMin: `${date}T00:00:00${offset}`,
    timeMax: `${nextDate}T00:00:00${offset}`,
    offset,
  };
}

export function isoWithOffset(date: Date, offset: string): string {
  const offsetMinutes = parseOffsetMinutes(offset);
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);

  return `${shifted.getUTCFullYear()}-${pad2(
    shifted.getUTCMonth() + 1,
  )}-${pad2(shifted.getUTCDate())}T${pad2(shifted.getUTCHours())}:${pad2(
    shifted.getUTCMinutes(),
  )}:${pad2(shifted.getUTCSeconds())}${offset}`;
}

function findNearestBefore(
  proposedStart: Date,
  events: CalendarBusyEvent[],
  outputOffset: string,
): NeighboringSchedule | undefined {
  const candidate = [...events]
    .reverse()
    .find((event) => event.end.getTime() <= proposedStart.getTime());

  if (!candidate) return undefined;

  return {
    id: candidate.id,
    title: candidate.title,
    startDateTime: isoWithOffset(candidate.start, outputOffset),
    endDateTime: isoWithOffset(candidate.end, outputOffset),
    gapMinutes: minutesBetween(candidate.end, proposedStart),
    source: candidate.source,
  };
}

function findNearestAfter(
  proposedEnd: Date,
  events: CalendarBusyEvent[],
  outputOffset: string,
): NeighboringSchedule | undefined {
  const candidate = events.find(
    (event) => event.start.getTime() >= proposedEnd.getTime(),
  );

  if (!candidate) return undefined;

  return {
    id: candidate.id,
    title: candidate.title,
    startDateTime: isoWithOffset(candidate.start, outputOffset),
    endDateTime: isoWithOffset(candidate.end, outputOffset),
    gapMinutes: minutesBetween(proposedEnd, candidate.start),
    source: candidate.source,
  };
}

function findAvailableSlotAtOrAfter(
  cursor: Date,
  durationMs: number,
  events: CalendarBusyEvent[],
  stepMinutes: number,
  minimumBufferMinutes: number,
) {
  const bufferMs = minimumBufferMinutes * 60_000;
  let candidate = roundUpDate(cursor, stepMinutes);

  for (const event of events) {
    const blockedStart = event.start.getTime() - bufferMs;
    const blockedEnd = event.end.getTime() + bufferMs;
    const candidateStart = candidate.getTime();
    const candidateEnd = candidateStart + durationMs;

    if (blockedEnd <= candidateStart) {
      continue;
    }

    if (candidateEnd <= blockedStart) {
      return candidate;
    }

    candidate = roundUpDate(new Date(blockedEnd), stepMinutes);
  }

  return candidate;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

function minutesBetween(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

function maxDate(first: Date, ...dates: Date[]) {
  return dates.reduce(
    (max, date) => (date.getTime() > max.getTime() ? date : max),
    first,
  );
}

function minDate(first: Date, ...dates: Date[]) {
  return dates.reduce(
    (min, date) => (date.getTime() < min.getTime() ? date : min),
    first,
  );
}

function roundUpDate(date: Date, stepMinutes: number) {
  const stepMs = stepMinutes * 60_000;
  return new Date(Math.ceil(date.getTime() / stepMs) * stepMs);
}

function addDaysToDateOnly(date: string, days: number) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);

  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(
    next.getUTCDate(),
  )}`;
}

function parseOffsetMinutes(offset: string) {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);

  if (!match) {
    return 0;
  }

  const [, sign, hours, minutes] = match;
  const value = Number(hours) * 60 + Number(minutes);

  return sign === '-' ? -value : value;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}
