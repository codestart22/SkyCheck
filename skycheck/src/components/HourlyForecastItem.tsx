import { getWeatherInfo } from '../constants/weatherCodes';

interface HourlyForecastItemProps {
  time: string;
  temperature: number;
  weatherCode: number;
  precipitationProbability: number;
}

export default function HourlyForecastItem({
  time,
  temperature,
  weatherCode,
  precipitationProbability,
}: HourlyForecastItemProps) {
  const { emoji } = getWeatherInfo(weatherCode);
  const barHeight = Math.max(4, (precipitationProbability / 100) * 32); // 4–32px

  return (
    <div className="flex flex-col items-center gap-1 min-w-[52px]">
      <span className="text-xs text-gray-500 font-medium">{time}</span>
      <span className="text-lg">{emoji}</span>
      <span className="text-sm font-bold text-gray-800">{temperature}°</span>
      {/* Rain probability bar */}
      <div className="flex flex-col justify-end h-8 w-5 bg-blue-100 rounded-full overflow-hidden">
        <div
          className="bg-blue-500 rounded-full w-full transition-all"
          style={{ height: `${barHeight}px` }}
        />
      </div>
      <span className="text-xs text-blue-600 font-medium">{precipitationProbability}%</span>
    </div>
  );
}
