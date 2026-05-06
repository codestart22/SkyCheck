import axios from 'axios';
import type { RouteCalcResult } from '../types';

// ─────────────────────────────────────────────────────────────────
// OpenRouteService (ORS) Route Calculator
// Free: 2,000 req/day — register at https://openrouteservice.org
// Note: ORS uses [lon, lat] order (GeoJSON convention)
// ─────────────────────────────────────────────────────────────────

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions/driving-car';

interface ORSResponse {
  routes: Array<{
    summary: {
      distance: number;  // metres
      duration: number;  // seconds
    };
    geometry: string;    // encoded polyline or GeoJSON depending on format param
  }>;
  features?: Array<{
    geometry: {
      coordinates: [number, number][];
    };
    properties: {
      summary: { distance: number; duration: number };
    };
  }>;
}

export async function calculateRoute(
  startLat: number, startLon: number,
  destLat:  number, destLon:  number,
): Promise<RouteCalcResult> {
  const ORS_KEY = process.env.ORS_API_KEY;

  if (!ORS_KEY) {
    console.warn('[Route] ORS_API_KEY not set — returning straight-line estimate');
    const distKm = haversineKm(startLat, startLon, destLat, destLon) * 1.35;
    return { distanceKm: Math.round(distKm * 10) / 10, durationMin: Math.round(distKm * 3), waypoints: [[startLat, startLon], [destLat, destLon]] };
  }

  const { data } = await axios.get<ORSResponse>(ORS_BASE, {
    params: {
      start: `${startLon},${startLat}`,
      end:   `${destLon},${destLat}`,
    },
    headers: {
      'Authorization': ORS_KEY,
      'Accept':        'application/json, application/geo+json',
    },
    timeout: 10000,
  });

  // GeoJSON FeatureCollection response
  const feature = data.features?.[0];
  if (!feature) throw new Error('ORS returned no route');

  const distanceKm = Math.round((feature.properties.summary.distance / 1000) * 10) / 10;
  const durationMin = Math.round(feature.properties.summary.duration / 60);

  // Convert [lon, lat] GeoJSON coords to [lat, lon] for Leaflet
  const waypoints: [number, number][] = feature.geometry.coordinates.map(
    ([lon, lat]) => [lat, lon]
  );

  return { distanceKm, durationMin, waypoints };
}

// Haversine formula for straight-line fallback distance
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
