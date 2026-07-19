export interface ScheduleRecommendation {
  hasConflict: boolean;

  overlapMinutes: number;

  freeBufferBefore: number;

  freeBufferAfter: number;

  recommendedStart?: string;

  recommendedEnd?: string;

  reason?: string;
}
