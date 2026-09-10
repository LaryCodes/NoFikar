import { ActivityStatus } from '@/types';

interface StatusCardProps {
  activity: ActivityStatus;
  speed: number;
  isActive: boolean;
  lastUpdated?: string;
}

export default function StatusCard({
  activity,
  speed,
  isActive,
  lastUpdated,
}: StatusCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Status</h2>
        <div className="flex items-center gap-2">
          {isActive ? (
            <>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm text-green-600 font-medium">LIVE</span>
            </>
          ) : (
            <span className="text-sm text-gray-400 font-medium">OFFLINE</span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-3xl mb-2">
            {activity.icon} {activity.label}
          </div>
          <div className={`text-2xl font-bold ${activity.color}`}>
            {speed.toFixed(1)} km/h
          </div>
        </div>

        {lastUpdated && (
          <div className="text-sm text-gray-500 pt-3 border-t">
            Last updated: {lastUpdated}
          </div>
        )}
      </div>
    </div>
  );
}
