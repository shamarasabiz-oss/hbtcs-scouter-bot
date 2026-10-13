# 🔴 LIVE STREAM SETUP CHECKLIST

**Status: READY FOR LAUNCH**

---

## ✅ BEFORE YOU GO LIVE

### 1. Discord Bot Status
- [ ] Bot is running on Railway (logs show `ScouterBot#6652 — READY`)
- [ ] Bot has Discord token configured
- [ ] Bot has admin permissions in your server
- [ ] TikTok Live connection is initialized

**Test:** Type `!help` in Discord → bot responds with 4 embeds

### 2. Scouter Commands Ready
- [ ] `!profile` - Shows viewer power levels
- [ ] `!leaderboard` - Shows top 10
- [ ] `!trivia` - Starts questions
- [ ] `a/b/c` - Answer trivia (no ! prefix)
- [ ] `!link` - Generates TikTok linking codes
- [ ] `!boost` - Admin power level boost
- [ ] `!pedit` - Admin profile editing
- [ ] `!startlive` - Enable TikTok auto-XP
- [ ] `!endlive` - Disable TikTok auto-XP

**Test:** Run `!startlive` in Discord first

### 3. Leaderboard Overlay Setup
- [ ] Download: `leaderboard-overlay-RESPONSIVE.html`
- [ ] Open in OBS as Browser Source:
  - Width: 1280px (or your stream width)
  - Height: 720px (or your stream height)
  - CSS: Leave blank
  - Refresh: Every second

**OBS Instructions:**
1. Click `+` in Sources
2. Select "Browser"
3. Check "Local file"
4. Browse to: leaderboard-overlay-RESPONSIVE.html
5. Set resolution to match your stream (1920x1080 recommended)
6. Position/scale overlay in your stream preview

### 4. TikTok Live Connection
- [ ] Open Discord
- [ ] Type: `!startlive`
- [ ] Bot responds: "Connected to TikTok Live!"
- [ ] Bot is now tracking: likes, follows, comments, gifts
- [ ] XP auto-awards to commenters

### 5. Account Linking Ready
- [ ] `!link` generates 6-character codes
- [ ] Viewers comment code on your TikTok Live
- [ ] Discord + TikTok accounts merge
- [ ] XP syncs between platforms

---

## 🎬 DURING YOUR LIVESTREAM

### Tier 1: Basic Engagement (Just Start)
✅ Bot running
✅ Commands working
✅ TikTok Live tracking engagement

### Tier 2: Enhanced (Add Overlay)
✅ Leaderboard overlay visible in stream
✅ Shows top 10 fighters
✅ Updates real-time
✅ Activity feed shows gifters

### Tier 3: Full Activation (Maximize XP)
✅ Advertise `!link` command in chat
✅ Encourage comments (comment = +100 XP)
✅ Announce trivia (`!trivia`)
✅ Promote power levels (`!profile`)
✅ Use `!boost` to reward active viewers

---

## 💰 REVENUE ACTIVATION

### During Stream:
1. **Encourage gifts** → Diamonds earned automatically tracked
2. **Promote linking** → `!link` for TikTok → Discord merging
3. **Announce leaderboard** → "See yourself on the leaderboard!"
4. **Celebrate top donors** → Shoutouts boost engagement

### Automated XP Awards:
- ❤️ TikTok Like: +100 XP (auto)
- 👥 TikTok Follow: +2,000 XP (auto)
- 💬 TikTok Comment: +100 XP (auto)
- 💬 Discord Chat: +100 XP (30s cooldown, auto)
- 🎁 TikTok Gift: +varies (auto, based on diamond value)
- 🧠 Trivia Correct: +500-2,500 XP (manual command)
- ⚡ Admin Boost: Custom XP (admin command)

---

## 🚨 IF SOMETHING BREAKS

### Bot Not Responding
1. Check Railway logs: https://railway.app/project/6ff85eda-0e38-4844-a3d4-cd0c2d3520c4
2. Look for RED errors
3. If crashed: GitHub Desktop → Commit → Push → Wait 2-3 mins

### Overlay Not Showing
1. Verify file path in OBS Browser Source
2. Refresh the browser source (right-click → Refresh)
3. Check browser console for errors (F12)
4. Adjust resolution if needed

### Commands Not Working
1. Make sure bot has admin/message permissions
2. Type `!help` to verify bot is online
3. Restart bot on Railway if needed

### TikTok XP Not Awarding
1. Verify `!startlive` was executed
2. Check bot logs for TikTok connection status
3. Make sure viewers are commenting/gifting on @gblilmar Live

---

## 📊 QUICK COMMAND REFERENCE

| Command | Purpose | Result |
|---------|---------|--------|
| `!startlive` | Enable TikTok tracking | Bot connects to TikTok Live |
| `!endlive` | Disable TikTok tracking | Bot disconnects from TikTok |
| `!profile` | Show your stats | Displays XP, rank, followers, gifters |
| `!leaderboard` | Show top 10 | Top 10 fighters by XP |
| `!link` | Get linking code | 6-char code to merge accounts |
| `!trivia` | Start trivia | Question with a/b/c answers |
| `a/b/c` | Answer trivia | Submit answer (no ! prefix) |
| `!boost <user> <xp>` | Boost power | Add XP to any viewer |
| `!pedit <user> <field> <value>` | Edit profile | Change stats manually |
| `!finduser <user>` | Lookup profile | Show user's full stats |
| `!help` | Show commands | Display all help info |

---

## 📢 WHAT TO SAY ON STREAM

**Opening:**
"Hey everyone! The Scouter system is LIVE! Every action earns power levels. Comments = XP, follows = XP, gifts = XP. Check your profile with `!profile` and see yourself on the leaderboard with `!leaderboard`!"

**Mid-Stream:**
"Gifters appearing on the leaderboard in real-time! Top donors are getting boosted! Link your TikTok with `!link` to merge your accounts!"

**Engagement:**
"Comment in the chat = XP! Answer trivia with `!trivia` for bonus power levels! The more you engage, the higher you climb!"

---

## 🎯 SUCCESS METRICS

**You'll know it's working when:**
- ✅ Viewers type commands and get responses
- ✅ Leaderboard shows real-time updates
- ✅ Comments generate XP notifications
- ✅ Gifts show in activity feed
- ✅ Followers gain power levels
- ✅ TikTok accounts link to Discord

---

## 🚀 YOU'RE READY!

Everything is deployed and ready to go:
- ✅ Discord bot online
- ✅ TikTok Live integration enabled
- ✅ Leaderboard overlay responsive
- ✅ Commands functional
- ✅ XP tracking automatic
- ✅ Account linking system ready

**Go make money. Go build your community. Go win.** 🔥

