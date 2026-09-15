# NoFikar — Family Safety Platform

**Less worry. More freedom.**

NoFikar is a production-quality, consent-based family safety platform built with Next.js 15, featuring real-time location sharing, safe zones, and emergency features.

## 🌟 Features

### Core Features
- ✅ **Real-time Location Sharing** - Voluntary GPS tracking with live updates
- ✅ **Family Circles** - Create or join family groups with 6-digit codes
- ✅ **Safe Zones** - Set up locations like Home, School, Office with entry/exit alerts
- ✅ **Emergency SOS** - One-tap alert system for family members
- ✅ **Activity Detection** - Automatic detection of stationary, walking, and driving
- ✅ **Live Alerts** - Real-time notifications for family activities
- ✅ **Dark Mode** - Full theme support (Light/Dark/System)

### Authentication
- Email/Password login
- Google OAuth
- Persistent sessions
- Profile management

### Mobile-First Design
- Progressive Web App (PWA)
- Installable on mobile devices
- Offline asset caching
- Bottom navigation optimized for thumb reach
- Safe area support for notched devices

## 🎨 Design System

**Theme:** Emerald/Sage with warm neutrals

**Light Mode:**
- Soft emerald primary (#3d9970)
- Warm ivory backgrounds
- Light sand accents

**Dark Mode:**
- Deep charcoal backgrounds
- Forest green accents
- Frosted glass effects

**Components:** Built with Radix UI (shadcn/ui)
- Fully accessible
- Keyboard navigable
- Screen reader friendly

## 🏗️ Tech Stack

### Frontend
- **Next.js 15** - App Router, Server Components
- **TypeScript** - Full type safety
- **Tailwind CSS** - Utility-first styling
- **Radix UI** - Accessible component primitives
- **Zustand** - Lightweight state management
- **next-themes** - Theme management
- **next-pwa** - Progressive Web App support

### Backend
- **Supabase** - PostgreSQL database
- **Supabase Auth** - Authentication & authorization
- **Supabase Realtime** - Live location updates
- **Row Level Security** - Fine-grained data access

### Maps
- OpenStreetMap tiles (free)
- MapLibre GL (optional upgrade)

## 📁 Project Structure

```
nofikar/
├── app/
│   ├── (auth)/
│   │   ├── login/          # Login page
│   │   └── signup/         # Signup page
│   ├── app/
│   │   ├── layout.tsx      # Main app shell + bottom nav
│   │   ├── page.tsx        # Map screen (primary)
│   │   ├── family/         # Family members list
│   │   ├── safety/         # SOS & safe zones
│   │   ├── alerts/         # Activity timeline
│   │   └── settings/       # User settings
│   ├── auth/callback/      # OAuth callback
│   ├── legal/              # Privacy, Terms, Safety
│   ├── onboarding/         # Family setup flow
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Landing/redirect
├── components/
│   └── ui/                 # Reusable UI components
├── lib/
│   ├── supabase.ts         # Supabase client
│   ├── store.ts            # Zustand store
│   ├── utils.ts            # Utility functions
│   └── locationUtils.ts    # GPS calculations
├── supabase/
│   └── schema.sql          # Database schema
├── types/
│   └── index.ts            # TypeScript types
└── public/
    └── manifest.json       # PWA manifest
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Supabase account
- npm or yarn

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor
3. Run the schema from `supabase/schema.sql`
4. Enable Realtime for `location_history` table
5. Get your project URL and anon key from Settings → API

### 3. Configure Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 5. Configure Google OAuth (Optional)

1. In Supabase Dashboard: Authentication → Providers → Google
2. Add your OAuth credentials
3. Add authorized redirect URI: `https://your-project.supabase.co/auth/v1/callback`

## 📱 Using the App

### First Time Setup

1. **Sign Up** - Create account with email or Google
2. **Create Family** - Set a family name, get a 6-digit code
3. **Invite Members** - Share code with family members
4. **Enable Location** - Allow browser location permissions
5. **Start Sharing** - Tap "Start Location Sharing" on Map screen

### Daily Use

**Map Screen (Home):**
- View family members' locations
- See activity status (stationary, walking, driving)
- Check battery levels
- Start/stop your location sharing

**Family Screen:**
- View all family members
- See who's online
- Check last activity
- Invite new members

**Safety Screen:**
- Trigger emergency SOS
- Manage safe zones
- Quick safety actions

**Alerts Screen:**
- View activity timeline
- See zone entries/exits
- Check emergency alerts

**Settings Screen:**
- Edit profile
- Change theme
- Manage notifications
- Sign out

## 🗄️ Database Schema

### Core Tables

**families**
- id, name, code (6-digit), created_by, timestamps

**family_members**
- id, family_id, user_id, role (admin/member), name, avatar_url

**profiles**
- id, email, name, battery_level, location_sharing_enabled

**location_history**
- id, user_id, family_id, lat, lng, speed, activity_status, battery_level

**safe_zones**
- id, family_id, name, lat, lng, radius, notify_on_entry, notify_on_exit

**alerts**
- id, family_id, user_id, type, title, message, read

**emergency_sessions**
- id, requester_id, target_id, session_type, status, expires_at

All tables have Row Level Security enabled.

## 🔐 Security & Privacy

### Privacy by Design
- ✅ Voluntary location sharing
- ✅ Visible sharing status
- ✅ User-controlled (start/stop anytime)
- ✅ No hidden tracking
- ✅ Consent-based emergency features

### Security Features
- Row Level Security (RLS)
- Encrypted connections (HTTPS)
- Secure authentication
- Family-scoped data access
- Auto-expiring emergency sessions

### Data Retention
- Location history: 7 days
- Account data: Until deletion
- Emergency sessions: Auto-expire

## 🌍 Deployment

### Deploy to Vercel

1. Push code to GitHub
2. Import repository in Vercel
3. Add environment variables
4. Deploy

```bash
vercel
```

### Configure PWA

The app is already configured as a PWA. Users can:
- Install to home screen
- Use offline (cached assets)
- Receive push notifications (future)

### Post-Deployment

1. Test on mobile devices
2. Verify GPS permissions work
3. Test realtime updates
4. Check theme switching
5. Verify SOS alerts

## 📊 Performance

- Lighthouse Score: 90+ (target)
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Location update latency: 1-2s

## 🛠️ Development

### Available Scripts

```bash
npm run dev      # Development server
npm run build    # Production build
npm start        # Start production server
npm run lint     # Run ESLint
```

### Code Quality

- TypeScript strict mode
- ESLint configured
- Prettier recommended
- Component-driven architecture

## 🧪 Testing Checklist

- [ ] Sign up with email
- [ ] Sign in with Google
- [ ] Create family
- [ ] Join family with code
- [ ] Start location sharing
- [ ] View family members
- [ ] Trigger SOS alert
- [ ] Create safe zone
- [ ] Check alerts feed
- [ ] Change theme
- [ ] Sign out

## 🚨 Important Notes

### GPS Accuracy
- Depends on device hardware
- Requires HTTPS in production
- Works best outdoors
- Indoor accuracy may vary

### Browser Compatibility
- Chrome/Edge: Full support
- Safari: Full support (iOS 16.4+)
- Firefox: Full support
- Requires location permissions

### Emergency Features
- SOS alerts family, NOT emergency services
- Always call 911 for real emergencies
- Emergency sessions require consent
- Sessions auto-expire for safety

## 🤝 Contributing

This is a production application. For contributions:

1. Follow existing code style
2. Maintain type safety
3. Test on mobile devices
4. Update documentation
5. Respect privacy principles

## 📄 License

MIT License - See LICENSE file

## 📞 Support

- Privacy: privacy@nofikar.com
- Safety: safety@nofikar.com
- General: support@nofikar.com

## 🙏 Acknowledgments

Built with:
- Next.js by Vercel
- Supabase
- Radix UI
- Tailwind CSS
- OpenStreetMap

---

**NoFikar v2.0.0** — Family safety built on trust and transparency.
