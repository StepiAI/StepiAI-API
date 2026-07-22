export const PREP_BUFFER_SEC = 5 * 60;

const TARGET_ONTIME = 0.9;

const MIN_SPREAD_SEC = 120;
const SPREAD_FRACTION = 0.15;

export function travelSpreadSeconds(
  travelSeconds: number,
  noTrafficSeconds: number,
): number {
  const trafficDelay = Math.max(travelSeconds - noTrafficSeconds, 0);
  return Math.max(SPREAD_FRACTION * travelSeconds, trafficDelay, MIN_SPREAD_SEC);
}

export function onTimeProbability(
  slackSeconds: number,
  spreadSeconds: number,
): number {
  const spread = Math.max(spreadSeconds, 1);
  return 1 / (1 + Math.exp(-slackSeconds / spread));
}

export interface DepartureRecommendation {
  naiveDepartureMs: number;
  onTimeBefore: number;
  recommendedDepartureMs: number;
  onTimeAfter: number;
  travelSeconds: number;
  trafficDelaySeconds: number;
  spreadSeconds: number;
}

export function recommendDeparture(params: {
  eventStartMs: number;
  travelSeconds: number;
  noTrafficSeconds: number;
  prepBufferSec?: number;
}): DepartureRecommendation {
  const { eventStartMs, travelSeconds, noTrafficSeconds } = params;
  const prepBuffer = params.prepBufferSec ?? PREP_BUFFER_SEC;

  const spread = travelSpreadSeconds(travelSeconds, noTrafficSeconds);
  const trafficDelaySeconds = Math.max(travelSeconds - noTrafficSeconds, 0);

  const naiveDepartureMs = eventStartMs - (noTrafficSeconds + prepBuffer) * 1000;
  const naiveArrivalMs = naiveDepartureMs + (travelSeconds + prepBuffer) * 1000;
  const naiveSlackSec = (eventStartMs - naiveArrivalMs) / 1000;
  const onTimeBefore = onTimeProbability(naiveSlackSec, spread);

  const slackTargetSec = spread * Math.log(TARGET_ONTIME / (1 - TARGET_ONTIME));
  const recommendedDepartureMs = eventStartMs - (travelSeconds + prepBuffer) * 1000 - slackTargetSec * 1000;
  const recArrivalMs = recommendedDepartureMs + (travelSeconds + prepBuffer) * 1000;
  const recSlackSec = (eventStartMs - recArrivalMs) / 1000;
  const onTimeAfter = onTimeProbability(recSlackSec, spread);

  return {
    naiveDepartureMs,
    onTimeBefore,
    recommendedDepartureMs,
    onTimeAfter,
    travelSeconds,
    trafficDelaySeconds,
    spreadSeconds: spread,
  };
}
