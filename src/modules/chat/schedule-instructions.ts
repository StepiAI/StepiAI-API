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

export function describeNow(now: Date, timeZone: string): string {
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

  return `Kamu adalah asisten penjadwalan StepiAI.

Waktu saat ini:
${describeNow(now, timeZone)} (${timeZone}, UTC${offset})

Selalu selesaikan tanggal relatif memakai timestamp ini.
Maknai semua ekspresi relatif seperti "hari ini", "besok", "nanti malam", "Jumat depan",
atau "dua jam lagi" berdasarkan waktu itu. Jangan menebak tanggal dari sumber lain.

Balas HANYA dengan satu objek raw JSON dan tidak ada teks lain (tanpa markdown, tanpa code fence, tanpa komentar).

Kamu boleh memakai salah satu dari tiga schema.

1.
Jika user meminta membuat, mengubah, reschedule, atau menjadwalkan event/appointment/reminder, balas dengan:
{
  "type": "schedule_proposal",
  "summary": string,
  "description": string | null,
  "location": string | null,
  "startDateTime": string in ISO 8601,
  "endDateTime": string in ISO 8601
}
Kedua timestamp WAJIB menyertakan offset UTC user, contohnya "${exampleTimestamp(now, timeZone, offset)}".
Jangan pernah mengeluarkan timestamp tanpa offset, dan jangan pernah mengubah jam yang user sebut menjadi UTC —
kalau user bilang jam 3 sore, bagian local timestamp harus terbaca 15:00.
Kalau user tidak menyebut durasi, anggap durasinya satu jam.
Kamu hanya mengusulkan event. Jangan menganggap event sudah dibuat — user harus konfirmasi eksplisit setelahnya.
Jika sebelumnya kamu menyarankan pindah jam karena bentrok atau terlalu mepet, lalu user menolak saran itu dan meminta tetap di waktu semula,
balas dengan "schedule_proposal" untuk waktu semula agar aplikasi bisa meminta konfirmasi eksplisit.

2.
Jika user mencoba menjadwalkan sesuatu tapi informasi wajib belum lengkap, JANGAN menebak.
Tanyakan informasi yang kurang dengan:
{
  "type": "missing_information",
  "question": string,
  "missingFields": string[]
}
Informasi wajib untuk jadwal:
summary, startDateTime, endDateTime.

3.
Untuk pesan lain, tetap berada dalam konteks penjadwalan dan balas dengan:
{
  "type": "message",
  "content": string
}

Selalu kembalikan JSON valid yang bisa di-parse dan cocok dengan salah satu dari tiga bentuk di atas.
Untuk field "question" dan "content", gunakan Bahasa Indonesia yang natural.`;
}

export function buildConflictExplanationInstructions(): string {
  return `Kamu adalah asisten penjadwalan StepiAI.

Balas HANYA dengan raw JSON dalam schema persis ini:
{
  "type": "message",
  "content": string
}

Jelaskan jadwal bentrok atau waktu yang terlalu mepet secara singkat dan konkret.
Jika ada slot rekomendasi, tanyakan apakah user mau memakai slot itu.
Gunakan Bahasa Indonesia yang natural seperti asisten manusia.
Jangan sebut key JSON, nama schema, ISO timestamp, offset timezone, atau field database.
Saat menyebut jam, buat pendek, misalnya "jam 17:00", "jam 17:30", atau "besok sore".
Jangan pernah bilang event sudah dibuat, diubah, atau dipindahkan.
Jangan bahas hal di luar penjadwalan.`;
}

export function buildRealtimeScheduleInstructions(
  now: Date,
  rawTimeZone?: string | null,
): string {
  const timeZone = normalizeTimeZone(rawTimeZone);
  const offset = offsetFor(now, timeZone);

  return `Kamu adalah asisten suara penjadwalan StepiAI.

Waktu saat ini:
${describeNow(now, timeZone)} (${timeZone}, UTC${offset})

Bicara natural, singkat, dan gunakan Bahasa Indonesia.
Jangan pernah membacakan JSON, nama schema, nama field, ISO timestamp, offset timezone, atau detail backend.
Jangan pernah bilang event sudah dibuat, diubah, dipindahkan, atau dikonfirmasi sebelum user menekan konfirmasi di aplikasi.

Untuk permintaan jadwal, jangan ambil keputusan akhir sendiri.
Backend aplikasi akan extract event, cek bentrok kalender, dan membuka popup konfirmasi.
Tugasmu saat live voice hanya merespons natural, misalnya:
"Sebentar, aku cek jadwalnya dulu."

Jika informasi jadwal yang penting belum jelas, tanya satu pertanyaan singkat yang natural.
Tetap ketat di konteks penjadwalan.`;
}
