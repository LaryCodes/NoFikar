# SafeTrack

**Family Safety, Simplified.**

SafeTrack is a family safety platform where children can voluntarily share their live location with parents/guardians in real-time.

## ✨ Features

- 🗺️ **Live Location Tracking** - Real GPS tracking using browser Geolocation API
- 🔄 **Real-Time Updates** - Instant updates using Supabase Realtime
- 🚗 **Activity Detection** - Automatic detection of Stationary, Walking, and Driving
- 📊 **Speed Monitoring** - Real-time speed display in km/h
- 🛤️ **Route Trail** - Visual history of recent movement
- 📱 **Mobile-First** - Optimized for smartphone use
- 🔒 **Privacy-Focused** - Voluntary sharing that can be stopped anytime

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Supabase account (free tier)

### Installation

1. **Clone and install dependencies:**

```bash
npm install
```

2. **Set up Supabase:**

   - Go to [supabase.com](https://supabase.com) and create a new project
   - Wait for the database to be provisioned
   - Go to Project Settings → API
   - Copy your project URL and anon/public key

3. **Create the database table:**

   In Supabase SQL Editor, run:

```sql
CREATE TABLE child_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION DEFAULT 0,
  accuracy DOUBLE PRECISION DEFAULT 0,
  activity_status TEXT DEFAULT 'Stationary',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE child_locations;

-- Add index for better performance
CREATE INDEX idx_child_locations_child_id ON child_locations(child_id);
CREATE INDEX idx_child_locations_created_at ON child_locations(created_at DESC);
```

4. **Configure environment variables:**

   Create a `.env.local` file:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

5. **Run the development server:**

```bash
npm run dev
```

6. **Open the app:**

   Navigate to [http://localhost:3000](http://localhost:3000)

## 📱 How to Use

### Testing Locally

1. Open the app on two devices (or two browser windows)
2. **Device 1 (Child Mode):**
   - Click "Child Mode"
   - Click "Start Sharing"
   - Allow location permissions
3. **Device 2 (Parent Mode):**
   - Click "Parent Mode"
   - View the live location on the map

### Demo on Two Phones

1. Deploy to Vercel (see Deployment section)
2. Open the deployed URL on both phones
3. Child phone: Enter Child Mode and start sharing
4. Parent phone: Enter Parent Mode and watch live updates

## 🌐 Deployment

### Deploy to Vercel

1. **Install Vercel CLI (optional):**

```bash
npm i -g vercel
```

2. **Deploy:**

```bash
vercel
```

   Or connect your GitHub repo to Vercel for automatic deployments.

3. **Set environment variables in Vercel:**
   - Go to your Vercel project settings
   - Add `NEXT_PUBLIC_SUPABASE_URL`
   - Add `NEXT_PUBLIC_SUPABASE_ANON_KEY`

4. **Redeploy** if environment variables were added after first deployment.

### Build Locally

```bash
npm run build
npm start
```

## 🏗️ Tech Stack

- **Frontend:** Next.js 14, React, TypeScript
- **Styling:** Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Real-Time:** Supabase Realtime
- **Maps:** Leaflet + OpenStreetMap
- **Hosting:** Vercel

## 🔐 Privacy & Security

- Location sharing is **voluntary** and **transparent**
- Child can see sharing status at all times
- Child can stop sharing with one tap
- No hidden tracking or surveillance features
- Activity detection is estimated from GPS speed

## 📊 Activity Detection

Speed-based activity classification:

- **🟢 Stationary:** 0-2 km/h
- **🚶 Walking:** 2-25 km/h  
- **🚗 Driving:** 25+ km/h

*Note: Activity is estimated from GPS speed and may vary based on device accuracy.*

## 🛠️ Development

### Project Structure

```
├── app/
│   ├── page.tsx              # Landing page
│   ├── child/page.tsx        # Child mode
│   ├── parent/page.tsx       # Parent mode
│   ├── layout.tsx            # Root layout
│   └── globals.css           # Global styles
├── components/
│   ├── MapView.tsx           # Leaflet map component
│   └── StatusCard.tsx        # Status display card
├── lib/
│   ├── supabase.ts           # Supabase client
│   └── locationUtils.ts      # Location utilities
└── types/
    └── index.ts              # TypeScript types
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## 🐛 Troubleshooting

### Location not updating?

- Check browser location permissions
- Ensure HTTPS (required for geolocation)
- Check Supabase environment variables
- Verify database table exists

### Map not showing?

- Check browser console for errors
- Verify Leaflet CSS is loaded
- Check network tab for tile loading

### Realtime not working?

- Verify Supabase Realtime is enabled for the table
- Check browser console for connection errors
- Ensure anon key has proper permissions

## 📝 License

MIT License - feel free to use for your own projects!

## 🤝 Contributing

This is an MVP built for rapid deployment. Contributions welcome!

## 📧 Support

For issues and questions, please open a GitHub issue.

---

Built with ❤️ for family safety
