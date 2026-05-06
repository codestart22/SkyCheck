import type { RiskLevel } from '../types';

// ─────────────────────────────────────────────────────────────────
// Go / No-Go Decision Engine
//
// Inputs:
//   • weatherRisk, floodRisk, trafficRisk, heatIndex
//   • healthScore (computed from HealthCheck)
//   • schoolStatus (F2F | ONLINE | SUSPENDED | HYBRID)
//   • activeGovAdvisories (severity array)
//
// Output:
//   • verdict:  GO | OWN_RISK | DO_NOT_GO
//   • reason:   Primary reason string
//   • factors:  All contributing factors (for display)
//   • score:    0–100 safety score
// ─────────────────────────────────────────────────────────────────

export type GoNoGoVerdict = 'GO' | 'OWN_RISK' | 'DO_NOT_GO';

export interface GoNoGoInput {
  // Weather
  weatherRisk:  RiskLevel;
  floodRisk:    RiskLevel;
  trafficRisk:  RiskLevel;
  heatIndex:    number;       // °C feelsLike
  rainProb:     number;       // 0–100
  windSpeed:    number;       // km/h

  // Health
  hasFever:           boolean;
  feverTemp:          number | null;
  hasCough:           boolean;
  hasSoreThroat:      boolean;
  hasFatigue:         boolean;
  hasDifficultyBreath:boolean;
  hasChronicCondition:boolean;
  overallFeeling:     string;  // well | mild | sick | severe

  // Institutional
  schoolStatus:       string;  // F2F | ONLINE | SUSPENDED | HYBRID
  govSeverities:      string[];// e.g. ['WARNING', 'ADVISORY']
}

export interface GoNoGoResult {
  verdict:      GoNoGoVerdict;
  primaryReason:string;
  factors:      GoNoGoFactor[];
  safetyScore:  number;        // 0–100 (100 = safest)
  recommendation: string;      // one-sentence advice
}

export interface GoNoGoFactor {
  category: 'HEALTH' | 'WEATHER' | 'FLOOD' | 'TRAFFIC' | 'SCHOOL' | 'GOVERNMENT' | 'HEAT';
  label:    string;
  status:   'OK' | 'CAUTION' | 'DANGER';
  detail:   string;
}

