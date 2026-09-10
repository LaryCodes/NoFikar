"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-3">
            NoFikar
          </h1>
          <p className="text-gray-600 text-lg">Less worry. More freedom.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-4">
          <Link href="/parent">
            <button className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-lg">
              <div className="text-lg">👨‍👩‍👧 Parent Mode</div>
              <div className="text-sm opacity-90 mt-1">View family location</div>
            </button>
          </Link>

          <Link href="/child">
            <button className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-lg">
              <div className="text-lg">🧒 Child Mode</div>
              <div className="text-sm opacity-90 mt-1">Share your location</div>
            </button>
          </Link>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            Location sharing is voluntary and can be stopped at any time
          </p>
        </div>
      </div>
    </div>
  );
}
