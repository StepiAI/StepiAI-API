import { NotFoundException } from '@nestjs/common';
import {
  DifficultyLevel,
  FocusPreferences,
  ScheduleStatus,
  Weekday,
} from '@prisma/client';
import {
  buildStudyPlanScheduleData,
  StudyPlanService,
} from './studyplan.service';

describe('buildStudyPlanScheduleData', () => {
  it('creates schedule entries for each available weekday in the requested range', () => {
    const schedules = buildStudyPlanScheduleData(
      {
        userId: 'user-1',
        title: 'Math prep',
        goal: 'Prepare for exam',
        startDate: '2026-07-20',
        endDate: '2026-07-22',
        availableDays: [Weekday.MONDAY, Weekday.WEDNESDAY],
        startTime: '09:00',
        endTime: '11:00',
        difficultyLevel: DifficultyLevel.BEGINNER,
        focusPreferences: FocusPreferences.DEEP_FOCUS,
      },
      'user-1',
    );

    expect(schedules).toHaveLength(2);
    expect(schedules[0]).toMatchObject({
      userId: 'user-1',
      summary: 'Math prep',
      description: 'Prepare for exam',
      startDateTime: new Date(Date.UTC(2026, 6, 20, 9, 0)),
      endDateTime: new Date(Date.UTC(2026, 6, 20, 11, 0)),
    });
    expect(schedules[1]).toMatchObject({
      startDateTime: new Date(Date.UTC(2026, 6, 22, 9, 0)),
      endDateTime: new Date(Date.UTC(2026, 6, 22, 11, 0)),
    });
  });
});

describe('StudyPlanService.createFromAi', () => {
  it('creates accepted schedule entries when an AI study plan is accepted', async () => {
    const studyPlan = {
      id: 'study-plan-1',
      userId: 'user-1',
      title: 'Math prep',
    };
    const prisma = {
      schedule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          studyPlan: {
            create: jest.fn().mockResolvedValue(studyPlan),
          },
          schedule: {
            createMany: jest.fn(),
          },
        }),
      ),
    };
    const service = new StudyPlanService(prisma as never);

    const result = await service.createFromAi('user-1', {
      title: 'Math prep',
      goal: 'Prepare for exam',
      topic: ['Algebra'],
      startDate: '2026-07-20',
      endDate: '2026-07-20',
      availableDays: [Weekday.MONDAY],
      startTime: '09:00',
      endTime: '11:00',
      difficultyLevel: DifficultyLevel.BEGINNER,
      focusPreferences: FocusPreferences.DEEP_FOCUS,
    });

    expect(result).toEqual({
      created: true,
      studyPlan,
    });

    const transactionCallback = prisma.$transaction.mock.calls[0][0];
    const tx = {
      studyPlan: {
        create: jest.fn().mockResolvedValue(studyPlan),
      },
      schedule: {
        createMany: jest.fn(),
      },
    };

    await transactionCallback(tx);

    expect(tx.schedule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          status: ScheduleStatus.ACCEPTED,
          startDateTime: new Date(Date.UTC(2026, 6, 20, 9, 0)),
          endDateTime: new Date(Date.UTC(2026, 6, 20, 11, 0)),
        }),
      ],
    });
  });

  it('returns AI-only conflict options instead of creating overlapping schedules', async () => {
    const prisma = {
      schedule: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'schedule-1',
              summary: 'Existing class',
              startDateTime: new Date(Date.UTC(2026, 6, 20, 9, 30)),
              endDateTime: new Date(Date.UTC(2026, 6, 20, 10, 30)),
            },
          ])
          .mockResolvedValueOnce([
            {
              id: 'schedule-1',
              summary: 'Existing class',
              startDateTime: new Date(Date.UTC(2026, 6, 20, 9, 30)),
              endDateTime: new Date(Date.UTC(2026, 6, 20, 10, 30)),
            },
          ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(),
    };
    const service = new StudyPlanService(prisma as never);

    const result = await service.createFromAi('user-1', {
      title: 'Math prep',
      goal: 'Prepare for exam',
      topic: ['Algebra'],
      startDate: '2026-07-20',
      endDate: '2026-07-20',
      availableDays: [Weekday.MONDAY],
      startTime: '09:00',
      endTime: '11:00',
      difficultyLevel: DifficultyLevel.BEGINNER,
      focusPreferences: FocusPreferences.DEEP_FOCUS,
    });

    expect(result.created).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    if (result.created) {
      throw new Error('Expected a conflict result');
    }

    expect(result.conflict.type).toBe('study_plan_conflict');
    expect(result.conflict.conflicts).toHaveLength(1);
    expect(result.conflict.options.map((option) => option.type)).toEqual([
      'skip_day_and_extend',
      'change_time_for_day',
    ]);
    expect(result.conflict.options[0]).toMatchObject({
      updatedEndDate: '2026-07-27',
      skippedDates: ['2026-07-20'],
      replacementDates: ['2026-07-27'],
    });
    expect(result.conflict.options[1]).toMatchObject({
      scheduleOverrides: [
        {
          date: '2026-07-20',
          startTime: '06:00',
          endTime: '08:00',
        },
      ],
    });
  });
});

