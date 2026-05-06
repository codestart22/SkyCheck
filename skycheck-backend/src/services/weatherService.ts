import axios from 'axios';
import type { CurrentWeather, HourlyForecast, RiskLevel } from '../types';
import { RISK, getWeatherLabel, getWeatherIcon } from '../constants/risk';
import { getCachedWeather, setCachedWeather } from './weatherCache';

const BASE = 'https://api.open-meteo.com/v1/forecast';

interface OpenMeteoResponse {
  current: {
    temperature_2m:            number;
    apparent_temperature:      number;
    relative_humidity_2m:      number;
    precipitation_probability: number;
    precipitation:             number;
    wind_speed_10m:            number;
    weather_code:              number;
  };
  hourly: {
    time:                      string[];
    temperature_2m:            number[];
    precipitation_probability: number[];
    weather_code:              number[];
  };
}

export async function fetchWeatherData(lat: number, lon: number): Promise<{
  current: CurrentWeather; hourly: HourlyForecast[]; weatherRisk: RiskLevel;
}> {
  const cached = getCachedWeather(lat, lon);
  if (cached) return cached;

  const params = new URLSearchParams({
    latitude: lat.toString(), longitude: lon.toString(),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    timezone: 'Asia/Manila', forecast_days: '2', wind_speed_unit: 'kmh',
  });

  let data: OpenMeteoResponse;
  try {
    const res = await axios.get<OpenMeteoResponse>(`${BASE}?${params}`, { timeout: 10000 });
    data = res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      console.warn('[Weather] 429 — retry in 3s');
      await new Promise(r => setTimeout(r, 3000));
      const retry = await axios.get<OpenMeteoResponse>(`${BASE}?${params}`, { timeout: 10000 });
      data = retry.data;
    } else throw err;
  }

  const c = data.current;
  const current: CurrentWeather = {
    temperature:              Math.round(c.temperature_2m * 10) / 10,
    feelsLike:                Math.round(c.apparent_temperature * 10) / 10,
    humidity:                 c.relative_humidity_2m,
    precipitationProbability: c.precipitation_probability,
    precipitation:            c.precipitation,
    windSpeed:                Math.round(c.wind_speed_10m),
    weatherCode:              c.weather_code,
    weatherLabel:             getWeatherLabel(c.weather_code),
    weatherIcon:              getWeatherIcon(c.weather_code),
    updatedAt:                new Date().toISOString(),
  };

  const now = new Date();
  const hourly: HourlyForecast[] = [];
  for (let i = 0; i < data.hourly.time.length && hourly.length < 6; i++) {
    const t = new Date(data.hourly.time[i]);
    if (t.getTime() >= now.getTime()) {
      hourly.push({
        time: t.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }),
        temperature: Math.round(data.hourly.temperature_2m[i]),
        weatherCode: data.hourly.weather_code[i],
        weatherIcon: getWeatherIcon(data.hourly.weather_code[i]),
        precipitationProbability: data.hourly.precipitation_probability[i],
      });
    }
  }

  const result = { current, hourly, weatherRisk: evaluateWeatherRisk(current) };
  setCachedWeather(lat, lon, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────
// evaluateWeatherRisk — strict thresholds, no false positives
// Thresholds: RAIN ≥40%, WIND ≥30 km/h, HEAT ≥38°C, PRECIP ≥3mm
// ─────────────────────────────────────────────────────────────────
export function evaluateWeatherRisk(w: CurrentWeather): RiskLevel {
  const R = RISK.WEATHER;
  if ([82, 95, 96, 99].includes(w.weatherCode)) return 'HIGH';
  if (w.precipitationProbability >= R.RAIN_HIGH) return 'HIGH';
  if (w.windSpeed >= R.WIND_HIGH)                return 'HIGH';
  if (w.feelsLike >= R.HEAT_HIGH)                return 'HIGH';

  let med = 0;
  if (w.precipitationProbability >= R.RAIN_MED) med++;
  if (w.windSpeed >= R.WIND_MED)               med++;
  if (w.feelsLike >= R.HEAT_MED)               med++;
  if (w.precipitation >= 3)                    med++;

  if (med >= 2) return 'HIGH';
  if (med === 1) return 'MEDIUM';
  return 'LOW';
}

// ─────────────────────────────────────────────────────────────────
// buildWeatherBasis — ABSOLUTE STRICT, value-gated
// Every part only included if its value >= its threshold.
// No hardcoded strings like "Traffic slowed by rain".
// ─────────────────────────────────────────────────────────────────
export function buildWeatherBasis(
  w: CurrentWeather,
  weatherRisk: RiskLevel,
  trafficRisk: RiskLevel,
  trafficRatio?: number,
  floodRisk?: RiskLevel,
  elevation?: number,
): string {
  const R = RISK.WEATHER;
  const parts: string[] = [];

  if (w.precipitationProbability >= R.RAIN_MED)  parts.push(`Rain prob ${w.precipitationProbability}%`);
  if (w.windSpeed                >= R.WIND_MED)  parts.push(`Wind ${w.windSpeed} km/h`);
  if (w.feelsLike                >= R.HEAT_MED)  parts.push(`Heat index ${w.feelsLike}°C`);
  if (w.precipitation            >= 3)            parts.push(`Precipitation ${w.precipitation}mm`);

  if ((trafficRisk === 'MEDIUM' || trafficRisk === 'HIGH') && trafficRatio !== undefined)
    parts.push(`Traffic flow ${Math.round(trafficRatio * 100)}%`);

  if (floodRisk && floodRisk !== 'LOW' && floodRisk !== 'UNKNOWN'
      && elevation !== undefined && elevation >= 0)
    parts.push(`Elevation ${elevation}m`);

  if (parts.length === 0) {
    if (trafficRisk === 'MEDIUM' && trafficRatio !== undefined)
      return `Traffic flow ${Math.round(trafficRatio * 100)}%`;
    if (trafficRisk === 'HIGH') return 'Heavy traffic congestion';
    return 'Clear skies, light traffic — safe to commute';
  }
  return `Based on ${parts.join(' · ')}`;
}

// ─────────────────────────────────────────────────────────────────
// getCommuteTips — value-gated, no false positives
// ─────────────────────────────────────────────────────────────────
export function getCommuteTips(
  weatherRisk: RiskLevel,
  trafficRisk: RiskLevel,
  floodRisk:   RiskLevel,
  weather?:    CurrentWeather,
): string[] {
  const tips: string[] = [];
  const R = RISK.WEATHER;
  const rain    = weather?.precipitationProbability ?? 0;
  const precip  = weather?.precipitation ?? 0;
  const feelsLk = weather?.feelsLike ?? 0;
  const wind    = weather?.windSpeed ?? 0;
  const wCode   = weather?.weatherCode ?? 0;
  const isRain  = precip >= 1 || [51,53,55,61,63,65,80,81,82,95,96,99].includes(wCode);
  const phtH    = (new Date().getUTCHours() + 8) % 24;
  const isDay   = phtH >= 6 && phtH < 18;

  if (rain >= R.RAIN_HIGH)    { tips.push('Heavy rain — bring umbrella and raincoat'); tips.push('Leave 20–30 min earlier'); }
  else if (isRain)              tips.push('It is raining — bring an umbrella');
  else if (rain >= 40)          tips.push('Rain likely — bring umbrella just in case');
  else if (rain >= 20)          tips.push('Slight rain chance — consider an umbrella');

  if (isDay && feelsLk >= R.HEAT_HIGH)  tips.push('Extreme heat — wear light clothing and carry water');
  else if (isDay && feelsLk >= R.HEAT_MED) tips.push('Hot day — stay hydrated');

  if (wind >= R.WIND_HIGH) tips.push('Strong winds — careful on motorcycles');
  else if (wind >= R.WIND_MED) tips.push('Breezy — secure loose items');

  if (trafficRisk === 'HIGH')        tips.push('Heavy traffic — budget extra time and ₱200 for Maxim');
  else if (trafficRisk === 'MEDIUM') tips.push('Moderate traffic — allow a few extra minutes');
  else if (trafficRisk === 'LOW' && tips.length === 0) tips.push('Light traffic — smooth commute expected');

  if (floodRisk === 'HIGH')        tips.push('Flood risk — avoid low-lying roads');
  else if (floodRisk === 'MEDIUM') tips.push('Possible flooding in low-elevation areas');

  return [...new Set(tips)].slice(0, 4);
}
