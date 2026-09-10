# SafeTrack - Quick Start Guide

Get SafeTrack running in 15 minutes! ⏱️

## 📋 Pre-Flight Checklist

Before starting, make sure you have:

- [ ] Node.js 18 or higher installed
- [ ] npm (comes with Node.js)
- [ ] A Supabase account (free)
- [ ] Two devices for testing (2 phones, or phone + computer)

## 🚀 3-Step Setup

### Step 1: Install Dependencies (2 min)

```bash
# In the project directory
npm install
```

### Step 2: Configure Supabase (5 min)

#### A. Create Supabase Project

1. Visit https://supabase.com
2. Sign up or log in
3. Click "New Project"
4. Fill in project details
5. Wait 2-3 minutes for setup

#### B. Run Database Setup

1. In Supabase, go to **SQL Editor**
2. Copy contents from `SUPABASE_SETUP.sql`
3. Paste and click **RUN**
4. ✅ Wait for success message

#### C. Get Your Keys

1. Go to **Settings** → **API**
2. Copy **Project URL**
3. Copy **anon public key**

#### D. Create .env.local

Create a file named `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...your-key
```

Replace with your actual values!

### Step 3: Run & Test (3 min)

```bash
# Start the development server
npm run dev
```

Open http://localhost:3000

#### Test It Works:

1. Open in **two browser tabs**
2. **Tab 1:** Child Mode → Start Sharing → Allow Location
3. **Tab 2:** Parent Mode → See live location! 🎉

## 📱 Deploy to Production (Optional)

### Quick Deploy to Vercel:

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY

# Deploy to production
vercel --prod
```

Done! You'll get a URL like `https://safetrack-xxx.vercel.app`

## 🧪 Testing Checklist

Test these features:

- [ ] Child Mode starts sharing
- [ ] Parent Mode shows location
- [ ] Map displays correctly
- [ ] Speed updates in real-time
- [ ] Activity changes (walk/drive)
- [ ] Trail appears on map
- [ ] Stop sharing works
- [ ] Works on mobile phones

## 🐛 Quick Fixes

### "Location not showing"
- Check `.env.local` has correct Supabase keys
- Verify Supabase table created successfully
- Allow location permissions in browser

### "Map not loading"
- Check browser console for errors
- Try hard refresh (Ctrl+Shift+R)
- Ensure internet connection is stable

### "Realtime not working"
- Verify this SQL ran: `ALTER PUBLICATION supabase_realtime ADD TABLE child_locations;`
- Check Supabase project is active
- Refresh both Child and Parent pages

## 📚 More Help

- Full details: See `README.md`
- Deployment guide: See `DEPLOYMENT.md`
- Database setup: See `SUPABASE_SETUP.sql`

## 🎯 Demo Script

Perfect for showing SafeTrack to others:

1. **Open on two phones** using deployed URL
2. **Phone 1 - Child:**
   - "This is the child's phone"
   - Open Child Mode
   - Start sharing - "Notice it says ACTIVE"
   - "The child always knows sharing is on"
3. **Phone 2 - Parent:**
   - "This is the parent's phone"
   - Open Parent Mode
   - "See the live location on the map"
   - "Watch as I move..." (walk around)
   - "Speed updates in real-time"
   - "Activity detects walking vs driving"
4. **Show privacy:**
   - Back to Phone 1
   - "Child can stop anytime" - tap Stop Sharing
   - Phone 2 - "Updates stop immediately"

## ⏱️ Time Breakdown

- Install dependencies: 2 minutes
- Supabase setup: 5 minutes  
- Local testing: 3 minutes
- Deploy to Vercel: 5 minutes
- **Total: ~15 minutes**

## 🎉 Success!

When you see the location updating on the Parent dashboard, you're done!

**Next Steps:**
- Test with actual movement
- Try the driving detection (>25 km/h)
- Share with family/friends
- Customize for your needs

---

Questions? Check the main README.md or open an issue!
