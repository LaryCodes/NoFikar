"use client";

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { calculateSpeed, getActivityStatus } from '@/lib/locationUtils';
import StatusCard from '@/components/StatusCard';
import Link from 'next/link';

const CHILD_ID = 'demo-child-001'; // For MVP demo

export default function ChildPage() {
  const [isSharing, setIsSharing] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [activity, setActivity] = useState(getActivityStatus(0));
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  
  const watchIdRef = useRef<number | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  const startSharing = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setError(null);
    setIsSharing(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, speed: gpsSpeed, accuracy } = position.coords;
        const timestamp = new Date().toISOString();

        setLocation({ lat: latitude, lng: longitude });

        // Calculate speed
        let calculatedSpeed = 0;
        if (gpsSpeed !== null) {
          calculatedSpeed = gpsSpeed * 3.6; // Convert m/s to km/h
        } else if (lastPositionRef.current) {
          const timeDiff = Date.now() - lastPositionRef.current.time;
          calculatedSpeed = calculateSpeed(
            null,
            lastPositionRef.current.lat,
            lastPositionRef.current.lng,
            latitude,
            longitude,
            timeDiff
          );
        }

        setSpeed(calculatedSpeed);
        const activityStatus = getActivityStatus(calculatedSpeed);
        setActivity(activityStatus);

        // Save to Supabase
        try {
          const { error: dbError } = await supabase.from('child_locations').insert({
            child_id: CHILD_ID,
            latitude,
            longitude,
            speed: calculatedSpeed,
            accuracy,
            activity_status: activityStatus.label,
            created_at: timestamp,
          });

          if (dbError) {
            console.error('Error saving location:', dbError);
            setError('Failed to save location. Check Supabase connection.');
          }
        } catch (err) {
          console.error('Error:', err);
          setError('Connection error. Please check environment variables.');
        }

        // Update last position
        lastPositionRef.current = {
          lat: latitude,
          lng: longitude,
          time: Date.now(),
        };
      },
      (err) => {
        console.error('Geolocation error:', err);
        setError(`Location error: ${err.message}`);
        setIsSharing(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000,
      }
    );
  };

  const stopSharing = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsSharing(false);
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 p-4">
      <div className="max-w-md mx-auto py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">NoFikar</h1>
            <p className="text-sm text-gray-600">Child Mode</p>
          </div>
          <Link
            href="/"
            className="text-purple-600 hover:text-purple-700 font-medium text-sm"
          >
            ← Home
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 mb-4">
          <h2 className="text-xl font-semibold mb-4">Location Sharing</h2>
          
          {isSharing ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl border border-green-200">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                <div>
                  <div className="font-semibold text-green-800">ACTIVE</div>
                  <div className="text-sm text-green-600">
                    Your parent/guardian can see your location
                  </div>
                </div>
              </div>

              {location && (
                <div className="text-sm text-gray-600 p-3 bg-gray-50 rounded-lg">
                  <div>📍 {location.lat.toFixed(6)}, {location.lng.toFixed(6)}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 bg-gray-50 rounded-xl">
              <div className="text-gray-600 mb-4">
                Location sharing is currently off. Start sharing to let your parent/guardian see your location.
              </div>
            </div>
          )}
        </div>

        {isSharing && (
          <StatusCard
            activity={activity}
            speed={speed}
            isActive={isSharing}
            lastUpdated="Just now"
          />
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <div className="text-red-800 font-medium">Error</div>
            <div className="text-red-600 text-sm mt-1">{error}</div>
          </div>
        )}

        <button
          onClick={isSharing ? stopSharing : startSharing}
          className={`w-full font-semibold py-4 px-6 rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-lg ${
            isSharing
              ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white'
              : 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white'
          }`}
        >
          {isSharing ? '⏸ Stop Sharing' : '▶ Start Sharing'}
        </button>

        <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-200">
          <div className="text-sm text-blue-800">
            <strong>Privacy Notice:</strong> Location sharing is voluntary and transparent. 
            You can stop sharing at any time.
          </div>
        </div>
      </div>
    </div>
  );
}
