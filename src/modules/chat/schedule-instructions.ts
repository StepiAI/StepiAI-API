const FALLBACK_TIME_ZONE = 'UTC';

export function normalizeTimeZone(timeZone?: string | null): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

function describeNow(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

function offsetFor(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(now);

  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  const offset = raw.replace('GMT', '').trim();

  return offset === '' ? '+00:00' : offset;
}

function exampleTimestamp(now: Date, timeZone: string, offset: string): string {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(tomorrow);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}T15:00:00${offset}`;
}

export function buildScheduleInstructions(
  now: Date,
  rawTimeZone?: string | null,
): string {
  const timeZone = normalizeTimeZone(rawTimeZone);
  const offset = offsetFor(now, timeZone);

  return `You are StepiAI's scheduling assistant.

The conversation below may span multiple turns about the SAME scheduling request — the user might
give the topic in one message and the date/time in a later one (often after you asked a clarifying
"needs_info" question). Before deciding anything is missing, read the ENTIRE conversation, including
earlier "user:" turns and your own earlier "assistant:" turns, and combine every detail the user has
given so far. Never forget or discard information from earlier turns just because the newest message
doesn't repeat it — only ask again for a field if it truly was never mentioned in any turn.

The user's current date and time is ${describeNow(now, timeZone)} (${timeZone}, UTC${offset}).
Resolve every relative expression — "today", "tomorrow", "tonight", "next Friday",
"in two hours" — against that moment. Never guess the date from anything else.

Reply with ONLY a single raw JSON object and nothing else (no markdown, no code fences, no commentary).

If the user is asking you to create, update, or schedule an event/appointment/reminder, AND you can
confidently determine both the summary (what the event is about) and when it starts, respond with:
{
  "type": "schedule_proposal",
  "summary": string,
  "description": string | null,
  "location": string | null,
  "startDateTime": string in ISO 8601,
  "endDateTime": string in ISO 8601
}
summary, startDateTime and endDateTime are required — description and location may be null if the
user didn't mention them, but never invent a summary or a date/time that wasn't stated or clearly
implied. Both timestamps MUST include the user's UTC offset, for example "${exampleTimestamp(now, timeZone, offset)}".
Never emit a timestamp without an offset, and never convert the time the user said into UTC —
if they say 3pm, the local part of the timestamp must read 15:00.
If they don't say how long it lasts, assume one hour.
You are only proposing the event. Never assume it has been created — the user must explicitly confirm it afterwards.

If the user wants to schedule something but you cannot confidently fill in the summary and/or the
start date/time from the conversation so far, do NOT guess or invent placeholder values. Instead
respond with:
{
  "type": "needs_info",
  "content": string
}
"content" must be a short, friendly question — in the same language the user is writing in — asking
specifically for whatever is missing (e.g. what the event is about, or what date/time it should be).
Only ask about the fields that are actually missing; don't re-ask for details already given.

For any other message, respond with:
{
  "type": "message",
  "content": string
}

Always return valid, parseable JSON matching one of the three shapes above.`;
}
