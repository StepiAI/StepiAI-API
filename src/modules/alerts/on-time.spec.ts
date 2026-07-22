import {
  onTimeProbability,
  recommendDeparture,
  travelSpreadSeconds,
} from './on-time';

describe('on-time model', () => {
  describe('onTimeProbability', () => {
    it('gives 50% when there is no slack', () => {
      expect(onTimeProbability(0, 600)).toBeCloseTo(0.5, 5);
    });

    it('rises above 50% with positive slack', () => {
      expect(onTimeProbability(600, 600)).toBeGreaterThan(0.7);
    });

    it('drops below 50% when already running late', () => {
      expect(onTimeProbability(-600, 600)).toBeLessThan(0.3);
    });
  });

  describe('travelSpreadSeconds', () => {
    it('never falls below the minimum spread', () => {
      expect(travelSpreadSeconds(60, 60)).toBeGreaterThanOrEqual(120);
    });

    it('widens as traffic delay grows', () => {
      const light = travelSpreadSeconds(1200, 1100);
      const heavy = travelSpreadSeconds(2400, 1100);
      expect(heavy).toBeGreaterThan(light);
    });
  });

  describe('recommendDeparture', () => {
    it('recommends leaving earlier than the naive departure under traffic', () => {
      const eventStartMs = new Date('2026-07-24T08:00:00+07:00').getTime();
      const rec = recommendDeparture({
        eventStartMs,
        travelSeconds: 1800, // 30 min dengan macet
        noTrafficSeconds: 1080, // 18 min lancar
      });

      expect(rec.recommendedDepartureMs).toBeLessThan(rec.naiveDepartureMs);
      expect(rec.onTimeAfter).toBeGreaterThan(rec.onTimeBefore);
      expect(rec.onTimeAfter).toBeGreaterThan(0.85);
      expect(rec.trafficDelaySeconds).toBe(720);
    });

    it('keeps a healthy on-time when there is no traffic', () => {
      const eventStartMs = new Date('2026-07-24T08:00:00+07:00').getTime();
      const rec = recommendDeparture({
        eventStartMs,
        travelSeconds: 1080,
        noTrafficSeconds: 1080,
      });

      expect(rec.trafficDelaySeconds).toBe(0);
      expect(rec.onTimeBefore).toBeGreaterThan(0.4);
    });
  });
});
