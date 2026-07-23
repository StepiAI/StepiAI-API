export type ConflictDecision =
  | 'change_time_for_day'
  | 'skip_day_and_extend'
  | 'allow_collision'
  | 'ai_decides';

export interface TimeRange {
  startDateTime: Date;
  endDateTime: Date;
}

export interface CapacityAssessment {
  isPotentiallyStressful: boolean;
  busiestDate: string | null;
  busiestMinutes: number;
  reasons: string[];
}

const OKAY =
  '(?:gak\\s*apa(?:-?apa)?|nggak\\s*apa(?:-?apa)?|gapapa|tidak\\s+apa(?:-?apa)?|oke|ok|boleh)';
const COLLISION = '(?:bentrok|tabrakan|bertabrakan|collision|conflict)';
const LOAD = '(?:padat|berat|capek|stres|stress|overload(?:ed)?|penuh)';

export function parseConflictDecision(
  content: string,
): ConflictDecision | null {
  const text = content.toLowerCase();

  if (
    new RegExp(`(?:${OKAY}).{0,40}${COLLISION}`).test(text) ||
    new RegExp(`${COLLISION}.{0,40}(?:${OKAY})`).test(text) ||
    /\b(?:tetap|lanjut|langsung)\s+(?:buat|bikin|jadwalkan)\b.*\b(?:walau|meski(?:pun)?)\b.*\b(?:bentrok|tabrakan)\b/.test(
      text,
    )
  ) {
    return 'allow_collision';
  }

  if (
    /\b(?:ganti|ubah|pindah|cari|carikan)\s+(?:jam|waktu)\b/.test(text) ||
    /\b(?:jam|waktu)\s+(?:lain|kosong|baru)\b/.test(text) ||
    /\b(?:jangan|ga|gak|nggak|tidak)\s+(?:usah\s+)?(?:di)?perpanjang\b/.test(
      text,
    )
  ) {
    return 'change_time_for_day';
  }

  if (
    /\b(?:skip|lewati|lewatkan)\b.*\b(?:tanggal|hari|bentrok|tabrakan)\b/.test(
      text,
    ) ||
    /\b(?:tanggal|hari|bentrok|tabrakan)\b.*\b(?:skip|lewati|lewatkan)\b/.test(
      text,
    ) ||
    /\b(?:di)?perpanjang\b/.test(text)
  ) {
    return 'skip_day_and_extend';
  }

  if (
    /\b(?:bebas|terserah)\b/.test(text) ||
    /\b(?:pilih|pilihin|pilihkan|carikan)\b.*\b(?:jam|waktu)\b/.test(text) ||
    /\b(?:pilih|pilihin|pilihkan|carikan)\b.*\b(?:terbaik|aman|ringan)\b/.test(
      text,
    ) ||
    /\b(?:yang\s+)?(?:terbaik|paling\s+aman|paling\s+ringan)\b/.test(text) ||
    /\bthe\s+best\b/.test(text)
  ) {
    return 'ai_decides';
  }

  return null;
}

export function explicitlyAllowsStressfulLoad(content: string): boolean {
  const text = content.toLowerCase();

  return (
    new RegExp(`(?:${OKAY}).{0,40}${LOAD}`).test(text) ||
    new RegExp(`${LOAD}.{0,40}(?:${OKAY})`).test(text) ||
    /\b(?:tetap|lanjut)\b.*\b(?:walau|meski(?:pun)?)\b.*\b(?:padat|berat|capek|stres|stress)\b/.test(
      text,
    )
  );
}

export function isProceedAnywayReply(content: string): boolean {
  const text = content.toLowerCase().trim();

  return (
    /^(?:gapapa|gak\s*apa(?:-?apa)?|nggak\s*apa(?:-?apa)?|tidak\s+apa(?:-?apa)?)[,!.\s]*(?:lanjut|buat|bikin|jalan)?/.test(
      text,
    ) ||
    /^(?:oke|ok)[,!.\s]+(?:lanjut|tetap|buat|bikin|jalan)/.test(text) ||
    /^(?:tetap|lanjut)\s+(?:aja|saja|buat|bikin|jalan)/.test(text) ||
    /^lanjutkan\b/.test(text)
  );
}

export function isAffirmativeReply(content: string): boolean {
  const text = content.toLowerCase();

  if (/\b(?:tidak|bukan|nggak|gak|ga|no|nope)\b/.test(text)) {
    return false;
  }

  return /\b(?:ya|iya|yup|yes|benar|betul|correct|right|oke|ok|setuju)\b/.test(
    text,
  );
}

function dateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function durationMinutes(range: TimeRange): number {
  return Math.max(
    0,
    (range.endDateTime.getTime() - range.startDateTime.getTime()) / 60_000,
  );
}

/**
 * A conservative signal, not a diagnosis. The assistant asks the user before
 * continuing when a proposed item is unusually long or pushes a day beyond a
 * reasonable amount of scheduled time.
 */
export function assessScheduleCapacity(
  existing: TimeRange[],
  proposed: TimeRange[],
  timeZone: string,
): CapacityAssessment {
  const minutesByDate = new Map<string, number>();
  const proposedMinutesByDate = new Map<string, number>();

  for (const range of proposed) {
    const key = dateKey(range.startDateTime, timeZone);
    const minutes = durationMinutes(range);
    proposedMinutesByDate.set(
      key,
      (proposedMinutesByDate.get(key) ?? 0) + minutes,
    );
  }

  for (const range of existing) {
    const key = dateKey(range.startDateTime, timeZone);

    if (!proposedMinutesByDate.has(key)) continue;

    minutesByDate.set(
      key,
      (minutesByDate.get(key) ?? 0) + durationMinutes(range),
    );
  }

  for (const range of proposed) {
    const key = dateKey(range.startDateTime, timeZone);
    const minutes = durationMinutes(range);
    minutesByDate.set(key, (minutesByDate.get(key) ?? 0) + minutes);
  }

  let busiestDate: string | null = null;
  let busiestMinutes = 0;

  for (const [key, minutes] of minutesByDate) {
    if (minutes > busiestMinutes) {
      busiestDate = key;
      busiestMinutes = minutes;
    }
  }

  const reasons: string[] = [];
  const hasVeryLongSession = proposed.some(
    (range) => durationMinutes(range) > 3 * 60,
  );
  const hasHeavyProposedDay = [...proposedMinutesByDate.values()].some(
    (minutes) => minutes > 4 * 60,
  );
  const hasOverbookedDay = [...minutesByDate.values()].some(
    (minutes) => minutes > 8 * 60,
  );

  if (hasVeryLongSession) reasons.push('satu sesi lebih dari 3 jam');
  if (hasHeavyProposedDay)
    reasons.push('tambahan aktivitas lebih dari 4 jam sehari');
  if (hasOverbookedDay) reasons.push('total jadwal lebih dari 8 jam sehari');

  return {
    isPotentiallyStressful: reasons.length > 0,
    busiestDate,
    busiestMinutes,
    reasons,
  };
}
