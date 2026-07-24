import { NotFoundException } from '@nestjs/common';
import {
  DifficultyLevel,
  FocusPreferences,
  ScheduleStatus,
  Weekday,
} from '@prisma/client';
import { buildLifePlanScheduleData, LifePlanService } from './lifeplan.service';

describe('buildLifePlanScheduleData', () => {
  it('creates schedule entries for each available weekday in the requested range', () => {
    const schedules = buildLifePlanScheduleData(
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
      startDateTime: new Date(Date.UTC(2026, 6, 20, 2, 0)),
      endDateTime: new Date(Date.UTC(2026, 6, 20, 4, 0)),
    });
    expect(schedules[1]).toMatchObject({
      startDateTime: new Date(Date.UTC(2026, 6, 22, 2, 0)),
      endDateTime: new Date(Date.UTC(2026, 6, 22, 4, 0)),
    });
  });
});

describe('LifePlanService.createFromAi', () => {
  it('creates accepted schedule entries when an AI life plan is accepted', async () => {
    const lifePlan = {
      id: 'life-plan-1',
      userId: 'user-1',
      title: 'Math prep',
    };
    const prisma = {
      schedule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          lifePlan: {
            create: jest.fn().mockResolvedValue(lifePlan),
          },
          schedule: {
            createMany: jest.fn(),
          },
        }),
      ),
    };
    const service = new LifePlanService(prisma as never);

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
      lifePlan,
    });

    const transactionCallback = prisma.$transaction.mock.calls[0][0];
    const tx = {
      lifePlan: {
        create: jest.fn().mockResolvedValue(lifePlan),
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
          startDateTime: new Date(Date.UTC(2026, 6, 20, 2, 0)),
          endDateTime: new Date(Date.UTC(2026, 6, 20, 4, 0)),
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
    const service = new LifePlanService(prisma as never);

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

    expect(result.conflict.type).toBe('life_plan_conflict');
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

  it('creates the plan when the user explicitly allows collisions', async () => {
    const lifePlan = {
      id: 'life-plan-1',
      userId: 'user-1',
      title: 'Math prep',
    };
    const existingSchedule = {
      id: 'schedule-1',
      summary: 'Existing class',
      startDateTime: new Date(Date.UTC(2026, 6, 20, 9, 30)),
      endDateTime: new Date(Date.UTC(2026, 6, 20, 10, 30)),
    };
    const prisma = {
      schedule: {
        findMany: jest.fn().mockResolvedValue([existingSchedule]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          lifePlan: {
            create: jest.fn().mockResolvedValue(lifePlan),
          },
          schedule: {
            createMany: jest.fn(),
          },
        }),
      ),
    };
    const service = new LifePlanService(prisma as never);

    const result = await service.createFromAi(
      'user-1',
      {
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
      },
      { allowConflicts: true },
    );

    expect(result).toEqual({ created: true, lifePlan });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('LifePlanService.updateFromAi', () => {
  it('replaces linked schedules as accepted when an AI life plan update is accepted', async () => {
    const lifePlan = {
      id: 'life-plan-1',
      userId: 'user-1',
      title: 'Updated math prep',
    };
    const tx = {
      lifePlan: {
        update: jest.fn().mockResolvedValue(lifePlan),
      },
      schedule: {
        updateMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      lifePlan: {
        findFirst: jest.fn().mockResolvedValue(lifePlan),
      },
      schedule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const service = new LifePlanService(prisma as never);

    const result = await service.updateFromAi('user-1', 'life-plan-1', {
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
      lifePlan,
    });
    expect(tx.lifePlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'life-plan-1' },
      }),
    );
    expect(tx.schedule.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        lifePlanId: 'life-plan-1',
        isDeleted: false,
      },
      data: { isDeleted: true },
    });
    expect(tx.schedule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          lifePlanId: 'life-plan-1',
          status: ScheduleStatus.ACCEPTED,
          startDateTime: new Date(Date.UTC(2026, 6, 20, 10, 0)),
          endDateTime: new Date(Date.UTC(2026, 6, 20, 12, 0)),
        }),
      ],
    });
  });
});

describe('LifePlanService.deleteFromAi', () => {
  it('soft deletes an owned life plan and its schedules', async () => {
    const lifePlan = {
      id: 'life-plan-1',
      userId: 'user-1',
      title: 'Math prep',
    };
    const prisma = {
      lifePlan: {
        findFirst: jest.fn().mockResolvedValue(lifePlan),
        update: jest.fn().mockResolvedValue(lifePlan),
      },
    };
    const service = new LifePlanService(prisma as never);

    await expect(
      service.deleteFromAi('user-1', 'life-plan-1'),
    ).resolves.toEqual(lifePlan);
    expect(prisma.lifePlan.update).toHaveBeenCalledWith({
      where: { id: 'life-plan-1' },
      data: {
        isDeleted: true,
        schedules: {
          updateMany: {
            where: { isDeleted: false },
            data: { isDeleted: true },
          },
        },
      },
    });
  });
});

describe('LifePlanService.findOneByUser', () => {
  it('returns an owned life plan with its schedules', async () => {
    const lifePlan = {
      id: 'life-plan-1',
      userId: 'user-1',
      title: 'Math prep',
      schedules: [{ id: 'schedule-1' }],
    };
    const prisma = {
      lifePlan: {
        findFirst: jest.fn().mockResolvedValue(lifePlan),
      },
    };
    const service = new LifePlanService(prisma as never);

    await expect(
      service.findOneByUser('user-1', 'life-plan-1'),
    ).resolves.toEqual(lifePlan);
    expect(prisma.lifePlan.findFirst).toHaveBeenCalledWith({
      where: { id: 'life-plan-1', userId: 'user-1', isDeleted: false },
      include: {
        schedules: {
          where: { isDeleted: false },
          orderBy: { startDateTime: 'asc' },
        },
      },
    });
  });

  it('throws NotFoundException when the life plan does not belong to the user', async () => {
    const prisma = {
      lifePlan: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new LifePlanService(prisma as never);

    await expect(service.findOneByUser('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
