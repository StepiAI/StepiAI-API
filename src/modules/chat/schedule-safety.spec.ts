import {
  assessScheduleCapacity,
  explicitlyAllowsStressfulLoad,
  isProceedAnywayReply,
  parseConflictDecision,
} from './schedule-safety';

describe('parseConflictDecision', () => {
  it('mendeteksi pilihan ubah jam dan skip tanggal', () => {
    expect(parseConflictDecision('ubah jam yang bentrok aja')).toBe(
      'change_time_for_day',
    );
    expect(parseConflictDecision('skip semua tanggal yang bentrok')).toBe(
      'skip_day_and_extend',
    );
  });

  it('mendeteksi saat user menyerahkan keputusan ke StepiAI', () => {
    expect(parseConflictDecision('bebas deh, pilihkan yang aman')).toBe(
      'ai_decides',
    );
  });

  it('override bentrok harus eksplisit', () => {
    expect(parseConflictDecision('iya lanjut')).toBeNull();
    expect(parseConflictDecision('gapapa bentrok, tetap bikin')).toBe(
      'allow_collision',
    );
  });
});

describe('explicitlyAllowsStressfulLoad', () => {
  it('membedakan konfirmasi biasa dari override beban', () => {
    expect(explicitlyAllowsStressfulLoad('iya lanjut')).toBe(false);
    expect(explicitlyAllowsStressfulLoad('gapapa padat, aku sanggup')).toBe(
      true,
    );
  });
});

describe('isProceedAnywayReply', () => {
  it('menerima override singkat yang jelas dan menolak iya yang ambigu', () => {
    expect(isProceedAnywayReply('gapapa, lanjut')).toBe(true);
    expect(isProceedAnywayReply('oke lanjut aja')).toBe(true);
    expect(isProceedAnywayReply('iya')).toBe(false);
  });
});

describe('assessScheduleCapacity', () => {
  const range = (start: string, end: string) => ({
    startDateTime: new Date(start),
    endDateTime: new Date(end),
  });

  it('memberi warning saat total jadwal pada hari proposal lebih dari 8 jam', () => {
    const result = assessScheduleCapacity(
      [range('2026-07-22T08:00:00Z', '2026-07-22T16:00:00Z')],
      [range('2026-07-22T17:00:00Z', '2026-07-22T18:00:00Z')],
      'UTC',
    );

    expect(result.isPotentiallyStressful).toBe(true);
    expect(result.reasons).toContain('total jadwal lebih dari 8 jam sehari');
  });

  it('mengabaikan hari sibuk yang tidak berkaitan dengan tanggal proposal', () => {
    const result = assessScheduleCapacity(
      [range('2026-07-21T08:00:00Z', '2026-07-21T20:00:00Z')],
      [range('2026-07-22T17:00:00Z', '2026-07-22T18:00:00Z')],
      'UTC',
    );

    expect(result.isPotentiallyStressful).toBe(false);
  });

  it('memberi warning untuk satu sesi lebih dari 3 jam', () => {
    const result = assessScheduleCapacity(
      [],
      [range('2026-07-22T08:00:00Z', '2026-07-22T12:00:00Z')],
      'UTC',
    );

    expect(result.isPotentiallyStressful).toBe(true);
    expect(result.reasons).toContain('satu sesi lebih dari 3 jam');
  });
});
