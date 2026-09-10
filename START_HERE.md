# 🚀 START HERE - SafeTrack Setup

Welcome to **SafeTrack** - Your family safety MVP is ready to deploy!

## ⏱️ Time Required: 15-20 minutes

## 📋 What You Need

1. **Node.js 18+** installed on your computer
2. **Supabase account** (free) - https://supabase.com
3. **Two devices** for testing (two phones, or phone + computer)
4. **Vercel account** (free, optional) - for deployment

## 🎯 Quick Start (3 Steps)

### Step 1: Install Dependencies

```bash
npm install
```

⏳ This will take 2-3 minutes

### Step 2: Setup Supabase (5 minutes)

1. **Create project** at https://supabase.com
2. **Run SQL** from `SUPABASE_SETUP.sql` in SQL Editor
3. **Get keys** from Settings → API:
   - Project URL
   - anon/public key
4. **Create `.env.local`** file in project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key_here
```

### Step 3: Run & Test

```bash
npm run dev
```

Open http://localhost:3000

- Tab 1: Child Mode → Start Sharing
- Tab 2: Parent Mode → See live location!

## 📱 Deploy to Production (Optional)

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

You'll get a URL like: `https://safetrack-xxx.vercel.app`

## 📚 Documentation Guide

Depending on your needs, check:

| Document | When to Use |
|----------|-------------|
| **QUICK_START.md** | Fastest path to get running (15 min) |
| **README.md** | Full feature overview & documentation |
| **DEPLOYMENT.md** | Detailed production deployment guide |
| **PROJECT_OVERVIEW.md** | Architecture & technical details |
| **SUPABASE_SETUP.sql** | Database schema (copy & paste) |

## ✅ Success Checklist

Your setup is complete when:

- [ ] `npm run dev` runs without errors
- [ ] Landing page shows at localhost:3000
- [ ] Child Mode can start location sharing
- [ ] Parent Mode displays map
- [ ] Location updates appear in real-time
- [ ] Speed and activity show correctly

## 🆘 Having Issues?

### Can't install packages?
```bash
# Try clearing npm cache
npm cache clean --force
npm install
```

### Location not showing?
- Check `.env.local` exists and has correct values
- Verify Supabase SQL script ran successfully
- Allow location permissions in browser

### Map not loading?
- Check browser console for errors
- Try hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Ensure stable internet connection

### Still stuck?
Check the **Troubleshooting** section in `README.md`

## 🎬 Demo Script

Once deployed, demo it like this:

1. **Open on two phones** using your Vercel URL
2. **Phone 1 (Child):**
   - Open Child Mode
   - Tap "Start Sharing"
   - Allow location permission
   - Show "ACTIVE" status
3. **Phone 2 (Parent):**
   - Open Parent Mode
   - Point out live location on map
   - Walk around with Phone 1
   - Show real-time speed updates
   - Show activity detection
4. **Show privacy:**
   - Tap "Stop Sharing" on Phone 1
   - Show updates stop on Phone 2

## 🎯 Key Features to Demo

- ✅ Real GPS tracking (not fake!)
- ✅ Live map updates (1-2 second delay)
- ✅ Speed detection in km/h
- ✅ Activity classification (Stationary/Walking/Driving)
- ✅ Route trail on map
- ✅ Voluntary sharing (child controls it)
- ✅ Privacy transparency (always visible)

## 💰 Cost

**$0 for MVP testing!** 🎉

- Vercel: Free tier
- Supabase: Free tier (500MB database)
- OpenStreetMap: Free (no API key)

## 🚦 Next Steps

After successful setup:

1. [ ] Test locally with two devices
2. [ ] Deploy to Vercel
3. [ ] Test on mobile phones
4. [ ] Test actual movement (walking/driving)
5. [ ] Share with friends/family
6. [ ] Gather feedback
7. [ ] Plan next features

## 📞 Need More Help?

- **Quick setup:** See `QUICK_START.md`
- **Full docs:** See `README.md`
- **Deploy help:** See `DEPLOYMENT.md`
- **Technical details:** See `PROJECT_OVERVIEW.md`

## 🎉 Ready? Let's Go!

```bash
npm install
```

That's your first command. Follow Step 2 after it completes!

---

**Built with:** Next.js + TypeScript + Supabase + Leaflet

**Time to first demo:** ~15 minutes

**Good luck! 🚀**
