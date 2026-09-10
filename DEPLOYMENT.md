# SafeTrack Deployment Guide

Complete guide for deploying SafeTrack to production in under 15 minutes.

## Prerequisites Checklist

- [ ] Node.js 18+ installed
- [ ] Supabase account created
- [ ] Vercel account created (or GitHub for auto-deploy)
- [ ] Two phones for testing (or two browser windows)

## Step 1: Supabase Setup (5 minutes)

### 1.1 Create Supabase Project

1. Go to https://supabase.com
2. Click "New Project"
3. Fill in:
   - Name: `safetrack` (or your choice)
   - Database Password: (generate a strong one)
   - Region: Choose closest to your users
4. Click "Create new project"
5. ⏳ Wait 2-3 minutes for provisioning

### 1.2 Create Database Table

1. In your Supabase project, go to **SQL Editor**
2. Click "New Query"
3. Paste and run this SQL:

```sql
-- Create the main tracking table
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

-- Enable Realtime (CRITICAL for live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE child_locations;

-- Add indexes for performance
CREATE INDEX idx_child_locations_child_id ON child_locations(child_id);
CREATE INDEX idx_child_locations_created_at ON child_locations(created_at DESC);

-- Optional: Add row-level security (for production)
ALTER TABLE child_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON child_locations
  FOR SELECT USING (true);

CREATE POLICY "Enable insert access for all users" ON child_locations
  FOR INSERT WITH CHECK (true);
```

4. Click **Run** or press `Ctrl+Enter`
5. ✅ Verify success message appears

### 1.3 Get API Credentials

1. Go to **Project Settings** (gear icon in sidebar)
2. Click **API**
3. Copy these two values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (long string starting with `eyJ...`)

⚠️ **Keep these safe!** You'll need them in the next step.

## Step 2: Local Setup (3 minutes)

### 2.1 Install Dependencies

```bash
npm install
```

This will install:
- Next.js
- React
- Supabase client
- Leaflet
- TypeScript
- Tailwind CSS

### 2.2 Configure Environment

Create `.env.local` in project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...your-key-here
```

Replace with your actual Supabase credentials from Step 1.3.

### 2.3 Test Locally

```bash
npm run dev
```

Open http://localhost:3000

✅ You should see the SafeTrack landing page.

## Step 3: Test on Two Devices (5 minutes)

### Option A: Two Browser Windows (Quick Test)

1. Open `http://localhost:3000` in two windows
2. **Window 1:** Click "Child Mode" → "Start Sharing" → Allow location
3. **Window 2:** Click "Parent Mode" → See location appear

### Option B: Phone + Computer (Better Test)

1. Find your local IP address:

```bash
# Windows
ipconfig

# Mac/Linux
ifconfig
```

2. Look for IPv4 address (e.g., `192.168.1.10`)
3. On your phone, open `http://192.168.1.10:3000`
4. Phone: Enter Child Mode and start sharing
5. Computer: Enter Parent Mode and watch updates

⚠️ **Note:** Both devices must be on the same WiFi network.

## Step 4: Deploy to Vercel (5 minutes)

### Method A: Vercel CLI (Fastest)

1. **Install Vercel CLI:**

```bash
npm i -g vercel
```

2. **Login:**

```bash
vercel login
```

3. **Deploy:**

```bash
vercel
```

Answer the prompts:
- Set up and deploy? **Y**
- Which scope? (choose your account)
- Link to existing project? **N**
- Project name? `safetrack` (or your choice)
- Directory? `./` (press Enter)
- Override settings? **N**

4. **Add environment variables:**

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
# Paste your Supabase URL, press Enter

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
# Paste your Supabase anon key, press Enter
```

5. **Deploy to production:**

```bash
vercel --prod
```

✅ You'll get a production URL like `https://safetrack-xxx.vercel.app`

### Method B: GitHub + Vercel (Automatic Deploys)

1. **Push to GitHub:**