describe('StudyPlanService.updateFromAi', () => {
  it('replaces linked schedules as accepted when an AI study plan update is accepted', async () => {
    const studyPlan = {
      id: 'study-plan-1',
      userId: 'user-1',
      title: 'Updated math prep',
    };
    const tx = {
      studyPlan: {
        update: jest.fn().mockResolvedValue(studyPlan),
      },
      schedule: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      studyPlan: {
        findFirst: jest.fn().mockResolvedValue(studyPlan),
      },
      schedule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const service = new StudyPlanService(prisma as never);

    const result = await service.updateFromAi('user-1', 'study-plan-1', {
      title: 'Updated math prep',
      goal: 'Prepare for final exam',
      topic: ['Algebra'],
      startDate: '2026-07-20',
      endDate: '2026-07-20',
      availableDays: [Weekday.MONDAY],
      startTime: '10:00',
      endTime: '12:00',
      difficultyLevel: DifficultyLevel.BEGINNER,
      focusPreferences: FocusPreferences.BALANCED,
    });

    expect(result).toEqual({
      updated: true,
      studyPlan,
    });
    expect(tx.studyPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'study-plan-1' },
      }),
    );
    expect(tx.schedule.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        studyPlanId: 'study-plan-1',
      },
    });
    expect(tx.schedule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          studyPlanId: 'study-plan-1',
          status: ScheduleStatus.ACCEPTED,
          startDateTime: new Date(Date.UTC(2026, 6, 20, 10, 0)),
          endDateTime: new Date(Date.UTC(2026, 6, 20, 12, 0)),
        }),
      ],
    });
  });
});

describe('StudyPlanService.deleteFromAi', () => {
  it('deletes an owned study plan', async () => {
    const studyPlan = {
      id: 'study-plan-1',
      userId: 'user-1',
      title: 'Math prep',
    };
    const prisma = {
      studyPlan: {
        findFirst: jest.fn().mockResolvedValue(studyPlan),
        delete: jest.fn().mockResolvedValue(studyPlan),
      },
    };
    const service = new StudyPlanService(prisma as never);

    await expect(
      service.deleteFromAi('user-1', 'study-plan-1'),
    ).resolves.toEqual(studyPlan);
    expect(prisma.studyPlan.delete).toHaveBeenCalledWith({
      where: { id: 'study-plan-1' },
    });
  });
});

describe('StudyPlanService.findOneByUser', () => {
  it('returns an owned study plan with its schedules', async () => {
    const studyPlan = {
      id: 'study-plan-1',
      userId: 'user-1',
      title: 'Math prep',
      schedules: [{ id: 'schedule-1' }],
    };
    const prisma = {
      studyPlan: {
        findFirst: jest.fn().mockResolvedValue(studyPlan),
      },
    };
    const service = new StudyPlanService(prisma as never);

    await expect(
      service.findOneByUser('user-1', 'study-plan-1'),
    ).resolves.toEqual(studyPlan);
    expect(prisma.studyPlan.findFirst).toHaveBeenCalledWith({
      where: { id: 'study-plan-1', userId: 'user-1' },
      include: { schedules: { orderBy: { startDateTime: 'asc' } } },
    });
  });

  it('throws NotFoundException when the study plan does not belong to the user', async () => {
    const prisma = {
      studyPlan: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new StudyPlanService(prisma as never);

    await expect(
      service.findOneByUser('user-1', 'missing'),
    ).rejects.toThrow(NotFoundException);
  });
});
