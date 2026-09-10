"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getActivityStatus, getTimeAgo } from '@/lib/locationUtils';
import StatusCard from '@/components/StatusCard';
import MapView from '@/components/MapView';
import Link from 'next/link';
import { LocationData } from '@/types';

const CHILD_ID = 'demo-child-001'; // For MVP demo

export default function ParentPage() {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [trail, setTrail] = useState<Array<{ lat: number; lng: number }>>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    // Fetch initial location
    const fetchInitialLocation = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('child_locations')
          .select('*')
          .eq('child_id', CHILD_ID)
          .order('created_at', { ascending: false })
          .limit(1);

        if (fetchError) {
          console.error('Error fetching location:', fetchError);
          setError('Failed to load location. Check Supabase setup.');
          return;
        }

        if (data && data.length > 0) {
          setLocation(data[0]);
          setIsConnected(true);
          setLastUpdated(getTimeAgo(data[0].created_at || ''));
        }
      } catch (err) {
        console.error('Error:', err);
        setError('Connection error. Check environment variables.');
      }
    };

    // Fetch recent trail
    const fetchTrail = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('child_locations')
          .select('latitude, longitude')
          .eq('child_id', CHILD_ID)
          .order('created_at', { ascending: false })
          .limit(20);

        if (fetchError) {
          console.error('Error fetching trail:', fetchError);
          return;
        }

        if (data && data.length > 0) {
          setTrail(
            data.reverse().map((point) => ({
              lat: point.latitude,
              lng: point.longitude,
            }))
          );
        }
      } catch (err) {
        console.error('Error:', err);
      }
    };

    fetchInitialLocation();
    fetchTrail();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('location-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'child_locations',
          filter: `child_id=eq.${CHILD_ID}`,
        },
        (payload) => {
          const newLocation = payload.new as LocationData;
          setLocation(newLocation);
          setIsConnected(true);
          setLastUpdated(getTimeAgo(newLocation.created_at || ''));
          
          // Update trail
          setTrail((prev) => {
            const updated = [
              ...prev,
              { lat: newLocation.latitude, lng: newLocation.longitude },
            ];
            // Keep only last 20 points
            return updated.slice(-20);
          });
        }
      )
      .subscribe();

    // Update "time ago" every 5 seconds
    const interval = setInterval(() => {
      if (location?.created_at) {
        setLastUpdated(getTimeAgo(location.created_at));
      }
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [location?.created_at]);

  const activity = location
    ? getActivityStatus(location.speed)
    : getActivityStatus(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4">
      <div className="max-w-4xl mx-auto py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">NoFikar</h1>
            <p className="text-sm text-gray-600">Parent Dashboard</p>
          </div>
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-700 font-medium text-sm"
          >
            ← Home
          </Link>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <div className="text-red-800 font-medium">Error</div>
            <div className="text-red-600 text-sm mt-1">{error}</div>
          </div>
        )}

        {!location && !error ? (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="text-6xl mb-4">📍</div>
            <div className="text-xl font-semibold text-gray-800 mb-2">
              Waiting for location...
            </div>
            <div className="text-gray-600">
              Make sure the child has started sharing their location
            </div>
          </div>
        ) : location ? (
          <div className="space-y-4">
            <StatusCard
              activity={activity}
              speed={location.speed}
              isActive={isConnected}
              lastUpdated={lastUpdated}
            />

            <MapView
              latitude={location.latitude}
              longitude={location.longitude}
              trail={trail}
            />

            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h3 className="font-semibold text-gray-800 mb-3">Location Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Latitude:</span>
                  <span className="font-mono text-gray-800">
                    {location.latitude.toFixed(6)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Longitude:</span>
                  <span className="font-mono text-gray-800">
                    {location.longitude.toFixed(6)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Accuracy:</span>
                  <span className="text-gray-800">±{location.accuracy.toFixed(0)}m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Activity:</span>
                  <span className="text-gray-800">
                    {activity.icon} {activity.label}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="text-sm text-amber-800">
                <strong>Note:</strong> Activity is estimated from GPS speed. 
                Speed detection may vary based on device and GPS accuracy.
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