```bash
git init
git add .
git commit -m "Initial SafeTrack deployment"
git branch -M main
git remote add origin https://github.com/yourusername/safetrack.git
git push -u origin main
```

2. **Connect to Vercel:**
   - Go to https://vercel.com
   - Click "New Project"
   - Import your GitHub repository
   - Click "Deploy"

3. **Add environment variables:**
   - In Vercel project settings
   - Go to "Environment Variables"
   - Add:
     - `NEXT_PUBLIC_SUPABASE_URL` = `your_url`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `your_key`
   - Click "Redeploy" to apply changes

## Step 5: Production Testing (2 minutes)

### Test on Two Phones

1. Open your Vercel URL on both phones
2. **Phone 1 (Child):**
   - Tap "Child Mode"
   - Tap "Start Sharing"
   - Allow location when prompted
   - ✅ Should show "ACTIVE" status

3. **Phone 2 (Parent):**
   - Tap "Parent Mode"
   - ✅ Should see child's location on map
   - ✅ Should see speed and activity
   - ✅ Updates should appear in real-time

### Test Driving Detection

1. Keep Child Mode active
2. Start moving (walk, drive, etc.)
3. Parent should see:
   - Speed updating
   - Activity changing (Stationary → Walking → Driving)
   - Trail appearing on map

## Common Issues & Solutions

### ❌ "Location not updating"

**Possible causes:**
- Environment variables not set
- Supabase Realtime not enabled
- Location permissions denied

**Solutions:**
1. Check Vercel environment variables
2. Verify Realtime SQL command ran successfully
3. Check browser console for errors
4. Try in Chrome (best GPS support)

### ❌ "Map not loading"

**Possible causes:**
- Leaflet CSS not loaded
- OpenStreetMap tiles blocked
- JavaScript errors

**Solutions:**
1. Check browser console for errors
2. Verify network tab shows tiles loading
3. Try hard refresh (Ctrl+Shift+R)

### ❌ "Realtime not working"

**Possible causes:**
- Table not added to Realtime publication
- Supabase connection error

**Solutions:**
1. Re-run the Realtime SQL command:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE child_locations;
```
2. Check Supabase dashboard for connection status
3. Verify anon key is correct

### ❌ "HTTPS required for geolocation"

**Cause:** Modern browsers require HTTPS for geolocation API

**Solution:**
- Use Vercel deployment (automatic HTTPS)
- For local testing, use `localhost` (allowed without HTTPS)
- Don't use local IP over HTTP in production

## Performance Optimization

### For Production Use

1. **Add rate limiting** to prevent excessive DB writes
2. **Clean old locations** with a scheduled function:

```sql
-- Delete locations older than 24 hours
DELETE FROM child_locations 
WHERE created_at < NOW() - INTERVAL '24 hours';
```

3. **Add caching** for parent dashboard
4. **Implement authentication** for real families

## Security Considerations

### Current Setup (MVP)
- ✅ Uses demo family ID
- ✅ RLS policies enabled
- ⚠️ No user authentication

### For Production
- Add Supabase Auth
- Implement family/group management
- Add proper RLS policies per family
- Rate limit location updates
- Add location history retention policies

## Cost Estimate (Free Tier)

- **Vercel:** Free (hobby plan)
- **Supabase:** Free up to:
  - 500MB database
  - 2GB bandwidth/month
  - 50,000 monthly active users
- **OpenStreetMap:** Free (no API key needed)

**Total: $0/month** for MVP testing! 🎉

## Next Steps

After successful deployment:

1. [ ] Test with real movement
2. [ ] Share URL with test users
3. [ ] Gather feedback
4. [ ] Add authentication (if needed)
5. [ ] Implement family management
6. [ ] Add notification features
7. [ ] Create app store listing

## Support

Stuck? Check:
1. README.md for general info
2. Browser console for errors
3. Supabase logs
4. Vercel deployment logs

---

🎉 **Congratulations!** You've deployed SafeTrack!

Time to demo: Open the URL on two phones and watch the magic happen!