export function evaluateGoNoGo(input: GoNoGoInput): GoNoGoResult {
  const factors: GoNoGoFactor[] = [];
  let score = 100;
  let primaryReason = '';
  let verdict: GoNoGoVerdict = 'GO';

  // ── 1. School Status ──────────────────────────────────────────
  if (input.schoolStatus === 'SUSPENDED') {
    factors.push({ category: 'SCHOOL', label: 'Class Status', status: 'DANGER',
      detail: 'Classes are officially suspended — no need to travel' });
    score -= 100;
    primaryReason = 'Classes are suspended';
    verdict = 'DO_NOT_GO';
  } else if (input.schoolStatus === 'ONLINE') {
    factors.push({ category: 'SCHOOL', label: 'Class Status', status: 'CAUTION',
      detail: 'Classes are online — commuting is not required' });
    score -= 40;
    if (verdict === 'GO') { verdict = 'OWN_RISK'; primaryReason = 'Classes are online today'; }
  } else if (input.schoolStatus === 'HYBRID') {
    factors.push({ category: 'SCHOOL', label: 'Class Status', status: 'CAUTION',
      detail: 'Hybrid setup — check which subjects require physical attendance' });
    score -= 10;
  } else {
    factors.push({ category: 'SCHOOL', label: 'Class Status', status: 'OK',
      detail: 'Face-to-face classes are on schedule' });
  }

  // ── 2. Government Advisories ──────────────────────────────────
  const hasCritical = input.govSeverities.includes('CRITICAL');
  const hasWarning  = input.govSeverities.includes('WARNING');
  const hasAdvisory = input.govSeverities.includes('ADVISORY');

  if (hasCritical) {
    factors.push({ category: 'GOVERNMENT', label: 'Gov Advisory', status: 'DANGER',
      detail: 'Critical government advisory in effect — travel is discouraged' });
    score -= 80;
    if (verdict !== 'DO_NOT_GO') { verdict = 'DO_NOT_GO'; primaryReason = 'Critical government advisory'; }
  } else if (hasWarning) {
    factors.push({ category: 'GOVERNMENT', label: 'Gov Advisory', status: 'DANGER',
      detail: 'Government weather warning in effect' });
    score -= 35;
    if (verdict === 'GO') { verdict = 'OWN_RISK'; primaryReason = 'Government weather warning active'; }
  } else if (hasAdvisory) {
    factors.push({ category: 'GOVERNMENT', label: 'Gov Advisory', status: 'CAUTION',
      detail: 'Government advisory — stay informed' });
    score -= 15;
  } else {
    factors.push({ category: 'GOVERNMENT', label: 'Gov Advisory', status: 'OK',
      detail: 'No active government advisories' });
  }

  // ── 3. Health Assessment ──────────────────────────────────────
  const isSick    = input.overallFeeling === 'sick' || input.overallFeeling === 'severe';
  const isMildIll = input.overallFeeling === 'mild';
  const hasFeverHigh = input.hasFever && (input.feverTemp ?? 38) >= 38;
  const hasDanger = input.hasDifficultyBreath || (input.hasFever && (input.feverTemp ?? 38) >= 39);

  if (hasDanger || input.overallFeeling === 'severe') {
    factors.push({ category: 'HEALTH', label: 'Health Status', status: 'DANGER',
      detail: hasDanger
        ? `Severe symptoms detected${input.feverTemp ? ` (${input.feverTemp}°C fever)` : ''} — seek medical attention`
        : 'Feeling severely ill — rest and recover first' });
    score -= 100;
    if (verdict !== 'DO_NOT_GO') { verdict = 'DO_NOT_GO'; primaryReason = 'Your health condition is too poor to commute safely'; }
  } else if (isSick || hasFeverHigh) {
    factors.push({ category: 'HEALTH', label: 'Health Status', status: 'DANGER',
      detail: hasFeverHigh
        ? `Fever ${input.feverTemp ?? '≥38'}°C — you may be contagious`
        : 'Feeling sick — commuting puts you and others at risk' });
    score -= 60;
    if (verdict === 'GO') { verdict = 'OWN_RISK'; primaryReason = 'You are feeling unwell'; }
  } else if (isMildIll || input.hasFatigue || input.hasCough) {
    const symptoms = [
      input.hasFatigue && 'fatigue',
      input.hasCough   && 'cough',
      input.hasSoreThroat && 'sore throat',
    ].filter(Boolean).join(', ');
    factors.push({ category: 'HEALTH', label: 'Health Status', status: 'CAUTION',
      detail: `Mild symptoms (${symptoms || 'mild discomfort'}) — monitor your condition` });
    score -= 20;
    if (input.hasChronicCondition) {
      score -= 15;
      factors.push({ category: 'HEALTH', label: 'Chronic Condition', status: 'CAUTION',
        detail: 'Underlying condition — extra caution in high heat and rain' });
    }
    if (verdict === 'GO') { verdict = 'OWN_RISK'; primaryReason = 'You have mild symptoms today'; }
  } else {
    factors.push({ category: 'HEALTH', label: 'Health Status', status: 'OK',
      detail: input.hasChronicCondition
        ? 'Generally well but has underlying condition — check other risks'
        : 'Feeling well — no symptoms reported' });
    if (input.hasChronicCondition) score -= 5;
  }

  // ── 4. Weather Risk ───────────────────────────────────────────
  if (input.weatherRisk === 'HIGH') {
    factors.push({ category: 'WEATHER', label: 'Weather Risk', status: 'DANGER',
      detail: `Severe weather — Rain ${input.rainProb}%, Wind ${input.windSpeed} km/h` });
    score -= 35;
    if (verdict === 'GO') { verdict = 'OWN_RISK'; primaryReason = 'Severe weather conditions'; }
  } else if (input.weatherRisk === 'MEDIUM') {
    let detail = `Moderate weather risk — Rain ${input.rainProb}%`;
    if (input.heatIndex >= 33) {
      detail = `Moderate weather risk — Heat index ${input.heatIndex}°C`;
    } else if (input.windSpeed >= 30) {
      detail = `Moderate weather risk — Wind ${input.windSpeed} km/h`;
    }
    factors.push({ category: 'WEATHER', label: 'Weather Risk', status: 'CAUTION',
      detail });
    score -= 15;
  } else {
    factors.push({ category: 'WEATHER', label: 'Weather Risk', status: 'OK',
      detail: `Clear conditions — Rain prob ${input.rainProb}%` });
  }

  // ── 5. Flood Risk ─────────────────────────────────────────────
  if (input.floodRisk === 'HIGH') {
    factors.push({ category: 'FLOOD', label: 'Flood Risk', status: 'DANGER',
      detail: 'High flood risk on route — low-elevation roads may be impassable' });
    score -= 35;
    // HIGH weather + HIGH flood together = DO_NOT_GO
    if (input.weatherRisk === 'HIGH' && verdict !== 'DO_NOT_GO') {
      verdict = 'DO_NOT_GO';
      primaryReason = 'Combined severe weather and flood risk — do not travel';
    } else if (verdict === 'GO') {
      verdict = 'OWN_RISK';
      primaryReason = 'High flood risk on your route';
    }
  } else if (input.floodRisk === 'MEDIUM') {
    factors.push({ category: 'FLOOD', label: 'Flood Risk', status: 'CAUTION',
      detail: 'Possible flooding on low-elevation roads — use alternate routes' });
    score -= 15;
  } else {
    factors.push({ category: 'FLOOD', label: 'Flood Risk', status: 'OK',
      detail: 'No significant flood risk on your route' });
  }

  // ── 6. Heat Index ─────────────────────────────────────────────
  if (input.heatIndex >= 42) {
    factors.push({ category: 'HEAT', label: 'Heat Index', status: 'DANGER',
      detail: `${input.heatIndex}°C — PAGASA Danger level. Risk of heat stroke.` });
    score -= 25;
    if (input.hasChronicCondition && verdict === 'GO') {
      verdict = 'OWN_RISK';
      primaryReason = 'Extreme heat index with underlying health condition';
    }
  } else if (input.heatIndex >= 38) {
    factors.push({ category: 'HEAT', label: 'Heat Index', status: 'CAUTION',
      detail: `${input.heatIndex}°C — PAGASA Extreme Caution. Stay hydrated.` });
    score -= 10;
  } else {
    factors.push({ category: 'HEAT', label: 'Heat Index', status: 'OK',
      detail: `${input.heatIndex}°C — Comfortable range` });
  }

  // ── 7. Traffic ────────────────────────────────────────────────
  if (input.trafficRisk === 'HIGH') {
    factors.push({ category: 'TRAFFIC', label: 'Traffic', status: 'DANGER',
      detail: 'Severe congestion — expect very long delays and high fares' });
    score -= 15;
  } else if (input.trafficRisk === 'MEDIUM') {
    factors.push({ category: 'TRAFFIC', label: 'Traffic', status: 'CAUTION',
      detail: 'Moderate traffic — allow extra travel time' });
    score -= 5;
  } else {
    factors.push({ category: 'TRAFFIC', label: 'Traffic', status: 'OK',
      detail: 'Light traffic — smooth commute expected' });
  }

  // ── Final score clamp & recommendation ───────────────────────
  score = Math.max(0, Math.min(100, score));

  if (!primaryReason) {
    if      (verdict === 'GO')       primaryReason = 'All conditions are within safe range';
    else if (verdict === 'OWN_RISK') primaryReason = 'Some conditions require caution';
    else                              primaryReason = 'Conditions are unsafe for commuting';
  }

  const recommendation = buildRecommendation(verdict, input);

  return { verdict, primaryReason, factors, safetyScore: score, recommendation };
}

