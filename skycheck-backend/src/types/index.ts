export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  humidity: number;
  precipitationProbability: number;
  precipitation: number;
  windSpeed: number;
  weatherCode: number;
  weatherLabel: string;
  weatherIcon: string;
  updatedAt: string;
}

export interface HourlyForecast {
  time: string;
  temperature: number;
  weatherCode: number;
  weatherIcon: string;
  precipitationProbability: number;
}

export interface CombinedRisk {
  overall: RiskLevel;
  weather: RiskLevel;
  traffic: RiskLevel;
  flood: RiskLevel;
  trafficRatio?: number;
  elevation?: number;
  basis: string;
}

export interface WeatherSnapshot {
  location: string;
  lat: number;
  lon: number;
  current: CurrentWeather;
  hourly: HourlyForecast[];
  risk: CombinedRisk;
  commuteTips: string[];
}

export interface RouteCalcResult {
  distanceKm: number;
  durationMin: number;
  waypoints: [number, number][];
}

export interface TrafficResult {
  congestionRatio: number;
  currentSpeed: number;
  freeFlowSpeed: number;
  riskLevel: RiskLevel;
  label?: string;
}

export interface FloodResult {
  elevation: number;
  riskLevel: RiskLevel;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}
