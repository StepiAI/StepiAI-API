import {
  analyzeScheduleConflicts,
  getOffsetDayBounds,
  isoWithOffset,
} from './schedule-conflicts';

describe('analyzeScheduleConflicts', () => {
  it('detects direct overlaps and recommends the next available slot', () => {
    const analysis = analyzeScheduleConflicts(
      new Date('2026-07-20T10:00:00+07:00'),
      new Date('2026-07-20T11:00:00+07:00'),
      [
        {
          title: 'Team Meeting',
          start: new Date('2026-07-20T09:30:00+07:00'),
          end: new Date('2026-07-20T10:30:00+07:00'),
        },
      ],
      { outputOffset: '+07:00' },
    );

    expect(analysis.hasConflict).toBe(true);
    expect(analysis.conflicts).toHaveLength(1);
    expect(analysis.conflicts[0].overlapMinutes).toBe(30);
    expect(analysis.recommendedStartDateTime).toBe('2026-07-20T11:00:00+07:00');
    expect(analysis.recommendedEndDateTime).toBe('2026-07-20T12:00:00+07:00');
  });

  it('flags a tight buffer before the proposed event and suggests a cleaner hour', () => {
    const analysis = analyzeScheduleConflicts(
      new Date('2026-07-20T13:00:00+07:00'),
      new Date('2026-07-20T15:00:00+07:00'),
      [
        {
          title: 'Padel',
          start: new Date('2026-07-20T11:00:00+07:00'),
          end: new Date('2026-07-20T12:40:00+07:00'),
        },
      ],
      { outputOffset: '+07:00' },
    );

    expect(analysis.hasConflict).toBe(false);
    expect(analysis.hasTightBuffer).toBe(true);
    expect(analysis.nearestBefore?.gapMinutes).toBe(20);
    expect(analysis.recommendedStartDateTime).toBe('2026-07-20T14:00:00+07:00');
    expect(analysis.recommendedEndDateTime).toBe('2026-07-20T16:00:00+07:00');
  });

  it('keeps scanning until the recommended slot has buffer around every event', () => {
    const analysis = analyzeScheduleConflicts(
      new Date('2026-07-20T18:00:00+07:00'),
      new Date('2026-07-20T20:00:00+07:00'),
      [
        {
          title: 'Meeting Strategi Ekspor Impor',
          start: new Date('2026-07-20T16:00:00+07:00'),
          end: new Date('2026-07-20T18:00:00+07:00'),
        },
        {
          title: 'Gym',
          start: new Date('2026-07-20T20:00:00+07:00'),
          end: new Date('2026-07-20T21:00:00+07:00'),
        },
        {
          title: 'Meeting Mengajar Coding',
          start: new Date('2026-07-20T21:30:00+07:00'),
          end: new Date('2026-07-20T22:30:00+07:00'),
        },
      ],
      { outputOffset: '+07:00' },
    );

    expect(analysis.hasConflict).toBe(false);
    expect(analysis.hasTightBuffer).toBe(true);
    expect(analysis.recommendedStartDateTime).toBe('2026-07-20T23:00:00+07:00');
    expect(analysis.recommendedEndDateTime).toBe('2026-07-21T01:00:00+07:00');
  });

  it('does not flag proposals with enough buffer', () => {
    const analysis = analyzeScheduleConflicts(
      new Date('2026-07-20T13:30:00+07:00'),
      new Date('2026-07-20T15:30:00+07:00'),
      [
        {
          title: 'Padel',
          start: new Date('2026-07-20T11:00:00+07:00'),
          end: new Date('2026-07-20T12:40:00+07:00'),
        },
      ],
      { outputOffset: '+07:00' },
    );

    expect(analysis.hasConflict).toBe(false);
    expect(analysis.hasTightBuffer).toBe(false);
    expect(analysis.recommendedStartDateTime).toBeUndefined();
  });
});

describe('date helpers', () => {
  it('builds target-day bounds from the proposal offset', () => {
    expect(getOffsetDayBounds('2026-07-20T17:00:00+07:00')).toEqual({
      timeMin: '2026-07-20T00:00:00+07:00',
      timeMax: '2026-07-21T00:00:00+07:00',
      offset: '+07:00',
    });
  });

  it('serializes dates using the requested offset', () => {
    expect(isoWithOffset(new Date('2026-07-20T10:00:00+07:00'), '+07:00')).toBe(
      '2026-07-20T10:00:00+07:00',
    );
  });
});
