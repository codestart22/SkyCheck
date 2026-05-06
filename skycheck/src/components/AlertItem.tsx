import type { Alert, AlertType } from '../types';
import RiskBadge from './RiskBadge';
import { formatTime, formatShortDate } from '../utils';

const ALERT_ICONS: Record<AlertType, string> = {
  WEATHER: '🌧',
  TRAFFIC: '🚗',
  FLOOD:   '🌊',
};

interface AlertItemProps {
  alert: Alert;
  onClick?: (alert: Alert) => void;
}

export default function AlertItem({ alert, onClick }: AlertItemProps) {
  return (
    <button
      className={`w-full text-left px-4 py-3.5 flex gap-3 items-start transition-colors ${
        alert.isRead ? 'bg-white' : 'bg-blue-50/40'
      } hover:bg-gray-50`}
      onClick={() => onClick?.(alert)}
    >
      {/* Unread dot */}
      <div className="pt-1.5">
        <div className={`w-2 h-2 rounded-full shrink-0 ${alert.isRead ? 'bg-transparent' : 'bg-blue-500'}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Title row */}
        <div className="flex items-center gap-2 flex-wrap">
          <RiskBadge level={alert.riskLevel} size="sm" />
          <span className="text-lg">{ALERT_ICONS[alert.type]}</span>
        </div>

        <p className="text-sm font-semibold text-gray-900 leading-snug">{alert.title}</p>
        <p className="text-xs text-gray-600 leading-relaxed">{alert.body}</p>

        {/* Footer */}
        <div className="flex items-center gap-2 flex-wrap">
          {alert.routeLabel && (
            <span className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full font-medium">
              {alert.routeLabel}
            </span>
          )}
          <span className="text-xs text-gray-400">
            {formatShortDate(alert.createdAt)} at {formatTime(alert.createdAt)}
          </span>
        </div>
      </div>
    </button>
  );
}