function buildRecommendation(verdict: GoNoGoVerdict, input: GoNoGoInput): string {
  if (verdict === 'DO_NOT_GO') {
    if (input.schoolStatus === 'SUSPENDED') return 'Classes are officially suspended. Stay home and rest.';
    if (input.overallFeeling === 'severe' || input.hasDifficultyBreath) return 'Seek medical attention immediately. Do not commute.';
    if (input.hasFever) return 'You have a fever. Rest at home and monitor your temperature.';
    return 'Conditions are unsafe. Stay home and check for updates.';
  }
  if (verdict === 'OWN_RISK') {
    if (input.schoolStatus === 'ONLINE') return 'Classes are online. Commuting is optional — attend from home if possible.';
    if (input.overallFeeling === 'mild') return 'You have mild symptoms. If you must go, wear a mask and rest when possible.';
    if (input.weatherRisk === 'HIGH') return 'Severe weather ahead. If you must go, leave early, bring raincoat, and budget for Maxim.';
    return 'Proceed with caution. Monitor conditions and have a backup plan.';
  }
  // GO
  if (input.rainProb >= 40) return 'Safe to go — but bring an umbrella. Rain is expected later.';
  if (input.heatIndex >= 38) return 'Safe to go — stay hydrated and wear light clothing.';
  return 'All clear! Safe to commute today. Have a great day.';
}
