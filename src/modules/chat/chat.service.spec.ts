import {
  isAffirmativeReply,
  isProposalResponse,
  parseStudyPlanConflictResolution,
} from './chat.service';

describe('parseStudyPlanConflictResolution', () => {
  it('maps skip and extend wording to skip_day_and_extend', () => {
    expect(
      parseStudyPlanConflictResolution(
        'iya skip semua yang bertabrakan jadi durasinya diperpanjang',
      ),
    ).toEqual({
      type: 'study_plan_conflict_resolution',
      choice: 'skip_day_and_extend',
    });
  });

  it('maps best/not overloaded wording to skip_day_and_extend', () => {
    expect(
      parseStudyPlanConflictResolution(
        'buatin yang the best for me lah biar gak overloaded',
      ),
    ).toEqual({
      type: 'study_plan_conflict_resolution',
      choice: 'skip_day_and_extend',
    });
  });

  it('maps change-time wording to change_time_for_day', () => {
    expect(parseStudyPlanConflictResolution('ganti jam aja')).toEqual({
      type: 'study_plan_conflict_resolution',
      choice: 'change_time_for_day',
    });
  });
});

describe('isAffirmativeReply', () => {
  it('detects Indonesian confirmation replies', () => {
    expect(isAffirmativeReply('Benar seperti itu')).toBe(true);
    expect(isAffirmativeReply('Ya benar')).toBe(true);
  });

  it('does not treat negated replies as confirmation', () => {
    expect(isAffirmativeReply('nggak benar')).toBe(false);
  });
});

describe('isProposalResponse', () => {
  it('marks all proposal response types as proposals', () => {
    expect(isProposalResponse({ type: 'schedule_proposal' } as never)).toBe(
      true,
    );
    expect(
      isProposalResponse({ type: 'schedule_update_proposal' } as never),
    ).toBe(true);
    expect(
      isProposalResponse({ type: 'schedule_delete_proposal' } as never),
    ).toBe(true);
    expect(isProposalResponse({ type: 'study_plan_proposal' } as never)).toBe(
      true,
    );
    expect(
      isProposalResponse({ type: 'study_plan_update_proposal' } as never),
    ).toBe(true);
    expect(
      isProposalResponse({ type: 'study_plan_delete_proposal' } as never),
    ).toBe(true);
  });

  it('does not mark non-proposal response types as proposals', () => {
    expect(isProposalResponse({ type: 'needs_info' } as never)).toBe(false);
    expect(isProposalResponse({ type: 'message' } as never)).toBe(false);
    expect(
      isProposalResponse({ type: 'study_plan_conflict' } as never),
    ).toBe(false);
  });
});
