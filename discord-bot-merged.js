import 'dotenv/config.js';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { TikTokLive } from '@tiktool/live';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { google } from 'googleapis';
import Stripe from 'stripe';
// Kick integration - using custom WebSocket connection instead of broken library
import { WebSocket as WSLib } from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import readline from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);



const API_KEY   = 'tk_8f99451968a57ef6230ae3d85ff249ef7d3f23358b5fbd6a';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'YOUR_DISCORD_BOT_TOKEN';

// Guards the /admin and /test routes now that this can run 24/7 on the open
// internet. Set a real value via the ADMIN_KEY environment variable on
// whatever host you deploy to — don't leave the default in production.
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-now';
const USERNAME  = 'gblilmar';           // ← your TikTok @

// ── MULTISTREAM CONFIG ─────────────────────────────────────────────────────
// YouTube: Use your channel handle (the @name you chose, e.g., '@gblimar')
// Set YOUTUBE_API_KEY env var with your Google Cloud API key
// Facebook: Not yet implemented
const MULTISTREAM = {
  tiktok:  'gblilmar',    // TikTok @handle
  kick:    '',            // Kick username ('' to disable) - Cloudflare blocks Node.js connections to Pusher
  twitch:  'gblilmar5',   // Twitch username ('' to disable)
  youtube: '@hbtcdbz',    // YouTube @handle for live chat ('' to disable)
  facebook:'',            // Facebook page (not yet implemented)
};

// Hardcoded Kick IDs (bypasses Cloudflare block on API)
const KICK_IDS = {
  'gblilmarr': { chatroom_id: 111341582, channel_id: 111631094 }
};
const SAVE_FILE    = join(__dirname, 'rankings-save.json');
const DB_SAVE_FILE = join(__dirname, 'dbstate-save.json');
const GIFT_GOAL       = 15000;                           // diamonds to unlock ball 7 (~$75 to me at ~$0.005/diamond)
const BALL_THRESHOLDS = [15000, 35000, 60000, 85000, 110000, 140000]; // likes to unlock balls 1-6

// ── RANKS ──────────────────────────────────────────────────────────────────
// Ranks 0-7 are the base climb. At 335,000 (SS Blue maxed) a player picks a
// path once — !ssbe or !uisign in chat — and that choice carries them
// through BOTH fork levels below. Vegeta's road: SSBE → Ultra Ego.
// Goku's road: UI Sign → Mastered UI. Same XP requirement either way, pure
// power parity — the fork is about identity, not strength. Both roads
// reconverge into one shared cosmic ladder at God of Destruction, since
// beyond that point you're not fighting as a Saiyan anymore. Omni-King is
// the literal ceiling of the DB universe — nothing named goes above him,
// XP just keeps counting from there.
const RANKS = [
  { id:0,  name:'Low-Class Warrior',       short:'LOW CLASS', xp:0,         color:'#FFFFFF', aura:'#BBBBBB', emoji:'💩' },
  { id:1,  name:'Elite Warrior',           short:'ELITE',     xp:2500,      color:'#C0A060', aura:'#A08040', emoji:'⚔️' },
  { id:2,  name:'Super Saiyan',            short:'SSJ',       xp:10000,     color:'#FFD700', aura:'#FFAA00', emoji:'⚡' },
  { id:3,  name:'Super Saiyan 2',          short:'SSJ2',      xp:26000,     color:'#FFE840', aura:'#88CCFF', emoji:'⚡⚡' },
  { id:4,  name:'Super Saiyan 3',          short:'SSJ3',      xp:58000,     color:'#FFD700', aura:'#FFFF88', emoji:'💥' },
  { id:5,  name:'Super Saiyan 4',          short:'SSJ4',      xp:115000,    color:'#CC2200', aura:'#FF4400', emoji:'🔴' },
  { id:6,  name:'Super Saiyan God',        short:'SS GOD',    xp:205000,    color:'#FF2255', aura:'#FF0044', emoji:'🔥' },
  { id:7,  name:'Super Saiyan Blue',       short:'SS BLUE',   xp:335000,    color:'#44AAFF', aura:'#0066FF', emoji:'💠' },
  // ── FORK 1 — same id, same xp, pick a road (!ssbe / !uisign) ──
  { id:8,  name:'Super Saiyan Blue Evolved', short:'SSBE',    xp:520000,    color:'#5C6BFF', aura:'#8A4DFF', emoji:'💠', path:'ssbe'   },
  { id:8,  name:'Ultra Instinct Sign',       short:'UI SIGN', xp:520000,    color:'#3AA0FF', aura:'#0A1633', emoji:'🌀', path:'uisign', style:'uisign' },
  // ── FORK 2 — the same road continues, equal power either way ──
  { id:9,  name:'Ultra Ego',               short:'ULTRA EGO', xp:900000,   color:'#C04CFF', aura:'#4A0080', emoji:'😈', path:'ssbe'   },
  { id:9,  name:'Mastered Ultra Instinct', short:'MUI',        xp:900000,   color:'#FFFFFF', aura:'#DDE8FF', emoji:'🔱', path:'uisign', pulse:true, style:'mui' },
  // ── reconverged — cosmic hierarchy from here, one shared ladder ──
  { id:10, name:'God of Destruction',      short:'DESTROYER', xp:2200000,   color:'#A020F0', aura:'#1A0033', emoji:'💜', pulse:true, style:'destroyer' },
  { id:11, name:'Angel',                   short:'ANGEL',     xp:4200000,   color:'#8FD4FF', aura:'#4AA8E0', emoji:'😇', pulse:true, style:'angel' },
  { id:12, name:'Omni-King',               short:'OMNI KING', xp:7500000,   color:'#FFD700', aura:'#FFFFFF', emoji:'👑', exclusive:true, rainbow:true },
];

const MAX_RANK_ID = Math.max(...RANKS.map(r => r.id)); // 12 — Omni-King

// Ids 8 and 9 each have TWO entries. FORK_PENDING is a template, not a
// fixed rank — id/xp get overridden per use so it works at either fork.
const FORK_PENDING = { name: 'Choose Your Path', short: 'AWAITING PATH',
                        color: '#9090B0', aura: '#666688', emoji: '⚔️', pending: true };

// Resolves the exact rank object for a given id — path-aware at ANY fork
// point, not hardcoded to a specific id. If they haven't chosen yet and
// this id happens to be forked, returns the pending placeholder instead of
// quietly picking one for them.
function rankFor(id, pathChoice) {
  const matches = RANKS.filter(r => r.id === id);
  if (matches.length === 1) return matches[0];
  if (pathChoice) return matches.find(r => r.path === pathChoice) || matches[0];
  return { ...FORK_PENDING, id, xp: matches[0].xp };
}

// Handles any number of sequential fork points generically — no hardcoded
// thresholds. Walks the ladder in order; whenever it hits a forked entry,
// only takes it if it matches their chosen path (or shows "pending" if they
// haven't chosen). Once it reaches non-forked entries again, resolves
// normally regardless of path — that's the natural reconvergence point.
// exclusive ranks (Omni-King) can NEVER be earned individually just by XP —
// only getLeaderboard() can assign one, to whoever is actually #1 right now.
function getRank(xp, pathChoice) {
  let r = RANKS[0];
  for (const rank of RANKS) {
    if (xp < rank.xp) continue;
    if (rank.exclusive) continue;
    if (rank.path) {
      if (pathChoice) {
        if (rank.path === pathChoice) r = rank;
        // else: not their road, skip without overwriting r
      } else {
        r = { ...FORK_PENDING, id: rank.id, xp: rank.xp };
      }
    } else {
      r = rank;
    }
  }
  return r;
}

// Correct "what rank comes next" using ID order, not array position — the
// fork means array index and rank id are no longer the same thing past
// Super Saiyan Blue. Handles both directions around the fork specially.
function nextRankAfter(id, pathChoice) {
  const ids = [...new Set(RANKS.map(r => r.id))].sort((a, b) => a - b);
  const idx = ids.indexOf(id);
  const nextId = ids[Math.min(idx + 1, ids.length - 1)];
  return rankFor(nextId, pathChoice); // rankFor already returns FORK_PENDING when unresolved
}

// ── XP RATES ───────────────────────────────────────────────────────────────
// Stripe config
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const XP_RATES = { 
  chat: 100, 
  like: 1, 
  follow: 2000, 
  share: 50, 
  member: 50,
  STRIPE_MULTIPLIER: 1.5  // 1.5x XP bonus for donations
};

function calcGiftXP(diamondCount, repeatCount) {
  let xpPerDiamond;
  if      (diamondCount >= 5000) xpPerDiamond = 300;
  else if (diamondCount >= 1000) xpPerDiamond = 150;
  else if (diamondCount >=  200) xpPerDiamond = 80;
  else if (diamondCount >=   50) xpPerDiamond = 40;
  else if (diamondCount >=   10) xpPerDiamond = 20;
  else if (diamondCount >=    2) xpPerDiamond = 10;
  else                           xpPerDiamond = 5;
  return Math.round(diamondCount * (repeatCount || 1) * xpPerDiamond);
}

// ── UNIFIED CROSS-PLATFORM ECONOMY ──────────────────────────────────────────
// TikTok diamonds, Twitch bits, and Twitch/Kick dollars all convert through
// ONE formula so a dollar is worth the same XP no matter where it lands.
// 1 diamond ≈ 1 bit ≈ 1 cent, so cents plug straight into calcGiftXP.
function dollarsToXP(dollars) {
  const cents = Math.round(dollars * 100);
  return calcGiftXP(cents, 1);
}

// Retail sub prices, same on Twitch and Kick
const SUB_TIER_USD = { 1: 4.99, 2: 9.99, 3: 24.99 };
const RESUB_MULT    = 0.6; // loyalty still counts, just not double-dipped every month

// ── PERSISTENCE ────────────────────────────────────────────────────────────
let users = {};
let linkMap   = {};   // { rawPlatformId: canonicalId } — persisted
let triviaCooldowns = {}; // { userId: lastAnswerTime }
const TRIVIA_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
let linkCodes = {};   // { code: {...} } — in-memory only, expires, never saved

// Daily community stats
let dailyStats = {
  date: new Date().toLocaleDateString(),
  mvp: null,          // { name, xp } - Most XP gained yesterday
  topGifter: null,    // { name, value, coins } - Highest gift value (TikTok coins + Stripe)
  topFollower: null,  // { name, follows } - Most follows
  topChatter: null,   // { name, messages } - Most messages
  newUsers: [],       // Users joined today
  totalXpGained: 0,
  totalGiftValue: 0,  // Total gift value (coins + donations)
  totalFollows: 0,
  totalChats: 0,
};

// BACKUP: Before loading, save the current data if it exists
const BACKUP_FILE = join(__dirname, 'rankings-backup.json');
if (existsSync(SAVE_FILE)) {
  try {
    const current = readFileSync(SAVE_FILE, 'utf8');
    writeFileSync(BACKUP_FILE, current);
  } catch (e) {}
}

if (existsSync(SAVE_FILE)) {
  try {
    const saved = JSON.parse(readFileSync(SAVE_FILE, 'utf8'));
    users = saved.users || {};
    linkMap = saved.linkMap || {};
    // Re-derive every rankId from XP against the CURRENT thresholds.
    // Without this, stale rankIds from older threshold tables block rank-up events.
    let fixed = 0;
    for (const u of Object.values(users)) {
      const correct = getRank(u.xp || 0, u.pathChoice).id;
      if (u.rankId !== correct) { u.rankId = correct; fixed++; }
    }
    console.log(`📂 Loaded ${Object.keys(users).length} users from rankings-save.json`);
    if (fixed) console.log(`🔧 Re-synced ${fixed} rank${fixed === 1 ? '' : 's'} to current thresholds`);
  } catch (e) {
    console.log('⚠️  Could not load save file:', e.message);
    // RECOVERY: Try to load from backup if main file is corrupted
    if (existsSync(BACKUP_FILE)) {
      try {
        const backup = JSON.parse(readFileSync(BACKUP_FILE, 'utf8'));
        users = backup.users || {};
        linkMap = backup.linkMap || {};
        console.log(`✅ Recovered from backup! Loaded ${Object.keys(users).length} users`);
      } catch (e2) {
        console.log('⚠️  Backup also failed, starting fresh');
      }
    }
  }
}

function saveState() {
  try { 
    writeFileSync(SAVE_FILE, JSON.stringify({ users, linkMap, savedAt: Date.now() }, null, 2));
    // Also try to save timestamped backup every hour (if backups dir exists)
    const now = new Date();
    const backupDir = join(__dirname, 'backups');
    if (existsSync(backupDir)) {
      const timestamp = now.toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + Math.floor(Date.now() / 3600000);
      const backupPath = join(backupDir, `rankings-${timestamp}.json`);
      try {
        if (!existsSync(backupPath)) {
          writeFileSync(backupPath, JSON.stringify({ users, linkMap, savedAt: Date.now() }, null, 2));
        }
      } catch (backupErr) {
        // Backup failed, but main save succeeded - that's ok
      }
    }
  }
  catch (e) { console.error('Save error:', e.message); }
}
setInterval(saveState, 3000);

// Reset daily stats at midnight
function resetDailyStats() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  const timeUntilMidnight = tomorrow - now;
  setTimeout(() => {
    // Reset individual user daily stats
    Object.values(users).forEach(u => {
      u.dailyXpGained = 0;
      u.dailyGiftValue = 0;  // Changed from dailyGifts to dailyGiftValue
      u.dailyFollows = 0;
      u.dailyChats = 0;
    });
    
    // Reset community daily stats
    dailyStats = {
      date: new Date().toLocaleDateString(),
      mvp: null,
      topGifter: null,
      topFollower: null,
      topChatter: null,
      newUsers: [],
      totalXpGained: 0,
      totalGiftValue: 0,  // Changed from totalGiftsGiven
      totalFollows: 0,
      totalChats: 0,
    };
    
    console.log('🌅 Daily stats reset at midnight');
    resetDailyStats(); // Schedule next reset
  }, timeUntilMidnight);
}
resetDailyStats();

// ── LEADERBOARD ────────────────────────────────────────────────────────────

// ── BATTLE / RIVALRY DETECTION ─────────────────────────────────────────────
const BATTLE = {
  enabled:     true,
  gapPct:      0.05,        // contenders within 5% of the cluster leader
  minXp:       2500,        // ignore anyone below ELITE
  activeMs:    90 * 1000,   // must have acted in the last 90s — no MIA fighters get pulled in
  cooldownMs:  15 * 60_000, // don't re-fire for 15 min
  displayMs:   15_000,      // banner auto-dismiss
  followersOnly: false,   // toggle with: war followers on|off
};
let pendingReset   = null;
let lastBattleAt   = 0;
let lastBattleKey  = '';
let lastBattleLead = '';

// Find the largest cluster of active, close-in-power users.
function findBattle() {
  if (!BATTLE.enabled) return null;
  const now = Date.now();

  const pool = Object.values(users)
    .filter(u => u.xp >= BATTLE.minXp)
    .filter(u => (now - (u.lastActive || 0)) < BATTLE.activeMs)
    .filter(u => !BATTLE.followersOnly || u.follows > 0 || u.isFollower)
    .sort((a, b) => b.xp - a.xp);

  if (pool.length < 2) return null;

  let best = null;
  for (let i = 0; i < pool.length - 1; i++) {
    const lead = pool[i];
    const group = [lead];
    for (let j = i + 1; j < pool.length; j++) {
      if ((lead.xp - pool[j].xp) / lead.xp <= BATTLE.gapPct) group.push(pool[j]);
      else break;
    }
    if (group.length >= 2 && (!best || group.length > best.length)) best = group;
    if (best && best.length >= 5) break;
  }
  if (!best) return null;

  const top       = best[0];
  const bottom    = best[best.length - 1];
  const contested = getRank(top.xp);
  const nextRank  = nextRankAfter(contested.id);

  return {
    kind: best.length === 2 ? 'duel' : best.length === 3 ? 'struggle' : 'war',
    contenders: best.slice(0, 4).map(u => ({ id: u.id, name: u.name, xp: u.xp })),
    extra:    Math.max(0, best.length - 4),
    total:    best.length,
    spread:   top.xp - bottom.xp,
    rank:     contested.short,
    rankColor: contested.color,
    nextRank: nextRank.short,
    nextXp:   nextRank.xp,
    leader:   top.name,
    key:      best.map(u => u.id).sort().join('|'),
  };
}


// ── RACE ENGINE ────────────────────────────────────────────────────────────
// A battle promotes into a RACE: everyone sprints to a target XP.
// Winner is announced. Anyone who goes quiet is called out as a quitter.
const RACE = {
  quitMs:    5 * 60_000,   // inactive this long during a race = tapout warning
  graceMs:       60_000,   // 60s countdown to get back in before it's final
  maxMs:     10 * 60_000,  // race expires if nobody wins
  stallMs:    4 * 60_000,  // no XP movement at all for this long = end it
  minSprint:   1000,       // floor so even low-tier races are a real climb
  // ── RACE DISTANCE ── scales with the leader's own XP, not a flat number.
  // A flat sprint that felt fair at 5,000 XP is nothing at 3,000,000 — this
  // keeps every race roughly the same PROPORTIONAL effort at any tier.
  sprintPct:   0.08,       // ~8% of the leader's current XP
  // ── STAKES ── scaled off the sprint size itself, so they carry real
  // weight at every tier instead of being flat numbers that mean less and
  // less the higher someone climbs.
  winBonusPct: 0.50,       // winner nets an extra 50% of the sprint on top
  loserPenPct: 0.18,       // stayed and lost — real cost now, not free
  quitPenPct:  0.35,       // quitting/not showing up costs the most, by design
  neverDemote: false,      // losing enough, repeatedly, CAN drop you a rank
};

function calcSprint(leaderXp) {
  return Math.max(RACE.minSprint, Math.round(leaderXp * RACE.sprintPct));
}
let race = null;

function startRace(b) {
  if (race) return;
  const leadXp  = b.contenders[0].xp;
  const sprint  = calcSprint(leadXp);
  // Finish line scales with the leader's own XP — a real, proportional
  // climb at any tier. If the next rank happens to land closer than the
  // sprint would, use that instead so a race can double as a real
  // transformation instead of overshooting past it.
  let target = leadXp + sprint;
  if (b.nextXp > leadXp && b.nextXp < target) target = b.nextXp;

  race = {
    target,
    sprint,                      // stakes are calculated off THIS, not a live recalculation
    targetRank: b.nextRank,
    rank:       b.rank,
    kind:       b.kind,          // duel | struggle | war — drives the HUD colors
    startedAt:  Date.now(),
    lastMove:   Date.now(),
    contenders: b.contenders.map(c => ({
      id: c.id, name: c.name, startXp: c.xp, xp: c.xp, quit: false,
    })),
  };
  console.log(`🏁 RACE STARTED — ${race.contenders.length} racing to ${target.toLocaleString()} XP (${race.targetRank})`);
  send(wssLB, { type: 'raceStart', ...racePayload() });
}

function racePayload() {
  if (!race) return null;
  const now = Date.now();
  // Progress is measured across the SPRINT, not from zero — otherwise everyone
  // starts the bar ~95% full and it looks like nothing is moving.
  const floor = Math.min(...race.contenders.map(c => c.startXp));
  const span  = Math.max(1, race.target - floor);
  const runners = race.contenders.map(c => ({
    id: c.id, name: c.name, xp: c.xp, quit: c.quit,
    warning: !!c.warnAt && !c.quit,
    secsLeft: c.warnAt ? Math.max(0, Math.ceil((c.warnAt + RACE.graceMs - now) / 1000)) : null,
    pct: Math.max(0, Math.min(100, Math.round(((c.xp - floor) / span) * 100))),
    need: Math.max(0, race.target - c.xp),
  })).sort((a, b) => (a.quit - b.quit) || (b.xp - a.xp));
  return {
    target: race.target, targetRank: race.targetRank, rank: race.rank,
    kind: race.kind || 'war',
    runners, alive: runners.filter(r => !r.quit).length,
  };
}

function raceTick() {
  if (!race) return;
  const now = Date.now();

  // Sync XP + detect quitters
  let changed = false;
  for (const c of race.contenders) {
    const u = users[c.id];
    if (!u) continue;
    if (u.xp !== c.xp) { c.xp = u.xp; changed = true; race.lastMove = now; }
    const idle = now - (u.lastActive || 0);

    // Came back during the grace window — saved
    if (c.warnAt && idle < RACE.quitMs) {
      c.warnAt = null; changed = true;
      console.log(`🛟 SAVED — ${c.name} got back in before the timer`);
      send(wssLB, { type: 'raceSaved', name: c.name, id: c.id, ...racePayload() });
    }
    // Gone quiet — start the 60s countdown
    else if (!c.quit && !c.warnAt && idle > RACE.quitMs) {
      c.warnAt = now; changed = true;
      console.log(`⏳ ${c.name} idle — ${RACE.graceMs / 1000}s to get back in`);
      send(wssLB, { type: 'raceWarn', name: c.name, id: c.id,
                    secs: RACE.graceMs / 1000, ...racePayload() });
    }
    // Countdown expired — tapout is final
    else if (c.warnAt && (now - c.warnAt) > RACE.graceMs) {
      c.quit = true; c.warnAt = null; changed = true;
      console.log(`🚪 TAPOUT — ${c.name} never came back`);
      send(wssLB, { type: 'raceQuit', name: c.name, id: c.id, ...racePayload() });
      // If that leaves a single racer, let the tapout banner breathe first
      if (race.contenders.filter(x => !x.quit).length === 1) race.pendingWalkoverAt = now;
    }
  }

  // Give the tapout callout a beat to play before declaring a walkover
  if (race.pendingWalkoverAt && now - race.pendingWalkoverAt < 4000) return;

  // Winner? Either someone crossed the line, OR everyone else tapped out
  // and only one racer is left standing (walkover).
  const alive = race.contenders.filter(c => !c.quit);
  let winner = alive.filter(c => c.xp >= race.target).sort((a, b) => b.xp - a.xp)[0];
  let walkover = false;
  if (!winner && alive.length === 1 && race.contenders.length >= 2) {
    winner = alive[0];
    walkover = true;
    console.log(`🏳️  WALKOVER — everyone else tapped out, ${winner.name} takes it`);
  }
  if (winner) {
    const beat = race.contenders.filter(c => c.id !== winner.id);
    const runnerUp = beat.filter(c => !c.quit).sort((a,b)=>b.xp-a.xp)[0];

    // ── STAKES: winner gains real weight, quitters and losers pay for it ──
    // Everything scales off the sprint that was announced at race start —
    // significant at every tier, not a flat number that stops mattering
    // once someone's past the early ranks.
    const bonus = Math.round(race.sprint * RACE.winBonusPct);
    const wu = users[winner.id];
    if (wu) {
      wu.xp += bonus; wu.rankId = getRank(wu.xp, wu.pathChoice).id;
      wu.wins   = (wu.wins || 0) + 1;
      wu.streak = (wu.streak || 0) + 1;
      if (wu.streak > (wu.bestStreak || 0)) wu.bestStreak = wu.streak;
    }

    const penalties = [];
    for (const c of beat) {
      const u = users[c.id];
      if (!u) continue;
      // Record the loss / tapout
      u.losses = (u.losses || 0) + 1;
      u.streak = 0;
      if (c.quit) u.tapouts = (u.tapouts || 0) + 1;

      const pen = Math.round(race.sprint * (c.quit ? RACE.quitPenPct : RACE.loserPenPct));
      const before   = u.xp;
      const oldRank  = getRank(before, u.pathChoice);
      // With neverDemote off (the default now), this genuinely can drop
      // below the current rank's floor — repeated losses are how someone
      // actually falls a tier, which is the point.
      const floor    = RACE.neverDemote ? oldRank.xp : 0;
      u.xp = Math.max(floor, u.xp - pen);
      const newRankAfter = getRank(u.xp, u.pathChoice);
      u.rankId = newRankAfter.id;
      const lost = before - u.xp;
      const demoted = newRankAfter.id < oldRank.id ? newRankAfter.short : null;
      if (demoted) {
        console.log(`   ⬇️  ${c.name} DEMOTED — ${oldRank.short} → ${newRankAfter.short}`);
        send(wssLB, { type: 'rankdown', userId: u.id, name: c.name,
          oldRank: { id: oldRank.id, short: oldRank.short },
          newRank: { id: newRankAfter.id, short: newRankAfter.short, color: newRankAfter.color, aura: newRankAfter.aura } });
      }
      penalties.push({ name: c.name, lost, quit: c.quit, demoted,
                       record: `${u.wins||0}-${u.losses||0}` });
    }

    console.log(`🏆 RACE WON — ${winner.name} hit ${race.target.toLocaleString()} XP (${race.targetRank})`);
    console.log(`   🎁 +${bonus.toLocaleString()} XP bonus`);
    penalties.forEach(p => console.log(`   💀 ${p.name} −${p.lost.toLocaleString()} XP${p.quit ? ' (quit)' : ''}`));

    saveState();
    send(wssLB, {
      type: 'raceWin', name: winner.name, id: winner.id,
      walkover,
      record: wu ? `${wu.wins}-${wu.losses}` : null,
      streak: wu ? wu.streak : 0,
      target: race.target, targetRank: race.targetRank,
      gained: winner.xp - winner.startXp,
      bonus,
      margin: runnerUp ? winner.xp - runnerUp.xp : 0,
      runnerUp: runnerUp ? runnerUp.name : null,
      quitters: beat.filter(c => c.quit).map(c => c.name),
      penalties,
    });
    race = null;
    lastBattleAt = Date.now();
    debouncedPush();
    return;
  }

  // Everyone bailed
  if (race.contenders.every(c => c.quit)) {
    console.log('🏁 Race ended — everyone quit');
    send(wssLB, { type: 'raceEnd', reason: 'quit' });
    race = null; return;
  }

  // Stalled — nobody has moved in a while, quietly end it
  if (now - (race.lastMove || race.startedAt) > RACE.stallMs) {
    console.log('🏁 Race ended — stalled, no XP movement');
    send(wssLB, { type: 'raceEnd', reason: 'stalled' });
    race = null; return;
  }

  // Timed out
  if (now - race.startedAt > RACE.maxMs) {
    const lead = race.contenders.filter(c=>!c.quit).sort((a,b)=>b.xp-a.xp)[0];
    console.log(`🏁 Race expired — ${lead ? lead.name + ' led' : 'no leader'}`);
    send(wssLB, { type: 'raceEnd', reason: 'expired', leader: lead ? lead.name : null });
    race = null; return;
  }

  if (changed) send(wssLB, { type: 'raceUpdate', ...racePayload() });
}
setInterval(raceTick, 2000);

// Periodic reminder while a race is live
setInterval(() => {
  if (race) send(wssLB, { type: 'raceRemind', ...racePayload() });
}, 45000);

// Heartbeat every 10s so the overlay knows a race is genuinely still running.
// If these stop arriving (server restart, crash), the overlay hides the HUD itself.
setInterval(() => {
  if (race) send(wssLB, { type: 'raceAlive' });
}, 10000);

function maybeBattle() {
  const b = findBattle();
  if (!b) return;
  const now = Date.now();

  const samePack   = b.key === lastBattleKey;
  const leadFlip   = samePack && b.leader !== lastBattleLead;
  const cooledDown = (now - lastBattleAt) > BATTLE.cooldownMs;

  // Fire on: brand new pack, cooldown elapsed, or the lead changing hands
  if (!(leadFlip || cooledDown || !samePack)) return;

  lastBattleAt   = now;
  lastBattleKey  = b.key;
  lastBattleLead = b.leader;

  // A race already communicates the rivalry — don't double up with a battle banner.
  // Lead changes still fire, because that's the moment worth interrupting for.
  if (race && !leadFlip) return;

  console.log(`⚔️  ${b.kind.toUpperCase()} — ${b.total} contenders for ${b.rank} (spread ${b.spread.toLocaleString()})${leadFlip ? ' [LEAD CHANGE]' : ''}`);
  send(wssLB, { type: 'battle', ...b, leadChange: leadFlip, displayMs: BATTLE.displayMs });
  startRace(b);
}

// Tracks who currently holds Omni-King so we can detect when the title
// changes hands and fire a dethroning celebration instead of a quiet swap.
let omniKingId = null;
const OMNI_KING_RANK = RANKS.find(r => r.exclusive);

// ── TRIVIA SYSTEM ──────────────────────────────────────────────────────────
// Massive Dragon Ball Trivia Database (1200+ questions)
const TRIVIA_QUESTIONS = {
  easy: [
    { q: "What's Goku's signature finishing move?", opts: ['Kamehameha', 'Destructo Disc', 'Spirit Bomb'], ans: 'Kamehameha' },
    { q: "What is Goku's birth name?", opts: ['Kakarot', 'Sun Wukong', 'Gohan'], ans: 'Kakarot' },
    { q: "What color is Goku's gi?", opts: ['Red', 'Blue', 'White'], ans: 'Red' },
    { q: "Who trained Goku as a child?", opts: ['Master Roshi', 'Gohan', 'Krillin'], ans: 'Master Roshi' },
    { q: "What is Goku's favorite food?", opts: ['Meat', 'Rice', 'Noodles'], ans: 'Meat' },
    { q: "What planet are Saiyans from?", opts: ['Planet Vegeta', 'Planet Saiyan', 'Planet Earth'], ans: 'Planet Vegeta' },
    { q: "What color hair does Goku have as a Super Saiyan?", opts: ['Yellow', 'Blue', 'Gold'], ans: 'Yellow' },
    { q: "Does Goku like fighting?", opts: ['Yes, it\'s his passion', 'No', 'Sometimes'], ans: 'Yes, it\'s his passion' },
    { q: "Who is Goku's best friend?", opts: ['Krillin', 'Vegeta', 'Piccolo'], ans: 'Krillin' },
    { q: "Who is Goku's wife?", opts: ['Chi-Chi', 'Bulma', 'Launch'], ans: 'Chi-Chi' },
    { q: "What is Vegeta's title?", opts: ['Prince of all Saiyans', 'King', 'Emperor'], ans: 'Prince of all Saiyans' },
    { q: "What is Vegeta's power-up attack?", opts: ['Galick Gun', 'Final Flash', 'Big Bang Attack'], ans: 'Galick Gun' },
    { q: "Who is Vegeta's wife?", opts: ['Bulma', 'Chi-Chi', 'Android 18'], ans: 'Bulma' },
    { q: "What race is Piccolo?", opts: ['Namekian', 'Human', 'Demon'], ans: 'Namekian' },
    { q: "What is Piccolo's main technique?", opts: ['Special Beam Cannon', 'Destructo Disc', 'Kamehameha'], ans: 'Special Beam Cannon' },
    { q: "Who does Piccolo train?", opts: ['Gohan', 'Krillin', 'Goku'], ans: 'Gohan' },
    { q: "Who is Gohan's father?", opts: ['Goku', 'Vegeta', 'Raditz'], ans: 'Goku' },
    { q: "Who is Gohan's mother?", opts: ['Chi-Chi', 'Bulma', 'Launch'], ans: 'Chi-Chi' },
    { q: "How many Dragon Balls are there?", opts: ['7', '8', '6'], ans: '7' },
    { q: "What do Dragon Balls do?", opts: ['Grant wishes via Shenron', 'Teleport', 'Give power'], ans: 'Grant wishes via Shenron' },
    { q: "What color are the Dragon Balls?", opts: ['Orange with stars', 'Red', 'Gold'], ans: 'Orange with stars' },
    { q: "Who is Shenron?", opts: ['The Eternal Dragon', 'A warrior', 'A deity'], ans: 'The Eternal Dragon' },
    { q: "What is Ki?", opts: ['Life energy/Power', 'Spirit', 'Soul'], ans: 'Life energy/Power' },
    { q: "What is a Zeni?", opts: ['Dragon Ball currency', 'Power unit', 'Planet'], ans: 'Dragon Ball currency' },
    { q: "Who is the Omni-King?", opts: ['Zeno', 'Supreme Kai', 'Beerus'], ans: 'Zeno' },
    { q: "How do Saiyans transform into Great Apes?", opts: ['With full moon', 'By powering up', 'Via meditation'], ans: 'With full moon' },
    { q: "Can humans achieve Super Saiyan?", opts: ['No', 'Yes', 'Maybe'], ans: 'No' },
    { q: "What is a Fusion?", opts: ['Joining two beings into one', 'Telepathy', 'Power sharing'], ans: 'Joining two beings into one' },
    { q: "How long does Fusion Dance last?", opts: ['30 minutes', '1 hour', 'Permanent'], ans: '30 minutes' },
    { q: "What is the Hyperbolic Time Chamber?", opts: ['1 day outside = 1 year inside', '1 year outside = 1 day inside', 'Normal time'], ans: '1 day outside = 1 year inside' },
    { q: "Who is the guardian of Earth?", opts: ['Kami', 'King Kai', 'Shin'], ans: 'Kami' },
    { q: "What is the Red Ribbon Army?", opts: ['Evil military organization', 'Peaceful nation', 'Martial arts school'], ans: 'Evil military organization' },
    { q: "What is the martial arts tournament called?", opts: ['World Martial Arts Tournament', 'Dragon Tournament', 'Power Tournament'], ans: 'World Martial Arts Tournament' },
    { q: "Who hosts the tournament?", opts: ['King of the World', 'Kami', 'Master Roshi'], ans: 'King of the World' },
    { q: "What is the tournament prize money?", opts: ['500,000 zeni', '1 million zeni', 'Trophy only'], ans: '500,000 zeni' },
    { q: "Who is the God of Destruction?", opts: ['Beerus', 'Toppo', 'Belmod'], ans: 'Beerus' },
    { q: "What is Ultra Instinct?", opts: ['Fighting without thinking', 'Energy boost', 'Time control'], ans: 'Fighting without thinking' },
    { q: "Does Vegito ever use Potara?", opts: ['Yes', 'No', 'Once'], ans: 'Yes' },
    { q: "What is Gogeta?", opts: ['Goku + Vegeta Fusion Dance', 'Energy merge', 'Namekian fusion'], ans: 'Goku + Vegeta Fusion Dance' },
    { q: "In what year does Dragon Ball start?", opts: ['Age 749', 'Age 1', 'Age 200'], ans: 'Age 749' },
    { q: "What villain appears in Movie 1?", opts: ['Garlic Jr.', 'Cooler', 'Broly'], ans: 'Garlic Jr.' },
    { q: "What is unique about Broly?", opts: ['Legendary Super Saiyan', 'First Android', 'Time traveler'], ans: 'Legendary Super Saiyan' },
    { q: "Who is Cooler?", opts: ['Frieza\'s brother', 'Frieza\'s father', 'Frieza\'s clone'], ans: 'Frieza\'s brother' },
  ],
  medium: [
    { q: "What is Trunks' sword made of?", opts: ['Unknown durable material', 'Energy', 'Diamond'], ans: 'Unknown durable material' },
    { q: "What year is Future Trunks born?", opts: ['Age 766', 'Age 757', 'Age 767'], ans: 'Age 766' },
    { q: "What is the name of Future Trunks' mother?", opts: ['Bulma', 'Chi-Chi', 'Launch'], ans: 'Bulma' },
    { q: "Who is Baby in DBGT?", opts: ['Tuffle parasite', 'Android', 'Demon'], ans: 'Tuffle parasite' },
    { q: "What form does Goku reach in DBGT?", opts: ['Super Saiyan 4', 'Golden Ape', 'Blue'], ans: 'Super Saiyan 4' },
    { q: "How many Shadow Dragons appear?", opts: ['7', '6', '8'], ans: '7' },
    { q: "In what year do Saiyans arrive?", opts: ['Age 761', 'Age 749', 'Age 500'], ans: 'Age 761' },
    { q: "What is the Frieza Saga's main location?", opts: ['Planet Namek', 'Planet Earth', 'Planet Frieza'], ans: 'Planet Namek' },
    { q: "How many transformations does Frieza have?", opts: ['4 main forms', '5', '3'], ans: '4 main forms' },
    { q: "Who defeats Frieza?", opts: ['Goku (as Super Saiyan)', 'Vegeta', 'Piccolo'], ans: 'Goku (as Super Saiyan)' },
    { q: "In what year does the Cell Games occur?", opts: ['Age 767', 'Age 757', 'Age 777'], ans: 'Age 767' },
    { q: "Who defeats Cell?", opts: ['Gohan', 'Goku', 'Vegeta'], ans: 'Gohan' },
    { q: "Who invents the Kamehameha?", opts: ['Master Roshi', 'Goku', 'Piccolo'], ans: 'Master Roshi' },
    { q: "What is the Spirit Bomb made of?", opts: ['Energy from living beings', 'Solar power', 'Moon power'], ans: 'Energy from living beings' },
    { q: "What is Destructo Disc?", opts: ['Cutting energy disc', 'Healing move', 'Time technique'], ans: 'Cutting energy disc' },
    { q: "Who teaches Kaioken?", opts: ['King Kai', 'Master Roshi', 'Kami'], ans: 'King Kai' },
    { q: "What does the Kaioken do?", opts: ['Multiplies power level', 'Speeds up time', 'Increases endurance'], ans: 'Multiplies power level' },
    { q: "What is a Potara fusion?", opts: ['Using earrings to merge', 'Dance technique', 'Energy merge'], ans: 'Using earrings to merge' },
    { q: "How long does Potara fusion last?", opts: ['1 hour', '30 minutes', 'Permanent'], ans: '1 hour' },
    { q: "What is the Tournament of Power?", opts: ['Battle between 8 universes', 'Martial arts comp', 'Tournament to save world'], ans: 'Battle between 8 universes' },
    { q: "How many Universes exist in DBS?", opts: ['12', '8', '10'], ans: '12' },
    { q: "Who is Jiren?", opts: ['Universe 11 fighter', 'Universe 6 fighter', 'Angel'], ans: 'Universe 11 fighter' },
    { q: "What transformation is Rosé?", opts: ['Super Saiyan Rosé', 'Blue variant', 'Golden form'], ans: 'Super Saiyan Rosé' },
    { q: "Who is Goku Black?", opts: ['Goku\'s body with Kaioshin soul', 'Clone', 'Evil Goku'], ans: 'Goku\'s body with Kaioshin soul' },
    { q: "Do fusions ever break their time limit?", opts: ['Yes - Vegito does', 'No', 'Sometimes'], ans: 'Yes - Vegito does' },
    { q: "What movie features Battle of Gods?", opts: ['God of Destruction Beerus', 'Fusion Reborn', 'Dead Zone'], ans: 'God of Destruction Beerus' },
    { q: "In what movie do Goku and Vegeta fuse with Fusion Dance?", opts: ['Fusion Reborn', 'Dead Zone', 'Movie 13'], ans: 'Fusion Reborn' },
    { q: "What is Janemba?", opts: ['Hell\'s demon (Fusion Reborn villain)', 'Android', 'Time demon'], ans: 'Hell\'s demon (Fusion Reborn villain)' },
    { q: "Who is Paragus?", opts: ['Broly\'s father', 'Frieza\'s general', 'Android engineer'], ans: 'Broly\'s father' },
    { q: "What is Dragon Ball DAIMA?", opts: ['New anime/manga series', 'Video game', 'Spin-off'], ans: 'New anime/manga series' },
    { q: "What is the Demon Realm?", opts: ['Opposite plane from known universe', 'Hell', 'Underworld'], ans: 'Opposite plane from known universe' },
    { q: "Does Kami seal King Piccolo?", opts: ['Yes', 'No', 'Partially'], ans: 'Yes' },
    { q: "How high is Kami\'s Lookout?", opts: ['100,000+ meters', '10,000 meters', '1,000 meters'], ans: '100,000+ meters' },
    { q: "What is the Room of Spirit and Time?", opts: ['Hyperbolic Time Chamber', 'Time Vault', 'Spirit Chamber'], ans: 'Hyperbolic Time Chamber' },
    { q: "Is Piccolo originally good or evil?", opts: ['Evil', 'Good', 'Neutral'], ans: 'Evil' },
    { q: "Who trained Krillin first?", opts: ['Master Roshi', 'Goku', 'Piccolo'], ans: 'Master Roshi' },
    { q: "What is Tien's signature technique?", opts: ['Tri-Form/Multi-Form', 'Solar Flare', 'Kienzan'], ans: 'Tri-Form/Multi-Form' },
    { q: "What is Yamcha's most iconic technique?", opts: ['Wolf Fang Fist', 'Solar Flare', 'Taiyoken'], ans: 'Wolf Fang Fist' },
    { q: "How many times does Goku die in DBZ?", opts: ['2', '1', '3'], ans: '2' },
    { q: "What is Snake Way?", opts: ['Path to Other World', 'Serpent\'s lair', 'Spirit road'], ans: 'Path to Other World' },
    { q: "What year is Gohan born?", opts: ['Age 757', 'Age 749', 'Age 761'], ans: 'Age 757' },
  ],
  hard: [
    { q: "What is Bardock\'s wife\'s name?", opts: ['Gine', 'Raditz\'s mother', 'Unknown'], ans: 'Gine' },
    { q: "In what year does Planet Vegeta explode?", opts: ['Age 737', 'Age 749', 'Age 761'], ans: 'Age 737' },
    { q: "What premonition does Bardock have?", opts: ['Frieza kills all, blonde warrior saves world', 'Vegeta betrays', 'Android uprising'], ans: 'Frieza kills all, blonde warrior saves world' },
    { q: "What is the origin of Vegeta\'s scar?", opts: ['Possibly Yajirobe', 'War wound', 'Frieza'], ans: 'Possibly Yajirobe' },
    { q: "Who is Ginyu Force leader?", opts: ['Captain Ginyu', 'Burter', 'Recoome'], ans: 'Captain Ginyu' },
    { q: "What is Ginyu\'s signature move?", opts: ['Body Swap', 'Implode', 'Galaxy Burst'], ans: 'Body Swap' },
    { q: "Does Ginyu successfully swap with Goku?", opts: ['Yes', 'No', 'Partially'], ans: 'Yes' },
    { q: "Who are Zarbon and Dodoria?", opts: ['Frieza\'s generals', 'Androids', 'Saiyans'], ans: 'Frieza\'s generals' },
    { q: "What is Cell\'s origin?", opts: ['Time traveler/Android', 'Clone', 'Natural being'], ans: 'Time traveler/Android' },
    { q: "From what timeline does Cell come?", opts: ['Trunks\' future timeline', 'Present', 'Alternate'], ans: 'Trunks\' future timeline' },
    { q: "What triggers Super Saiyan 2?", opts: ['Extreme rage/emotional trigger', 'Power boost', 'Training'], ans: 'Extreme rage/emotional trigger' },
    { q: "What specifically triggers Gohan\'s SSJ2?", opts: ['Witnessing Krillin\'s death', 'Power boost', 'Anger'], ans: 'Witnessing Krillin\'s death' },
    { q: "Who is the ancient wizard Babidi?", opts: ['Majin Buu\'s creator', 'Supreme Kai', 'Android'], ans: 'Majin Buu\'s creator' },
    { q: "How old is Majin Buu?", opts: ['Millions of years', '1000 years', 'Unknown'], ans: 'Millions of years' },
    { q: "What does Majin Buu split into?", opts: ['Pure/Good Buu and Evil Buu', 'Clones', 'Nothing'], ans: 'Pure/Good Buu and Evil Buu' },
    { q: "What is Kid Buu\'s power compared to other forms?", opts: ['Highest despite child form', 'Weakest', 'Equal'], ans: 'Highest despite child form' },
    { q: "What year is Uub born?", opts: ['Age 784', 'Age 774', 'Age 790'], ans: 'Age 784' },
    { q: "What is Uub\'s relationship to Buu?", opts: ['Human reincarnation of Kid Buu', 'Relative', 'Clone'], ans: 'Human reincarnation of Kid Buu' },
    { q: "Does Goku train Uub?", opts: ['Yes, after DBZ', 'No', 'In DBGT'], ans: 'Yes, after DBZ' },
    { q: "Does Vegito stay fused?", opts: ['Yes - breaks time limit', 'No', 'Partially'], ans: 'Yes - breaks time limit' },
    { q: "In Tournament of Power, what fusion happens?", opts: ['Kefla (Kale+Caulifla)', 'Gogeta', 'Vegito'], ans: 'Kefla (Kale+Caulifla)' },
    { q: "What is the exact mechanism of Time Rings?", opts: ['Allow timeline travel', 'Stop time', 'Teleport'], ans: 'Allow timeline travel' },
    { q: "How many parallel timelines exist?", opts: ['Infinite (implied)', '5-6 shown', '10'], ans: 'Infinite (implied)' },
    { q: "What is Zeno Button?", opts: ['Emergency erasure device', 'Tournament control', 'Wish device'], ans: 'Emergency erasure device' },
    { q: "How many Zenos exist?", opts: ['2 - Present and Future', '1', '3+'], ans: '2 - Present and Future' },
    { q: "What makes Ultra Instinct silver?", opts: ['No ego/emotion control', 'Power level', 'Transformation'], ans: 'No ego/emotion control' },
    { q: "What is Mastered Ultra Instinct visual?", opts: ['Silver aura + white hair', 'Blue/gold', 'Red lightning'], ans: 'Silver aura + white hair' },
    { q: "In ToP, what happens to erased universes?", opts: ['Restored by Goku\'s wish', 'Gone forever', 'Dormant'], ans: 'Restored by Goku\'s wish' },
    { q: "Who wins Tournament of Power?", opts: ['Universe 7', 'Universe 11', 'Universe 6'], ans: 'Universe 7' },
    { q: "What universes are erased in ToP?", opts: ['2, 6, 9, 10, 11', '1-4', '7-12'], ans: '2, 6, 9, 10, 11' },
    { q: "What is Scouter technology?", opts: ['Power level measurement', 'Telepathy', 'Teleport'], ans: 'Power level measurement' },
    { q: "Who invents Scouter?", opts: ['Dr. Gero/Red Ribbon', 'Frieza', 'Bulma'], ans: 'Dr. Gero/Red Ribbon' },
    { q: "Can standard Scouter measure Goku\'s power?", opts: ['No - too variable', 'Yes always', 'Sometimes'], ans: 'No - too variable' },
    { q: "What is max power level for standard Scouter?", opts: ['25,000', '50,000', '100,000'], ans: '25,000' },
    { q: "What is the highest confirmed power level number in DBZ?", opts: ['9,000,000,000+ (Goku DBS)', '1,500,000,000', '100,000,000'], ans: '9,000,000,000+ (Goku DBS)' },
    { q: "How many different Super Saiyan variants appear?", opts: ['10+ (SSJ, 2, 3, God, Blue, Rosé, etc)', '5', '8'], ans: '10+ (SSJ, 2, 3, God, Blue, Rosé, etc)' },
    { q: "What does SSJ Blue stand for?", opts: ['Super Saiyan Blue', 'Super Saiyan Blessed', 'Super Saiyan Brute'], ans: 'Super Saiyan Blue' },
    { q: "Is there a Super Saiyan 1.5?", opts: ['No - jumps from 1 to 2', 'Yes (filler)', 'Fan creation only'], ans: 'No - jumps from 1 to 2' },
    { q: "What is the drawback of Super Saiyan 3?", opts: ['Drains stamina quickly', 'Requires two days', 'Can\'t sustain long'], ans: 'Drains stamina quickly' },
  ],
  insane: [
    { q: "What is Gine in Japanese Dragon Ball context?", opts: ['Saiyan - signifies female warrior', 'Power', 'Spirit'], ans: 'Saiyan - signifies female warrior' },
    { q: "Is Frieza\'s race ever given official name?", opts: ['Changeling/Frost Demon', 'No official name', 'Tyrant race'], ans: 'Changeling/Frost Demon' },
    { q: "Does Raditz have a tail?", opts: ['Yes', 'No', 'Cut off'], ans: 'Yes' },
    { q: "What is Nappa\'s main technique?", opts: ['Explosive Wave', 'Regeneration', 'Flight'], ans: 'Explosive Wave' },
    { q: "How many Saiyans survive Frieza\'s destruction?", opts: ['3-4 (Goku, Vegeta, Nappa, maybe others)', '2', '5'], ans: '3-4 (Goku, Vegeta, Nappa, maybe others)' },
    { q: "What weakens Saiyans specifically?", opts: ['Electricity/Ki drain attacks', 'Water', 'Ice'], ans: 'Electricity/Ki drain attacks' },
    { q: "Can Saiyan tail be regenerated if removed?", opts: ['No, loses regeneration ability without it', 'Yes', 'Sometimes'], ans: 'No, loses regeneration ability without it' },
    { q: "What is Recoome\'s signature technique?", opts: ['Recoome Kick', 'Energy beam', 'Time freeze'], ans: 'Recoome Kick' },
    { q: "What is the exact power of Frieza\'s 4th form?", opts: ['150 million (implied)', '100 million', '500 million'], ans: '150 million (implied)' },
    { q: "Does Frieza have a fifth form?", opts: ['No, only 4 official forms', 'Yes', 'In movies only'], ans: 'No, only 4 official forms' },
    { q: "Can Android 16 regenerate?", opts: ['Yes, from external parts', 'No', 'Limited regeneration'], ans: 'Yes, from external parts' },
    { q: "What makes Android 17 and 18 different from others?", opts: ['Infinite energy source', 'Stronger power core', 'Time control'], ans: 'Infinite energy source' },
    { q: "Is Dr. Gero an Android himself?", opts: ['Yes - Android 20', 'No', 'Human with implants'], ans: 'Yes - Android 20' },
    { q: "What is Tien\'s Multiform technique limit?", opts: ['Divides power by number of clones', 'Infinite', 'Temporary'], ans: 'Divides power by number of clones' },
    { q: "Can Krillin ever match Saiyan strength?", opts: ['Only with special training/equipment', 'Never', 'Briefly'], ans: 'Only with special training/equipment' },
    { q: "What is Roshi\'s true age?", opts: ['130+ years old', '80 years', 'Unknown'], ans: '130+ years old' },
    { q: "What is Yajirobe\'s role?", opts: ['Provides medicine/support', 'Fighter', 'Guardian'], ans: 'Provides medicine/support' },
    { q: "What is unique about Korin Tower?", opts: ['1000+ stories tall, grows fruit', 'Time chamber', 'Ancient artifact'], ans: '1000+ stories tall, grows fruit' },
    { q: "Who is Old Kai\'s relation?", opts: ['Original Supreme Kai', 'Shin\'s teacher', 'Ancient Kaioshin'], ans: 'Original Supreme Kai' },
    { q: "Does Shin fight in DBZ?", opts: ['Only briefly', 'Not really', 'Extensively'], ans: 'Only briefly' },
    { q: "What separates first Kaioken from others?", opts: ['Simple 2x multiplier', 'Time control', 'Energy drain'], ans: 'Simple 2x multiplier' },
    { q: "Can Instant Transmission be learned?", opts: ['Only by telepaths/training', 'Inborn', 'Yes'], ans: 'Only by telepaths/training' },
    { q: "What is Piccolo\'s true origin?", opts: ['Namekian rejuvenation/spawn', 'Android', 'Demon'], ans: 'Namekian rejuvenation/spawn' },
    { q: "Can Namekians regenerate infinitely?", opts: ['No - takes energy', 'Yes', 'Limited'], ans: 'No - takes energy' },
    { q: "What is Kami\'s connection to King Piccolo?", opts: ['Split personality', 'Father', 'Mentor'], ans: 'Split personality' },
    { q: "Did Goku ever fully master the Kamehameha?", opts: ['Yes - improved throughout series', 'No', 'Partially'], ans: 'Yes - improved throughout series' },
    { q: "How many Kamehameha variants exist?", opts: ['10+ (Father-Son, Fusion, Blue, etc)', '5', '3'], ans: '10+ (Father-Son, Fusion, Blue, etc)' },
    { q: "What is the strongest single-user attack name?", opts: ['Spirit Bomb (energy from all)', 'Final Flash', 'Big Bang'], ans: 'Spirit Bomb (energy from all)' },
    { q: "Does the Spirit Bomb work on cyborgs?", opts: ['No - they have no life energy', 'Yes', 'Sometimes'], ans: 'No - they have no life energy' },
    { q: "What year does DBS manga start?", opts: ['Age 775', 'Age 749', 'Age 800'], ans: 'Age 775' },
    { q: "Is DBS anime before or after manga?", opts: ['Before (diverges from manga)', 'After', 'Simultaneous'], ans: 'Before (diverges from manga)' },
    { q: "How many universes participate in Tournament of Power?", opts: ['8 universes (implied)', '10', '12'], ans: '8 universes (implied)' },
    { q: "Who is the strongest in Universe 11?", opts: ['Jiren', 'Toppo', 'Dyspo'], ans: 'Jiren' },
    { q: "What is Toppo\'s signature form?", opts: ['God of Destruction candidate', 'Blue', 'Ultra'], ans: 'God of Destruction candidate' },
    { q: "Does Vegeta ever use Ultra Instinct?", opts: ['No - Pride/focus incompatible', 'Yes briefly', 'In manga only'], ans: 'No - Pride/focus incompatible' },
    { q: "What is the Supreme Kai\'s weakness?", opts: ['Vulnerable/not fighter', 'Low stamina', 'No weakness'], ans: 'Vulnerable/not fighter' },
    { q: "Are there other Kaioshin besides Shin?", opts: ['Yes - 11 others across universes', 'No', 'A few'], ans: 'Yes - 11 others across universes' },
    { q: "Can Future Zeno be reasoned with?", opts: ['No - extremely destructive/bitter', 'Yes', 'Sometimes'], ans: 'No - extremely destructive/bitter' },
  ]
};

let triviaActive = false;
let triviaAnswered = false; // Track if someone already answered this question
let lastTriviaTriggerTime = 0; // Prevent spam
const TRIVIA_COOLDOWN = 5 * 60 * 1000; // 5 minutes between individual trivia plays
const TRIVIA_SPAM_PROTECTION = 30 * 1000; // 30 second minimum between auto-triggers

function startTrivia() {
  const now = Date.now();
  
  // Spam protection - don't trigger trivia more than once every 30 seconds
  if (now - lastTriviaTriggerTime < TRIVIA_SPAM_PROTECTION) {
    console.log('⏳ Trivia triggered too recently - please wait 30 seconds');
    return false; // Return false to indicate failure
  }
  
  if (triviaActive) {
    console.log('⏳ Trivia already running - answer the question!');
    return false; // Return false to indicate failure
  }
  
  // Random difficulty
  const difficulties = ['easy', 'medium', 'hard', 'insane'];
  const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
  const questions = TRIVIA_QUESTIONS[difficulty];
  
  if (!questions || questions.length === 0) {
    console.log('❌ No questions in difficulty: ' + difficulty);
    return false; // Return false to indicate failure
  }
  
  // Random question from that difficulty
  const question = questions[Math.floor(Math.random() * questions.length)];
  
  triviaActive = {
    question: question.q,
    options: question.opts,
    answer: question.ans,
    difficulty,
    startTime: Date.now(),
  };
  triviaAnswered = false; // Reset - nobody has answered yet
  lastTriviaTriggerTime = now; // Update last trigger time
  
  console.log(`\n🎯 TRIVIA [${difficulty.toUpperCase()}]\n${question.q}\n`);
  question.opts.forEach((opt, i) => console.log(`   ${String.fromCharCode(97 + i)}) ${opt}`));
  console.log('\nType: a, b, or c to answer (first person only!)\n');
  
  setTimeout(() => {
    if (triviaActive) {
      console.log(`\n❌ Trivia timeout! Answer was: ${triviaActive.answer}\n`);
      triviaActive = false;
      triviaAnswered = false;
    }
  }, 2 * 60 * 1000); // 2 minute timeout
  
  return true; // Return true to indicate success
}

// Auto trivia every 15 minutes
setInterval(() => {
  startTrivia();
}, 15 * 60 * 1000);

function getLeaderboard() {
  const now = Date.now();
  const USER_DROP_MS = 30_000; // Match the overlay's 30s timeout

  // Clear activePlatforms for users who've been inactive for 30s+
  Object.values(users).forEach(u => {
    if ((now - (u.lastActive || 0)) >= USER_DROP_MS) {
      u.activePlatforms = []; // ← Clear when they drop off
    }
  });

  const sorted = Object.values(users).sort((a, b) => b.xp - a.xp).slice(0, 200);
  const top = sorted[0];

  // Exclusive title: only the ACTUAL #1 qualifies, and only once they've
  // cleared the bar. Nobody else can hold it no matter their own XP.
  const newOmniId = (top && top.xp >= OMNI_KING_RANK.xp) ? top.id : null;
  if (newOmniId !== omniKingId) {
    const prevId   = omniKingId;
    const prevName = prevId ? (users[prevId]?.name || null) : null;
    omniKingId = newOmniId;
    if (newOmniId) {
      console.log(`👑 NEW OMNI-KING — ${top.name} (${top.xp.toLocaleString()} XP)${prevName ? ` — dethroned ${prevName}` : ''}`);
      send(wssLB, { type: 'omniKingChange', userId: newOmniId, name: top.name,
                    xp: top.xp, previousName: prevName });
    } else if (prevName) {
      console.log(`👑 Omni-King title vacated — ${prevName} dropped below #1`);
    }
  }

  return sorted.map((u, i) => {
    const isOmni = i === 0 && u.id === omniKingId;
    const r = isOmni ? OMNI_KING_RANK : getRank(u.xp, u.pathChoice);
    return { ...u, position: i + 1, rankName: r.short, rankId: r.id, activePlatforms: u.activePlatforms || [] };
  });
}

// ── DRAGON BALL STATE ──────────────────────────────────────────────────────
let dbState = { totalLikes: 0, ballsUnlocked: 0, giftUnlocked: false, totalCoins: 0 };
// Load saved Dragon Ball progress so server restarts don't wipe the meter
if (existsSync(DB_SAVE_FILE)) {
  try {
    const s = JSON.parse(readFileSync(DB_SAVE_FILE, 'utf8'));
    dbState = { ...dbState, ...s };
    // Re-derive ballsUnlocked from totalLikes against the CURRENT thresholds,
    // so a stale/desynced saved value (or a threshold change) self-corrects
    // instead of jamming the meter forever.
    let derived = 0;
    for (let i = 0; i < BALL_THRESHOLDS.length; i++) {
      if (dbState.totalLikes >= BALL_THRESHOLDS[i]) derived = i + 1;
    }
    if (dbState.giftUnlocked) derived = 7;
    if (derived !== dbState.ballsUnlocked) {
      console.log(`🐉 Corrected balls: saved ${dbState.ballsUnlocked} → ${derived} (from ${dbState.totalLikes.toLocaleString()} likes)`);
      dbState.ballsUnlocked = derived;
    }
    console.log(`🐉 Restored DB state: ${dbState.totalLikes} likes, ${dbState.ballsUnlocked} balls, ${dbState.totalCoins} 💎`);
  } catch (e) { console.log('⚠️  Could not load DB state:', e.message); }
}
function saveDbState() {
  try { writeFileSync(DB_SAVE_FILE, JSON.stringify(dbState)); }
  catch (e) { console.error('DB save error:', e.message); }
}
setInterval(saveDbState, 5000);

// ── EXPRESS + WS SERVERS ───────────────────────────────────────────────────
// Just the two that matter: Dragon Ball meter (8080) and the scouter (8081).
// Sonic and the merged-chat overlay were stripped out — cleaner setup, less
// clutter, and one less thing that can break.
const appDB  = express();
const httpDB = createServer(appDB);
const wssDB  = new WebSocketServer({ server: httpDB });

const appLB  = express();
const httpLB = createServer(appLB);
const wssLB  = new WebSocketServer({ server: httpLB });

// Serve HTML
appDB.get('/', (req, res) => res.sendFile(join(__dirname, 'dragonball-overlay.html')));
appLB.get('/', (req, res) => res.sendFile(join(__dirname, 'leaderboard-overlay.html')));

// ── DIAGNOSTIC ENDPOINTS ────────────────────────────────────────────────────
appLB.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    wsClients: wssLB.clients.size,
    users: Object.keys(users).length,
  });
});

appLB.get('/test-activity', (req, res) => {
  const testUser = 'overlay-tester';
  const testXP = 500;
  send(wssLB, {
    type: 'activity',
    action: 'test',
    userId: 'test-' + Date.now(),
    name: testUser,
    xp: testXP,
    count: 0,
    coins: 0,
    entry: {
      id: 'test-' + Date.now(),
      name: testUser,
      xp: testXP,
      rankId: 0,
      rankName: 'Test Event',
      activePlatforms: [],
    },
    platform: 'test',
  });
  res.json({ sent: true, wsClients: wssLB.clients.size });
});

// ── MANUAL ROOM ID OVERRIDE (port 8080) ───────────────────────────────────
// Usage: http://localhost:8080/connect?room=7512345678901234567
appDB.get('/connect', async (req, res) => {
  const room = req.query.room?.trim();
  if (!room || !/^\d+$/.test(room)) return res.send('❌ Usage: /connect?room=ROOM_ID_NUMBER');
  console.log(`\n🔧 Manual room override → ${room}`);
  manualRoomId = room; // proxy will return this on next room_id request
  try { tiktok.disconnect(); } catch {}
  setTimeout(() => tiktok.connect().catch(e => console.error('Connect error:', e.message)), 1500);
  res.send(`✅ Connecting to room ${room} — watch your server console`);
});

// ── TEST ROUTE (port 8081) — fire fake events without being live ────────────
// Usage: http://localhost:8081/test?action=chat&name=Vegeta&xp=500
appLB.get('/test', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send('❌ forbidden');
  const action = req.query.action || 'chat';
  const name   = req.query.name   || 'TestUser';
  const userId = 'test_' + name.toLowerCase().replace(/\s+/g, '_');
  const xpOverride = req.query.xp ? parseInt(req.query.xp) : null;

  let xp = xpOverride ?? XP_RATES[action] ?? 100;
  let coins = 0;
  if (action === 'gift') {
    const diamonds = parseInt(req.query.diamonds || '100');
    coins = diamonds;
    xp = xpOverride ?? calcGiftXP(diamonds, 1);
  }

  addXP(userId, name, action, xp, 1, { coins });
  const msg = `✅ Fired [${action}] for ${name} (+${xp} XP)`;
  console.log('[TEST]', msg);
  res.send(msg);
});

// ── STRIPE WEBHOOK ─────────────────────────────────────────────────────────
appLB.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'charge.succeeded' || event.type === 'payment_intent.succeeded') {
      const data = event.data.object;
      const amount = data.amount; // in cents
      const metadata = data.metadata || {};
      const discordUsername = metadata.discord_username || metadata.username || 'Anonymous';
      const userId = metadata.discord_id || metadata.user_id;

      // Calculate XP: $1 = 10 XP base, then 1.5x multiplier
      const baseXP = Math.round((amount / 100) * 10); // amount is in cents
      const xpAwarded = Math.round(baseXP * 1.5); // Apply 1.5x multiplier

      if (userId) {
        addXP(userId, discordUsername, 'donate', xpAwarded, 1, { cents: amount });
        console.log(`✅ ${discordUsername}: +${xpAwarded} XP from $${(amount / 100).toFixed(2)} donation (1.5x)`);
      } else {
        console.log(`⚠️  Stripe donation from ${discordUsername} (no Discord ID): +${xpAwarded} XP`);
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Stripe webhook error:', error.message);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// ── BROADCAST HELPERS ──────────────────────────────────────────────────────
function send(wss, data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(str); });
}

const PLATFORM_COLORS = { tiktok:'#FF0050', kick:'#53FC18', twitch:'#9146FF', youtube:'#FF0000', facebook:'#1877F2' };

// The merged chat overlay was stripped out — these are now harmless no-ops
// so every existing call site (Twitch/Kick/TikTok handlers) keeps working
// without needing to be hunted down and deleted individually.
function broadcastChat() {}
function broadcastGift() {}

// ── TWITCH ANONYMOUS CHAT ──────────────────────────────────────────────────
function connectTwitch() {
  const channel = MULTISTREAM.twitch?.toLowerCase();
  if (!channel) return;
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  ws.on('open', () => {
    ws.send(`PASS oauth:nosecret`);
    ws.send(`NICK justinfan${Math.floor(Math.random()*99999)}`);
    ws.send('CAP REQ :twitch.tv/tags');
    ws.send(`JOIN #${channel}`);
    console.log(`🟣 Twitch → #${channel}`);
  });
  ws.on('message', (raw) => {
    const lines = raw.toString().split('\r\n').filter(Boolean);
    for (const msg of lines) {
      if (msg.includes('PING :tmi.twitch.tv')) { ws.send('PONG :tmi.twitch.tv'); continue; }
      // Tagged message (CAP tags enabled): @tags :user!... PRIVMSG #ch :text
      const tagged = msg.match(/^@(\S+)\s+:(\w+)!\S+\s+PRIVMSG\s+#\S+\s+:(.+)/);
      if (tagged) {
        const tags = Object.fromEntries(tagged[1].split(';').map(t => t.split('=')));
        const twName = tags['display-name'] || tagged[2];
        const twId   = 'tw:' + tagged[2].toLowerCase();
        broadcastChat({
          platform:    'twitch',
          user:        tagged[2],
          displayName: twName,
          message:     tagged[3].trim(),
          color:       tags['color'] || '#9146FF',
        });

        const bits = parseInt(tags['bits'] || '0', 10);
        if (bits > 0) {
          const xp = calcGiftXP(bits, 1); // 1 bit ≈ 1 cent, same scale as diamonds
          console.log(`💎 [TWITCH] ${twName} cheered ${bits} bits (+${xp.toLocaleString()} XP)`);
          addXP(resolveId(twId), twName, 'gift', xp, 1, { bits });
          send(wssLB, { type: 'economyEvent', platform: 'twitch', kind: 'bits', name: twName, xp, detail: `${bits} bits` });
        } else if (!handlePathCommand(twId, twName, tagged[3].trim()) && !handleChallengeCommand(twId, twName, tagged[3].trim()) && !handleLinkCommand(twId, twName, tagged[3].trim(), 'twitch')) {
          addXP(twId, twName, 'chat', XP_RATES.chat, 0, {});
        }
        continue;
      }
      // Subs, resubs, gifted subs, mystery gifts, raids — all arrive as USERNOTICE
      const notice = msg.match(/^@(\S+)\s+:tmi\.twitch\.tv\s+USERNOTICE\s+#\S+/);
      if (notice) {
        const tags = Object.fromEntries(notice[1].split(';').map(t => t.split('=').map(decodeURIComponent)));
        const msgId = tags['msg-id'];
        const who   = tags['display-name'] || tags['login'];
        const twId  = 'tw:' + (tags['login'] || who || '').toLowerCase();

        if (msgId === 'sub' || msgId === 'resub') {
          const tierCode = tags['msg-param-sub-plan'];
          const tier = tierCode === '3000' ? 3 : tierCode === '2000' ? 2 : 1; // Prime counts as tier 1
          let xp = dollarsToXP(SUB_TIER_USD[tier]);
          if (msgId === 'resub') xp = Math.round(xp * RESUB_MULT);
          console.log(`⭐ [TWITCH] ${who} — ${msgId} (tier ${tier}) (+${xp.toLocaleString()} XP)`);
          addXP(resolveId(twId), who, 'gift', xp, 1, {});
          send(wssLB, { type: 'economyEvent', platform: 'twitch', kind: msgId, name: who, xp,
                        detail: `Tier ${tier} ${msgId === 'resub' ? 're' : ''}sub` });
        }
        else if (msgId === 'subgift' || msgId === 'anonsubgift') {
          const tierCode = tags['msg-param-sub-plan'];
          const tier = tierCode === '3000' ? 3 : tierCode === '2000' ? 2 : 1;
          const xp = dollarsToXP(SUB_TIER_USD[tier]);
          console.log(`🎁 [TWITCH] ${who} gifted a tier ${tier} sub (+${xp.toLocaleString()} XP)`);
          addXP(resolveId(twId), who, 'gift', xp, 1, {});
          send(wssLB, { type: 'economyEvent', platform: 'twitch', kind: 'subgift', name: who, xp,
                        detail: `Gifted tier ${tier} sub` });
        }
        else if (msgId === 'submysterygift') {
          const tierCode = tags['msg-param-sub-plan'] || '1000';
          const tier  = tierCode === '3000' ? 3 : tierCode === '2000' ? 2 : 1;
          const count = parseInt(tags['msg-param-mass-gift-count'] || '1', 10);
          const xp    = dollarsToXP(SUB_TIER_USD[tier] * count);
          console.log(`🎁 [TWITCH] ${who} gifted ${count}× tier ${tier} subs (+${xp.toLocaleString()} XP)`);
          addXP(resolveId(twId), who, 'gift', xp, count, {});
          send(wssLB, { type: 'economyEvent', platform: 'twitch', kind: 'massgift', name: who, xp,
                        detail: `${count} gifted subs` });
        }
        else if (msgId === 'raid') {
          const viewers = parseInt(tags['msg-param-viewerCount'] || '0', 10);
          // No dollar value on a raid — reward is tied to the audience they bring, capped so it
          // can't outweigh real spending.
          const xp = Math.min(viewers * 50, 15000);
          if (xp > 0) {
            console.log(`🚀 [TWITCH] ${who} raided with ${viewers} viewers (+${xp.toLocaleString()} XP)`);
            addXP(resolveId(twId), who, 'gift', xp, 1, {});
            send(wssLB, { type: 'economyEvent', platform: 'twitch', kind: 'raid', name: who, xp,
                          detail: `Raid — ${viewers} viewers` });
          }
        }
        continue;
      }

      // Plain message (no tags yet): :user!user@... PRIVMSG #ch :text
      const plain = msg.match(/:(\w+)!\S+\s+PRIVMSG\s+#\S+\s+:(.+)/);
      if (plain) {
        const twId = 'tw:' + plain[1].toLowerCase();
        broadcastChat({
          platform:    'twitch',
          user:        plain[1],
          displayName: plain[1],
          message:     plain[2].trim(),
          color:       '#9146FF',
        });
        if (!handlePathCommand(twId, plain[1], plain[2].trim()) && !handleChallengeCommand(twId, plain[1], plain[2].trim()) && !handleLinkCommand(twId, plain[1], plain[2].trim(), 'twitch')) {
          addXP(twId, plain[1], 'chat', XP_RATES.chat, 0, {});
        }
      }
    }
  });
  ws.on('close', () => {
    setTimeout(connectTwitch, 10000);
  });
  ws.on('error', () => {});
}

// ── KICK CHAT (Pusher) ─────────────────────────────────────────────────────
let kickConnected = false;
let kickRetries = 0;
let manualKickIds = null;  // User can set this manually if API fails {chatroomId, channelId}

// ── KICK LIVE CHAT VIA PUSHER ──────────────────────────────────────────────
// Uses kick_live_ws library which handles Pusher WebSocket properly
let kickConnection = null;

async function connectKick() {
  const channel = MULTISTREAM.kick;
  if (!channel) return;

  try {
    // Get channel ID - either from manual config or try to fetch
    let channelId = manualKickIds?.channelId;

    if (!channelId) {
      // Try API (optional - mainly for info, kick_live_ws can work with just username)
      console.log(`🔗 Kick: attempting to connect to @${channel}...`);
      // If API is blocked, we can still connect with username
    } else {
      console.log(`🔗 Kick: using manual channel ID ${channelId}...`);
    }

    connectKickWithIds(channelId);
  } catch (err) {
    console.log(`❌ Kick connection failed: ${err.message}`);
    kickConnected = false;
    setTimeout(connectKick, 30000);
  }
}

function connectKickWithIds(channelId) {
  const channel = MULTISTREAM.kick;
  if (!channel) return;

  // Close any existing connection
  if (kickConnection) {
    try { kickConnection.close?.(); kickConnection = null; } catch (e) {}
  }

  try {
    console.log(`🔗 Kick: connecting to @${channel}...`);

    // Get hardcoded IDs (bypasses Cloudflare block)
    const ids = KICK_IDS[channel];
    if (!ids) {
      console.log(`⚠️  Kick: No hardcoded IDs for ${channel}, skipping`);
      setTimeout(connectKick, 30000);
      return;
    }

    const { chatroom_id, channel_id } = ids;
    console.log(`🔗 Kick: using hardcoded IDs (chatroom: ${chatroom_id}, channel: ${channel_id})`);

    // Try different Pusher clusters and endpoints
    const pusherConfigs = [
      'wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false',
      'wss://ws-us1.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false',
      'wss://ws-eu.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false',
      'wss://realtime.us-west-2.platform.kick.com/connection/websocket'
    ];

    let wsUrl = pusherConfigs[0];

    kickConnection = new WSLib(wsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://kick.com',
        'Referer': 'https://kick.com/'
      }
    });

    kickConnection.on('open', () => {
      console.log(`🟢 Kick → Pusher WebSocket opened`);
      kickConnected = true;
      kickRetries = 0;

      // Subscribe to chat room
      setTimeout(() => {
        try {
          kickConnection.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: {
              auth: '',
              channel: `chatrooms.${chatroom_id}.v2`
            }
          }));
          console.log(`✅ Subscribed to Kick chatroom ${chatroom_id}`);
        } catch (e) {
          console.log(`❌ Subscription failed: ${e.message}`);
        }

        // Subscribe to channel for other events
        try {
          kickConnection.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: {
              auth: '',
              channel: `channel.${channel_id}`
            }
          }));
          console.log(`✅ Subscribed to Kick channel ${channel_id}`);
        } catch (e) {
          console.log(`❌ Channel subscription failed: ${e.message}`);
        }
      }, 500);
    });

    kickConnection.on('message', (rawData) => {
      try {
        const data = JSON.parse(rawData.toString());

        // Ignore Pusher internal messages
        if (data.event === 'pusher_internal:subscription_succeeded') {
          console.log(`📡 Kick: subscribed to ${data.channel}`);
          return;
        }
        if (data.event === 'pusher:error' || data.event === 'pusher:pong') return;

        // Handle Kick events
        if (!data.data) return;

        const msg = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;

        // Chat messages
        if (data.event === 'App\\Events\\ChatMessageEvent') {
          const username = msg.sender?.username || 'Unknown';
          const content = msg.content || '';
          if (content && username !== 'Unknown') {
            const userId = 'kk:' + username.toLowerCase();
            console.log(`💬 [KICK] ${username}: ${content.substring(0, 100)}`);

            broadcastChat({
              platform: 'kick',
              user: username,
              displayName: username,
              message: content,
              color: msg.sender?.identity?.color || '#53FC18',
            });

            if (!handlePathCommand(userId, username, content) &&
                !handleChallengeCommand(userId, username, content) &&
                !handleLinkCommand(userId, username, content, 'kick')) {
              addXP(userId, username, 'chat', XP_RATES.chat, 0, {});
            }
          }
        }

        // Subscriptions
        if (data.event === 'App\\Events\\SubscriptionEvent') {
          const who = msg.username;
          const tier = msg.tier || 1;
          if (who) {
            const userId = 'kk:' + who.toLowerCase();
            const xp = dollarsToXP(SUB_TIER_USD[Math.min(tier, 3)] || SUB_TIER_USD[1]);
            console.log(`⭐ [KICK] ${who} subscribed (+${xp.toLocaleString()} XP)`);
            addXP(resolveId(userId), who, 'gift', xp, 1, {});
            send(wssLB, { type: 'economyEvent', platform: 'kick', kind: 'sub', name: who, xp, detail: 'Subscribed' });
          }
        }

        // Gifted subscriptions
        if (data.event === 'App\\Events\\GiftedSubscriptionsEvent') {
          const who = msg.username;
          const count = msg.gift_count || 1;
          if (who) {
            const userId = 'kk:' + who.toLowerCase();
            const xp = dollarsToXP(5 * count);
            console.log(`🎁 [KICK] ${who} gifted ${count} sub(s) (+${xp.toLocaleString()} XP)`);
            addXP(resolveId(userId), who, 'gift', xp, count, {});
            send(wssLB, { type: 'economyEvent', platform: 'kick', kind: 'massgift', name: who, xp,
                          detail: `${count} gifted sub${count > 1 ? 's' : ''}` });
          }
        }

        // Tips
        if (data.event === 'App\\Events\\TipEvent' || data.event === 'App\\Events\\ChannelTipEvent') {
          const who = msg.username;
          const amount = parseInt(msg.amount) || 0;
          if (who && amount > 0) {
            const userId = 'kk:' + who.toLowerCase();
            const xp = calcGiftXP(amount, 1);
            console.log(`💠 [KICK] ${who} sent ${amount} Kicks (+${xp.toLocaleString()} XP)`);
            addXP(resolveId(userId), who, 'gift', xp, 1, {});
            send(wssLB, { type: 'economyEvent', platform: 'kick', kind: 'kicks', name: who, xp, detail: `${amount} Kicks` });
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    kickConnection.on('close', () => {
      console.log(`🔴 Kick disconnected, reconnecting in 15s...`);
      kickConnected = false;
      setTimeout(connectKick, 15000);
    });

    kickConnection.on('error', (err) => {
      console.log(`🔴 Kick error: ${err.message}`);
      kickConnected = false;
    });

  } catch (err) {
    console.log(`❌ Kick connection failed: ${err.message}`);
    kickConnected = false;
    setTimeout(connectKick, 30000);
  }
}


let pushTimer = null;
function debouncedPush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => send(wssLB, { type: 'leaderboard', leaderboard: getLeaderboard() }), 250);
}

// ── ADMIN: EDIT POWER LEVELS (port 8081) ──────────────────────────────────
// Find a user by display name (case-insensitive, partial match) or exact id
function findUser(q) {
  const needle = q.toLowerCase();
  
  // 1. Check if it's a direct user ID (exact match)
  if (users[q]) return users[q];
  
  // 2. Check if it's a Discord ID that's linked (resolve and fetch)
  const resolved = resolveId(q);
  if (resolved !== q && users[resolved]) return users[resolved];
  
  // 3. Exact name match (TikTok or Discord name)
  let hit = Object.values(users).find(u => (u.name || '').toLowerCase() === needle);
  if (hit) return hit;
  
  // 4. Exact alias match (merged Discord/TikTok usernames)
  hit = Object.values(users).find(u => {
    if (u.aliases && Array.isArray(u.aliases)) {
      return u.aliases.some(a => a.toLowerCase() === needle);
    }
    return false;
  });
  if (hit) return hit;
  
  // 5. Partial name match (TikTok or Discord name)
  hit = Object.values(users).find(u => (u.name || '').toLowerCase().includes(needle));
  if (hit) return hit;
  
  // 6. Partial alias match (merged names)
  hit = Object.values(users).find(u => {
    if (u.aliases && Array.isArray(u.aliases)) {
      return u.aliases.some(a => a.toLowerCase().includes(needle));
    }
    return false;
  });
  if (hit) return hit;
  
  // 7. Check linkedPlatforms (in case they have a linked Discord handle stored)
  hit = Object.values(users).find(u => {
    if (u.linkedPlatforms && Array.isArray(u.linkedPlatforms)) {
      return u.linkedPlatforms.some(p => p.toLowerCase().includes(needle));
    }
    return false;
  });
  
  return hit || null;
}

// Fuzzy match for profile linking — find closest match by string similarity
function levenshteinDistance(a, b) {
  const track = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) track[0][i] = i;
  for (let j = 0; j <= b.length; j += 1) track[j][0] = j;
  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }
  return track[b.length][a.length];
}

function fuzzyFindUser(q, threshold = 3) {
  const candidates = Object.values(users).map(u => ({
    user: u,
    distance: levenshteinDistance(q.toLowerCase(), u.name.toLowerCase())
  })).filter(c => c.distance <= threshold).sort((a, b) => a.distance - b.distance);
  
  return candidates.length > 0 ? candidates[0].user : null;
}

// Usage:
//   http://localhost:8081/admin?user=Vegeta&set=50000     → set XP to 50000
//   http://localhost:8081/admin?user=Vegeta&add=5000      → add 5000 XP
//   http://localhost:8081/admin?user=Vegeta&add=-5000     → remove 5000 XP
//   http://localhost:8081/admin?user=Vegeta&rank=UI       → jump to a rank's XP (LOW CLASS/ELITE/SSJ/SSJ2/SSJ3/SSJ4/SS GOD/SS BLUE/UI)
//   http://localhost:8081/admin?user=Vegeta&delete=1      → remove user entirely
//   http://localhost:8081/admin/list                      → top 50 users + XP
appLB.get('/admin', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send('❌ forbidden');
  const q = (req.query.user || '').trim();
  if (!q) return res.send('❌ Usage: /admin?user=NAME&set=XP | &add=XP | &rank=SHORT | &delete=1');

  const u = findUser(q);
  if (!u) return res.send(`❌ No user matching "${q}". Check /admin/list`);

  // DELETE
  if (req.query.delete) {
    delete users[u.id];
    saveState(); debouncedPush();
    return res.send(`🗑️ Deleted ${u.name}`);
  }

  const before = u.xp;

  // SET exact XP
  if (req.query.set !== undefined) {
    const v = parseInt(req.query.set);
    if (isNaN(v) || v < 0) return res.send('❌ set must be a number ≥ 0');
    u.xp = v;
  }
  // ADD/REMOVE XP
  else if (req.query.add !== undefined) {
    const v = parseInt(req.query.add);
    if (isNaN(v)) return res.send('❌ add must be a number (negative to remove)');
    u.xp = Math.max(0, u.xp + v);
  }
  // JUMP TO RANK
  else if (req.query.rank !== undefined) {
    const target = RANKS.find(r =>
      r.short.toLowerCase() === req.query.rank.toLowerCase() ||
      r.name.toLowerCase()  === req.query.rank.toLowerCase());
    if (!target) return res.send(`❌ Unknown rank. Options: ${RANKS.map(r => r.short).join(' | ')}`);
    u.xp = target.xp;
  }
  else {
    const r = getRank(u.xp, u.pathChoice);
    return res.send(`ℹ️ ${u.name}: ${u.xp.toLocaleString()} XP (${r.short}). Add &set= &add= &rank= or &delete=1`);
  }

  const oldRank = getRank(before, u.pathChoice);
  const newRank = getRank(u.xp, u.pathChoice);
  saveState();
  debouncedPush();

  // If they crossed a rank boundary, fire the rank-up celebration on the overlay
  if (newRank.id > oldRank.id) {
    send(wssLB, {
      type: 'rankup', userId: u.id, name: u.name,
      oldRank, newRank, xp: u.xp,
    });
  }

  console.log(`🛠️ [ADMIN] ${u.name}: ${before.toLocaleString()} → ${u.xp.toLocaleString()} XP (${oldRank.short} → ${newRank.short})`);
  res.send(`✅ ${u.name}: ${before.toLocaleString()} → ${u.xp.toLocaleString()} XP (${oldRank.short} → ${newRank.short})`);
});

appLB.get('/admin/list', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send('❌ forbidden');
  const rows = Object.values(users)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 50)
    .map((u, i) => `${i + 1}. ${u.name} — ${u.xp.toLocaleString()} XP (${getRank(u.xp, u.pathChoice).short})`)
    .join('<br>');
  res.send(rows || 'No users yet');
});

// ── YOUTUBE OAuth2 ROUTES ─────────────────────────────────────────────────
appLB.get('/auth/youtube-login', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube']
  });
  res.send(`<html><body><h2>YouTube Authorization</h2><p>Click the link below to authorize:</p><a href="${authUrl}" style="font-size:18px; padding:10px; background:#FF0000; color:white; text-decoration:none; border-radius:5px; display:inline-block;">Authorize YouTube</a></body></html>`);
});

appLB.get('/auth/youtube-callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('❌ No authorization code');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    saveYouTubeToken(tokens);
    connectYouTube();
    res.send('<html><body><h2>✅ YouTube Authorized!</h2><p>Your scouter is now connected to YouTube Live Chat.</p><p>You can close this window.</p></body></html>');
  } catch (e) {
    console.error('YouTube OAuth error:', e.message);
    res.send(`❌ Authorization failed: ${e.message}`);
  }
});

// ── WS CONNECTION HANDLERS ─────────────────────────────────────────────────
wssLB.on('connection', (ws) => {
  console.log('🔭 Leaderboard overlay connected');
  ws.send(JSON.stringify({ type: 'init', leaderboard: getLeaderboard() }));
  // Restore or clear race state for a reconnecting overlay
  ws.send(JSON.stringify(race ? { type: 'raceUpdate', ...racePayload() } : { type: 'raceEnd', reason: 'none' }));
});

wssDB.on('connection', (ws) => {
  console.log('🐉 Dragon ball overlay connected');
  ws.send(JSON.stringify({ type: 'state', ...dbState }));

  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type !== 'ctrl') return;
      if (m.action === 'spike')         send(wssDB, { type: 'spike' });
      if (m.action === 'gift-trigger')  send(wssDB, { type: 'gift' });
      if (m.action === 'giveaway')      send(wssDB, { type: 'giveaway' });
      if (m.action === 'scatter-reset') scatterBalls();
    } catch {}
  });
});

function scatterBalls() {
  dbState = { totalLikes: 0, ballsUnlocked: 0, giftUnlocked: false, totalCoins: 0 };
  saveDbState(); // clear persisted state too
  send(wssDB, { type: 'scatter' });
  setTimeout(() => {
    send(wssDB, { type: 'reset', ...dbState });
  }, 2200);
}

// ── ADD XP ─────────────────────────────────────────────────────────────────


// ── CROSS-PLATFORM ACCOUNT LINKING ──────────────────────────────────────────
const LINK_CODE_TTL = 10 * 60_000; // 10 minutes to use a code

function resolveId(rawId) {
  return linkMap[rawId] || rawId;
}

function genLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (linkCodes[code]);
  return code;
}

function mergeIntoCanonical(rawId, canonicalId, platformLabel) {
  if (rawId === canonicalId) return { merged: false, reason: 'same account' };
  if (linkMap[rawId] === canonicalId) return { merged: false, reason: 'already linked' };

  const src = users[rawId];
  const dst = users[canonicalId];

  if (!dst) {
    // Canonical profile vanished somehow — just promote src to that id
    if (src) { users[canonicalId] = { ...src, id: canonicalId }; delete users[rawId]; }
    linkMap[rawId] = canonicalId;
    saveState();
    return { merged: true, totalXp: users[canonicalId]?.xp || 0 };
  }

  if (src) {
    dst.xp        = (dst.xp || 0) + (src.xp || 0);
    dst.wins      = (dst.wins || 0) + (src.wins || 0);
    dst.losses    = (dst.losses || 0) + (src.losses || 0);
    dst.tapouts   = (dst.tapouts || 0) + (src.tapouts || 0);
    dst.comments  = (dst.comments || 0) + (src.comments || 0);
    dst.gifts     = (dst.gifts || 0) + (src.gifts || 0);
    dst.follows   = (dst.follows || 0) + (src.follows || 0);
    dst.shares    = (dst.shares || 0) + (src.shares || 0);
    dst.likes     = (dst.likes || 0) + (src.likes || 0);
    dst.streak    = Math.max(dst.streak || 0, src.streak || 0);
    dst.bestStreak= Math.max(dst.bestStreak || 0, src.bestStreak || 0);
    dst.lastActive= Math.max(dst.lastActive || 0, src.lastActive || 0);
    dst.isFollower= dst.isFollower || src.isFollower;
    if (!dst.linkedPlatforms) dst.linkedPlatforms = [];
    if (platformLabel && !dst.linkedPlatforms.includes(platformLabel)) dst.linkedPlatforms.push(platformLabel);
    // Store all linked usernames as aliases for lookup
    if (!dst.aliases) dst.aliases = [];
    if (src.name && !dst.aliases.includes(src.name)) dst.aliases.push(src.name);
    delete users[rawId];
  }

  const oldRank = getRank((dst.xp || 0) - (src?.xp || 0), dst.pathChoice).id;
  dst.rankId = getRank(dst.xp, dst.pathChoice).id;
  linkMap[rawId] = canonicalId;
  console.log(`🔗 [LINKMAP] Set ${rawId.substring(0,20)}... → ${canonicalId.substring(0,20)}...`);
  console.log(`🔗 [VERIFY] resolveId(${rawId.substring(0,20)}...) = ${resolveId(rawId).substring(0,20)}...`);
  saveState();
  debouncedPush();

  if (dst.rankId > oldRank) {
    const nr = getRank(dst.xp, dst.pathChoice);
    send(wssLB, { type: 'rankup', userId: canonicalId, name: dst.name,
      oldRank: { id: oldRank, short: rankFor(oldRank, dst.pathChoice).short },
      newRank: { id: nr.id, short: nr.short, name: nr.name, color: nr.color, aura: nr.aura } });
  }

  return { merged: true, totalXp: dst.xp, name: dst.name };
}

// Call this from every platform's chat handler, same pattern as
// handleLinkCommand. Returns true if the message was a path choice (caller
// should skip normal chat-XP for that message).
// ── CHALLENGE COMMAND (!challenge <name>) ─────────────────────────────────────
// Allows viewers to challenge others to a duel via chat comment
function handleChallengeCommand(rawId, name, text) {
  const t = (text || '').trim();
  if (!/^!challenge\s+/i.test(t)) return false;

  const parts = t.split(/\s+/);
  const targetName = parts.slice(1).join(' ');
  if (!targetName) return true; // malformed but still a command

  const callerId = resolveId(rawId);
  const caller = users[callerId];
  if (!caller) return true; // caller has no XP yet

  // Find target by name
  const target = findUser(targetName);
  if (!target) {
    console.log(`⚔️  ${name} challenged unknown user "${targetName}"`);
    send(wssLB, { type: 'activity', action: 'challenge', userId: callerId, name,
                  detail: `challenged "${targetName}" but they don't exist` });
    return true;
  }

  // Both must be active (within last 90s) to be eligible
  const now = Date.now();
  if ((now - (caller.lastActive || 0)) > BATTLE.activeMs) {
    console.log(`⚔️  ${name} tried to challenge but they are inactive`);
    return true;
  }
  if ((now - (target.lastActive || 0)) > BATTLE.activeMs) {
    console.log(`⚔️  ${name} challenged ${target.name} but target is offline`);
    send(wssLB, { type: 'activity', action: 'challenge', userId: callerId, name,
                  detail: `challenged ${target.name} but they're offline` });
    return true;
  }

  // Both must be at minimum rank
  if (caller.xp < BATTLE.minXp || target.xp < BATTLE.minXp) {
    console.log(`⚔️  ${name} challenged ${target.name} but one is below min rank`);
    return true;
  }

  // Success — fire a duel battle with these two
  console.log(`⚔️  ${name} challenged ${target.name} to a DUEL!`);

  const b = {
    kind: 'duel',
    contenders: [
      { id: callerId, name: caller.name, xp: caller.xp },
      { id: target.id, name: target.name, xp: target.xp }
    ],
    extra: 0,
    total: 2,
    spread: Math.abs(caller.xp - target.xp),
    rank: getRank(Math.max(caller.xp, target.xp)).short,
    rankColor: getRank(Math.max(caller.xp, target.xp)).color,
    nextRank: nextRankAfter(getRank(Math.max(caller.xp, target.xp)).id).short,
    nextXp: nextRankAfter(getRank(Math.max(caller.xp, target.xp)).id).xp,
    leader: caller.xp > target.xp ? caller.name : target.name,
    key: [callerId, target.id].sort().join('|'),
  };

  lastBattleAt = now;
  lastBattleKey = b.key;
  lastBattleLead = b.leader;

  send(wssLB, { type: 'battle', ...b, leadChange: false, displayMs: BATTLE.displayMs });
  startRace(b);
  return true;
}

function handlePathCommand(rawId, name, text) {
  const t = (text || '').trim().toLowerCase();
  if (t !== '!ssbe' && t !== '!uisign') return false;

  const id = resolveId(rawId);
  const u  = users[id];
  if (!u) return true; // no XP history yet — nothing to assign a path to

  if (u.xp < 520000) {
    console.log(`⚔️  ${name} tried to pick a path early (${u.xp.toLocaleString()} XP, needs 520,000)`);
    return true;
  }
  if (u.pathChoice) {
    console.log(`⚔️  ${name} already locked in ${u.pathChoice} — path choice is permanent`);
    return true;
  }

  u.pathChoice = (t === '!ssbe') ? 'ssbe' : 'uisign';
  u.rankId = getRank(u.xp, u.pathChoice).id;
  saveState();
  debouncedPush();

  const rank = rankFor(8, u.pathChoice);
  console.log(`⚔️  ${name} chose their path — ${rank.name} (${rank.short})`);
  send(wssLB, { type: 'pathChosen', userId: id, name: u.name,
                path: u.pathChoice, short: rank.short, color: rank.color, aura: rank.aura, emoji: rank.emoji });
  return true;
}

// Call this from every platform's chat handler. Returns true if the message
// was a link command (caller should skip normal chat-XP for that message).
function handleLinkCommand(rawId, name, text, platform) {
  const t = (text || '').trim();
  if (!/^!link\b/i.test(t)) return false;

  const parts = t.split(/\s+/);
  const canonicalOfSender = resolveId(rawId);

  if (parts.length === 1) {
    // Generate a code tied to whichever profile this platform already resolves to
    const code = genLinkCode();
    linkCodes[code] = { canonicalId: canonicalOfSender, name, platform, createdAt: Date.now() };
    console.log(`🔗 LINK CODE for ${name} (${platform}/${rawId}): ${code}  — expires in 10 min`);
    console.log(`   Canonical ID: ${canonicalOfSender}`);
    console.log(`   ✅ Sent to overlay — should appear on screen now`);
    send(wssLB, { type: 'linkCode', name, platform, code });
    return true;
  }

  // "!link CODE"
  const code = parts[1].toUpperCase();
  const entry = linkCodes[code];

  if (!entry) {
    console.log(`🔗 ${name} used invalid code: ${code}`);
    return true;
  }

  if ((Date.now() - entry.createdAt) > LINK_CODE_TTL) {
    console.log(`🔗 ${name} used expired code: ${code} (generated ${Math.round((Date.now() - entry.createdAt)/1000)}s ago)`);
    return true;
  }

  if (entry.platform === platform) {
    console.log(`🔗 ${name} tried linking same platform: ${platform}↔${platform}`);
    console.log(`   Code was generated on: ${entry.platform}`);
    console.log(`   Must use code from a DIFFERENT platform`);
    return true;
  }

  delete linkCodes[code];
  console.log(`🔗 Attempting merge:`);
  console.log(`   Sender (${platform}): ${canonicalOfSender} (${name})`);
  console.log(`   Entry canonical (${entry.platform}): ${entry.canonicalId}`);
  // MERGE INTO THE TIKTOK ACCOUNT (canonicalOfSender) — keeps TikTok name and unified activity
  const result = mergeIntoCanonical(entry.canonicalId, canonicalOfSender, entry.platform);
  if (result.merged) {
    console.log(`🔗 ✅ LINKED — ${name}: ${entry.platform} + ${platform} → ${fmtXP(result.totalXp)} XP combined`);
    console.log(`🔗 [TEST] resolveId('${canonicalOfSender}') = ${resolveId(canonicalOfSender)}`);
    console.log(`🔗 [TEST] resolveId('${entry.canonicalId}') = ${resolveId(entry.canonicalId)}`);
    send(wssLB, { type: 'linkSuccess', name: result.name || name, totalXp: result.totalXp,
                  platforms: [entry.platform, platform] });
  } else {
    console.log(`🔗 ❌ Link failed for ${name}: ${result.reason}`);
    console.log(`   Source: ${canonicalOfSender} | Target: ${entry.canonicalId}`);
  }
  return true;
}

function fmtXP(n) {
  if (n >= 1000000) return (n/1000000).toFixed(2) + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
  return String(n);
}

// Which platform this event came from — read from the RAW id (before link
// resolution reassigns it) so watch-time credit survives account linking.
function inferPlatform(rawId, extra) {
  if (extra && extra.platform) return extra.platform;
  if (rawId.startsWith('tw:')) return 'twitch';
  if (rawId.startsWith('kk:')) return 'kick';
  if (rawId.startsWith('yt:')) return 'youtube';
  return 'tiktok';
}


// ── YOUTUBE LIVE CHAT ──────────────────────────────────────────────────────────
// OAuth2 Setup for YouTube Live Chat
const YOUTUBE_CLIENT_ID = '674951840146-7d7srkfdk46vqh0j9qqjqrfoc1a7hgc6.apps.googleusercontent.com';
const YOUTUBE_CLIENT_SECRET = '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';
const YOUTUBE_REDIRECT_URI = 'http://localhost:8081/auth/youtube-callback';
const YOUTUBE_TOKEN_FILE = join(__dirname, 'youtube-token.json');

const oauth2Client = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI);
let youtubeAuthToken = null;
let youtube = null;

function loadYouTubeToken() {
  if (existsSync(YOUTUBE_TOKEN_FILE)) {
    try {
      const token = JSON.parse(readFileSync(YOUTUBE_TOKEN_FILE, 'utf8'));
      oauth2Client.setCredentials(token);
      youtubeAuthToken = token;
      youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      console.log('🎥 YouTube → OAuth2 token loaded');
      return true;
    } catch (e) {
      console.log('🎥 YouTube → token load failed:', e.message);
    }
  }
  return false;
}

function saveYouTubeToken(token) {
  try {
    writeFileSync(YOUTUBE_TOKEN_FILE, JSON.stringify(token, null, 2));
    youtubeAuthToken = token;
    oauth2Client.setCredentials(token);
    youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    console.log('🎥 YouTube → OAuth2 token saved');
  } catch (e) {
    console.log('🎥 YouTube → token save error:', e.message);
  }
}

// Try to load existing token
loadYouTubeToken();

let youtubeActiveLiveChat = null;
let youtubeLastMessageTime = 0;
let youtubeFailureCount = 0;  // Stop polling after broadcast ends
let processedYouTubeMessageIds = new Set(); // Track processed messages to avoid duplicates

async function connectYouTube() {
  const channelId = MULTISTREAM.youtube;
  if (!channelId || !youtube) return;

  // Stop retrying after broadcast clearly ended
  if (youtubeFailureCount >= 5) {
    if (youtubeFailureCount === 5) {
      console.log(`🎥 YouTube → broadcast is offline, polling stopped`);
    }
    youtubeFailureCount = 6;
    return;
  }

  try {
    console.log(`🎥 YouTube → checking for active broadcast...`);

    // Get fresh access token
    const { credentials } = await oauth2Client.refreshAccessToken();
    const accessToken = credentials.access_token;

    // Try liveStreams first (actual ingestion streams)
    console.log(`🎥 YouTube → trying liveStreams endpoint...`);
    const sResponse = await fetch('https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,contentDetails&mine=true&maxResults=50', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const sData = await sResponse.json();
    console.log(`🎥 YouTube liveStreams Status: ${sResponse.status}, items: ${sData.items?.length || 0}`);

    // Try liveBroadcasts with correct part parameters
    console.log(`🎥 YouTube → trying liveBroadcasts endpoint...`);
    const bResponse = await fetch('https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,contentDetails&mine=true&maxResults=50', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const bData = await bResponse.json();
    console.log(`🎥 YouTube liveBroadcasts Status: ${bResponse.status}, items: ${bData.items?.length || 0}`);

    // Look for a broadcast
    if (bData.error) {
      console.log(`🎥 YouTube → liveBroadcasts error: ${bData.error.message}`);
      setTimeout(connectYouTube, 30000);
      return;
    }

    const broadcast = bData.items?.[0];
    if (!broadcast) {
      console.log(`🎥 YouTube → no broadcasts found, trying to get chat from status...`);
      // If no broadcasts, try the status endpoint which has the activeLiveChatId
      const statusResponse = await fetch('https://www.googleapis.com/youtube/v3/liveBroadcasts?part=status&mine=true&maxResults=50', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const statusData = await statusResponse.json();
      if (!statusData.items || statusData.items.length === 0) {
        console.log(`🎥 YouTube → no broadcasts found on any endpoint`);
        setTimeout(connectYouTube, 30000);
        return;
      }
    }

    console.log(`🎥 YouTube broadcast title: ${broadcast.snippet?.title}`);
    // Get chat ID from snippet field (where YouTube puts it for live broadcasts)
    const chatId = broadcast.snippet?.liveChatId;
    if (!chatId) {
      console.log(`🎥 YouTube → broadcast found but no chat ID in snippet field`);
      setTimeout(connectYouTube, 30000);
      return;
    }

    youtubeActiveLiveChat = chatId;
    console.log(`🎥 YouTube → ✅ connected to live chat (${broadcast.snippet.title})`);
    pollYouTubeChat();
  } catch (e) {
    console.log(`🎥 YouTube connection error: ${e.message}`);
    setTimeout(connectYouTube, 5000);
  }
}

async function pollYouTubeChat() {
  if (!youtubeActiveLiveChat) {
    connectYouTube();
    return;
  }

  try {
    const messages = await youtube.liveChatMessages.list({
      liveChatId: youtubeActiveLiveChat,
      part: 'snippet,authorDetails',
      maxResults: 200,
      pageToken: null
    });

    const now = Date.now();
    for (const msg of (messages.data.items || [])) {
      const messageId = msg.id;

      // Skip if already processed
      if (processedYouTubeMessageIds.has(messageId)) {
        continue;
      }

      // Skip messages older than last poll (except on first run)
      if (youtubeLastMessageTime > 0 && msg.snippet.publishedAt) {
        const msgTime = new Date(msg.snippet.publishedAt).getTime();
        if (msgTime < youtubeLastMessageTime) {
          continue;
        }
      }

      processedYouTubeMessageIds.add(messageId);

      // Limit set size to prevent memory leak (keep last 10k messages)
      if (processedYouTubeMessageIds.size > 10000) {
        const arr = Array.from(processedYouTubeMessageIds);
        processedYouTubeMessageIds = new Set(arr.slice(-5000));
      }

      const author = msg.authorDetails.displayName;
      const ytId = 'yt:' + (msg.authorDetails.channelId || author).toLowerCase();
      const text = msg.snippet.displayMessage || '';

      // Parse message type
      const msgType = msg.snippet.type;

      if (msgType === 'textMessageEvent') {
        elog(`💬 [YOUTUBE] ${author}: ${text}`);
        if (!handlePathCommand(ytId, author, text) && !handleChallengeCommand(ytId, author, text) && !handleLinkCommand(ytId, author, text, 'youtube')) {
          addXP(ytId, author, 'chat', XP_RATES.chat, 0, { platform: 'youtube' });
        }
        broadcastChat({ platform: 'youtube', user: author, displayName: author, message: text });
      } else if (msgType === 'superChatEvent') {
        const amountMicros = msg.snippet.superChatDetails?.amountMicros || 0;
        const amountUSD = amountMicros / 1000000;
        const xp = dollarsToXP(amountUSD);
        console.log(`🎁 [YOUTUBE] ${author} Super Chat $${amountUSD.toFixed(2)} (+${xp.toLocaleString()} XP)`);
        addXP(ytId, author, 'gift', xp, 1, { platform: 'youtube' });
        send(wssLB, { type: 'economyEvent', platform: 'youtube', kind: 'superchat', name: author, xp,
                      detail: `Super Chat $${amountUSD.toFixed(2)}` });
      } else if (msgType === 'superStickerEvent') {
        const amountMicros = msg.snippet.superStickerDetails?.amountMicros || 0;
        const amountUSD = amountMicros / 1000000;
        const xp = dollarsToXP(amountUSD);
        console.log(`✨ [YOUTUBE] ${author} Super Sticker $${amountUSD.toFixed(2)} (+${xp.toLocaleString()} XP)`);
        addXP(ytId, author, 'gift', xp, 1, { platform: 'youtube' });
        send(wssLB, { type: 'economyEvent', platform: 'youtube', kind: 'supersticker', name: author, xp,
                      detail: `Super Sticker $${amountUSD.toFixed(2)}` });
      }
    }

    youtubeLastMessageTime = now;
    youtubeFailureCount = 0;  // Reset on successful poll
  } catch (e) {
    console.log(`🎥 YouTube poll error: ${e.message}`);
    youtubeActiveLiveChat = null;
    youtubeFailureCount++;  // Count failures
    if (youtubeFailureCount < 5) {
      setTimeout(connectYouTube, 30000);
    }
    return;
  }

  // Poll every 2 seconds
  setTimeout(pollYouTubeChat, 2000);
}

// ── WATCH-TIME XP ────────────────────────────────────────────────────────────
// TikTok viewers can passively rack up XP by liking constantly — no equivalent
// exists on Twitch, Kick, or YouTube. This gives them the same "still here,
// still earning" trickle: anyone whose most recent activity came from a
// non-TikTok platform gets a small silent XP tick every minute they're
// presumed still watching. No toast, no announcement — same as likes.
const WATCH_RATES = {
  enabled:      true,
  perMinute:    15,             // XP per minute, per watching viewer
  idleCutoffMs: 15 * 60_000,    // stop crediting after this long with no activity
};

function watchTimeTick() {
  if (!WATCH_RATES.enabled) return;
  const now = Date.now();
  for (const u of Object.values(users)) {
    if (!u.lastPlatform || u.lastPlatform === 'tiktok') continue;
    if ((now - (u.lastActive || 0)) >= WATCH_RATES.idleCutoffMs) continue;
    addXP(u.id, u.name, 'watch', WATCH_RATES.perMinute, 0, { platform: u.lastPlatform });
  }
}
setInterval(watchTimeTick, 60_000);

function addXP(userId, name, action, amount, extraCount, extra) {
  const platform = inferPlatform(userId, extra);
  const originalId = userId;
  userId = resolveId(userId);
  if (originalId !== userId) {
    console.log(`🔗 [RESOLVE] ${action} from ${originalId.substring(0, 20)}... → ${userId.substring(0, 20)}...`);
  }
  const now = Date.now();
  if (!users[userId]) {
    users[userId] = {
      id: userId, name, xp: 0, rankId: 0, pathChoice: null,
      comments: 0, gifts: 0, follows: 0, shares: 0, likes: 0,
      wins: 0, losses: 0, tapouts: 0, streak: 0, bestStreak: 0,
      firstSeen: now, lastSeen: now, lastActive: now, sessions: 0,
      activePlatforms: [],  // ← Track which platforms they're currently on
      tiktokDiamonds: 0,    // ← TikTok coin donations (public)
      stripeDonated: 0,     // ← Stripe donation amount in cents (private - admin only)
    };
  }

  const u = users[userId];
  u.name         = name;
  u.lastPlatform = platform;
  // Passive watch-time ticks shouldn't refresh the "still active" clock —
  // only real interaction (chat, gift, follow, share) should. Otherwise a
  // viewer who tabbed away would keep earning forever on their own residue.
  if (action !== 'watch') {
    u.lastSeen = now;
    u.lastActive = now;
    // Add platform to activePlatforms if not already there
    if (platform && !u.activePlatforms?.includes(platform)) {
      u.activePlatforms = u.activePlatforms || [];
      u.activePlatforms.push(platform);
    }
  }
  u.xp        += amount;
  if (action === 'chat')   u.comments++;
  if (action === 'like')   u.likes += (extraCount || 1);
  if (action === 'follow') u.follows++;
  if (action === 'share')  u.shares++;
  if (action === 'gift') { u.gifts++; }
  
  // Track daily community stats
  if (!u.dailyXpGained) u.dailyXpGained = 0;
  if (!u.dailyGiftValue) u.dailyGiftValue = 0;  // Track value, not count
  if (!u.dailyFollows) u.dailyFollows = 0;
  if (!u.dailyChats) u.dailyChats = 0;
  
  u.dailyXpGained += amount;
  dailyStats.totalXpGained += amount;
  
  if (action === 'gift') {
    const giftValue = extra?.coins || 0;  // Get coin value from gift
    u.tiktokDiamonds = (u.tiktokDiamonds || 0) + giftValue;  // Track TikTok diamonds (public)
    u.dailyGiftValue += giftValue;
    dailyStats.totalGiftValue += giftValue;
    if (!dailyStats.topGifter || u.dailyGiftValue > dailyStats.topGifter.value) {
      dailyStats.topGifter = { name: u.name, value: u.dailyGiftValue, coins: u.dailyGiftValue };
    }
  }
  if (action === 'donate') {
    const donationValue = extra?.cents || 0;  // Get donation value in cents
    u.stripeDonated = (u.stripeDonated || 0) + donationValue;  // Track Stripe (private)
    u.dailyGiftValue += donationValue;
    dailyStats.totalGiftValue += donationValue;
    if (!dailyStats.topGifter || u.dailyGiftValue > dailyStats.topGifter.value) {
      dailyStats.topGifter = { name: u.name, value: u.dailyGiftValue, coins: u.dailyGiftValue };
    }
  }
  if (action === 'follow') {
    u.dailyFollows++;
    dailyStats.totalFollows++;
    if (!dailyStats.topFollower || u.dailyFollows > dailyStats.topFollower.follows) {
      dailyStats.topFollower = { name: u.name, follows: u.dailyFollows };
    }
  }
  if (action === 'chat') {
    u.dailyChats++;
    dailyStats.totalChats++;
    if (!dailyStats.topChatter || u.dailyChats > dailyStats.topChatter.messages) {
      dailyStats.topChatter = { name: u.name, messages: u.dailyChats };
    }
  }
  
  // Update MVP (most XP gained today)
  if (!dailyStats.mvp || u.dailyXpGained > dailyStats.mvp.xp) {
    dailyStats.mvp = { name: u.name, xp: u.dailyXpGained };
  }

  // Guard: if a stored rankId is out of sync with XP (e.g. thresholds changed),
  // correct it silently before comparing so transformations still fire.
  const derivedOld = getRank(Math.max(0, u.xp - amount), u.pathChoice).id;
  const oldRankId  = (typeof u.rankId === 'number' && u.rankId <= derivedOld) ? u.rankId : derivedOld;
  const newRank    = getRank(u.xp, u.pathChoice);
  u.rankId = newRank.id;

  // Build entry directly from user data so XP is always sent,
  // even when the user isn't in the top-200 leaderboard slice.
  const board      = getLeaderboard();
  const boardEntry = board.find(e => String(e.id) === String(userId));
  const entry      = boardEntry || {
    ...u,
    position: null,
    rankName: newRank.short,
  };

  // Include activePlatforms in the entry so overlay shows the right icons
  entry.activePlatforms = u.activePlatforms || [];

  // Activity → leaderboard overlay
  send(wssLB, {
    type:   'activity',
    action,
    userId,
    name,
    xp:     amount,
    count:  extraCount || 0,
    coins:  extra?.coins || 0,
    entry,
    platform, // ← Also send platform so overlay knows which icon to show
  });

  // Rivalry / battle check
  try { maybeBattle(); } catch (e) {}

  // Rank-up notification
  if (newRank.id > oldRankId) {
    const oldRank = rankFor(oldRankId, u.pathChoice) || RANKS[0];
    console.log(`⬆️  RANK UP: ${name} ${oldRank.short} → ${newRank.short}`);
    send(wssLB, {
      type:    'rankup',
      userId,
      name,
      oldRank: { id: oldRankId, short: oldRank.short, name: oldRank.name },
      newRank: { id: newRank.id, short: newRank.short, name: newRank.name,
                 color: newRank.color, aura: newRank.aura },
    });
  }

  debouncedPush();
  return entry;
}

// ── BEAM STRUGGLE DETECTION ────────────────────────────────────────────────────
// Track recent large gifts to detect simultaneous clashes (within 1 second)
let recentLargeGifts = [];
function recordLargeGift(name, xp) {
  const now = Date.now();
  recentLargeGifts.push({ name, xp, at: now });
  recentLargeGifts = recentLargeGifts.filter(g => (now - g.at) < 1000); // Clean up old entries
}

function checkBeamStruggle(xp, name) {
  if (xp < 2500) return null; // Only large gifts trigger beam struggle
  const others = recentLargeGifts.filter(g => g.name !== name && (Date.now() - g.at) < 1000);
  return others.length > 0 ? others : null;
}

// ── USER HELPERS ───────────────────────────────────────────────────────────
// uniqueId is the @ handle — most reliable key.
// userId is TikTok's numeric ID — reliable fallback when uniqueId is absent.
// nickname alone is NOT reliable (non-unique), only used as last resort.
function uid(u)  { return u.uniqueId || (u.userId ? String(u.userId) : null) || u.nickname || 'unknown'; }
function uname(u){ return u.nickname || u.uniqueId || 'viewer'; }

// ── SIGN SERVER PROXY (port 8084) ─────────────────────────────────────────
// Intercepts the room_id request so we can return a fresh room ID,
// then forwards everything else to the real sign server unchanged.
// This lets the library use its normal credential path (no 403).
let manualRoomId = null;

const proxySignApp  = express();
const httpProxySign = createServer(proxySignApp);
proxySignApp.use(express.json());

proxySignApp.post('/webcast/room_id', async (req, res) => {
  const fresh = manualRoomId || await fetchRoomIdDirect();
  manualRoomId = null;
  if (fresh) {
    console.log(`🔧 Sign proxy → room ID ${fresh}`);
    return res.json({ status_code: 0, data: { room_id: fresh } });
  }
  // Couldn't scrape — forward to real sign server
  try {
    const r = await fetch('https://api.tik.tools/webcast/room_id', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(req.body),
    });
    res.json(await r.json());
  } catch { res.json({ status_code: 1, message: 'proxy error' }); }
});

proxySignApp.use(async (req, res) => {
  try {
    const r = await fetch(`https://api.tik.tools${req.path}`, {
      method: req.method,
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
      body: ['POST','PUT','PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
    });
    res.status(r.status).json(await r.json());
  } catch { res.status(502).json({ status_code: 1 }); }
});

httpProxySign.listen(8084, () => console.log('🔧 Sign proxy   → localhost:8084'));

// ── DISCORD CLIENT ─────────────────────────────────────────────────────────
const dclient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

dclient.on('ready', () => console.log(`🤖 Discord: ${dclient.user.tag}`));
// Store last Discord message for logging context
let lastDiscordMsg = null;

// Intercept console.log to capture command output
const originalLog = console.log;
let capturedOutput = [];
function captureLog(...args) {
  const text = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
  capturedOutput.push(text);
  originalLog(...args);
}
console.log = captureLog;

// Helper to send message that auto-deletes after 5 minutes
async function sendAutoDelete(msg, content) {
  const sent = await msg.reply(content);
  setTimeout(() => sent.delete().catch(() => {}), 5 * 60 * 1000); // 5 minutes
  return sent;
}

dclient.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  
  // Auto-delete single-letter typos (keeps chat clean)
  const singleLetter = msg.content.trim().length === 1 && !/^[abc]$/i.test(msg.content.trim());
  if (singleLetter) {
    msg.delete().catch(() => {});
    return;
  }
  
  // Award XP for any chat message (before command check)
  addXP(msg.author.id, msg.author.username, 'chat', XP_RATES.chat, 0, { platform: 'discord' });
  
  // Allow single-letter trivia answers (a/b/c) without !
  const isTrivia = /^[abc]$/i.test(msg.content.trim());
  
  // Auto-delete command messages after 30 seconds (keeps chat clean)
  if (msg.content.startsWith('!') || isTrivia) {
    setTimeout(() => msg.delete().catch(() => {}), 30000);
  }
  
  // Other commands require !
  if (!isTrivia && !msg.content.startsWith('!')) return;
  
  lastDiscordMsg = msg;
  capturedOutput = [];
  const input = isTrivia ? msg.content : msg.content.slice(1);
  let parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  
  // Check for Discord @mentions for admin commands
  if (msg.mentions.users.size > 0 && (cmd === 'xp' || cmd === 'rank' || cmd === 'add' || cmd === 'del')) {
    const mentionedUser = msg.mentions.users.first();
    // Replace the mention with the Discord ID for the admin command to process
    parts[1] = mentionedUser.id;
  }
  
  // Handle Discord-specific commands
  if (cmd === 'profile' || cmd === 'me' || cmd === 'who') {
    let name = msg.author.username;
    let isOwnProfile = true;
    let discordId = msg.author.id;
    
    // Check for Discord mention (@user)
    if (msg.mentions.users.size > 0) {
      const mentioned = msg.mentions.users.first();
      name = mentioned.username;
      discordId = mentioned.id;
      isOwnProfile = msg.author.id === mentioned.id;
    } else if (parts.length > 1) {
      // Or use provided name
      name = parts.slice(1).join(' ');
      isOwnProfile = false;
      discordId = null;
    }
    
    // For own profile or mentioned user, lookup by Discord ID first (handles linked accounts)
    let u = null;
    if (discordId) {
      u = users[discordId] || users[resolveId(discordId)];
    }
    // Fallback to name lookup for searches
    if (!u) {
      u = findUser(name);
    }
    
    // Auto-create profile if viewing own profile and doesn't exist
    if (!u && isOwnProfile) {
      const userId = msg.author.id;
      users[userId] = {
        id: userId,
        name: msg.author.username,
        xp: 0,
        rankId: 0,
        pathChoice: null,
        comments: 0,
        gifts: 0,
        follows: 0,
        shares: 0,
        likes: 0,
        wins: 0,
        losses: 0,
        tapouts: 0,
        streak: 0,
        bestStreak: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        lastActive: Date.now(),
        sessions: 0,
        activePlatforms: ['discord'],
        linkedAccounts: {},
        tiktokDiamonds: 0,    // TikTok coins (public)
        stripeDonated: 0      // Stripe donations in cents (private - admin only)
      };
      saveState();
      u = users[userId];
    }
    
    if (!u) {
      return sendAutoDelete(msg, `❌ No user matching "${name}". Start earning PL to join the leaderboard!`);
    }
    
    const rank = getRank(u.xp, u.pathChoice);
    const nextRank = nextRankAfter(rank.id, u.pathChoice);
    const pct = rank.id >= MAX_RANK_ID ? 100 : Math.round((u.xp - rank.xp) / (nextRank.xp - rank.xp) * 100);
    
    // Build platform/integration list
    const platforms = [];
    if (u.activePlatforms && u.activePlatforms.length > 0) {
      platforms.push(...u.activePlatforms);
    }
    platforms.push('discord'); // Always include Discord
    const uniquePlatforms = [...new Set(platforms)]; // Remove duplicates
    
    const platformEmojis = {
      'discord': '💜',
      'tiktok': '🎵',
      'twitch': '💜',
      'kick': '❤️',
      'youtube': '🔴'
    };
    
    const platformList = uniquePlatforms.map(p => `${platformEmojis[p] || '📱'} ${p.toUpperCase()}`).join(' | ');
    
    const xpNeeded = Math.max(0, nextRank.xp - u.xp);
    const embed = {
      color: 0x3498db,
      title: `👤 ${u.name}`,
      description: `**Integrated Platforms:** ${platformList}`,
      fields: [
        { name: '💪 Rank', value: `${rank.short} (${rank.name})`, inline: true },
        { name: '⚡ PL (Power Level)', value: `${u.xp.toLocaleString()} / ${nextRank.xp.toLocaleString()}`, inline: true },
        { name: '📈 Progress', value: `${Math.round(pct)}% (${xpNeeded.toLocaleString()} XP to next)`, inline: true },
      ],
    };
    
    // Activity Stats
    if (u.comments || u.gifts || u.follows || u.likes) {
      embed.fields.push({
        name: '📊 Activity',
        value: `💬 ${u.comments || 0} chats | 🎁 ${u.gifts || 0} gifts | 👥 ${u.follows || 0} follows | ❤️ ${u.likes || 0} likes`,
        inline: false
      });
    }
    
    // TikTok Diamonds (Public)
    if ((u.tiktokDiamonds || 0) > 0) {
      embed.fields.push({
        name: '💎 TikTok Diamonds',
        value: `${(u.tiktokDiamonds || 0).toLocaleString()} diamonds donated`,
        inline: false
      });
    }
    
    // Stripe Donations (Admin Only - hide from public, only show to you or user viewing own profile)
    if ((u.stripeDonated || 0) > 0) {
      const userIsAdmin = msg.author.id === '807824859652128768';
      if (userIsAdmin || isOwnProfile) {
        const donationUSD = ((u.stripeDonated || 0) / 100).toFixed(2);
        embed.fields.push({
          name: '💳 Stripe Donations (Private)',
          value: `$${donationUSD} USD donated`,
          inline: false
        });
      }
    }
    
    // Stripe Donations (Admin Only - only show if viewing own profile or admin)
    const isAdmin = msg.author.id === '807824859652128768'; // Your Discord ID
    const canSeeStripe = isAdmin || isOwnProfile;
    if ((u.stripeDonated || 0) > 0 && canSeeStripe) {
      const donationUSD = ((u.stripeDonated || 0) / 100).toFixed(2);
      embed.fields.push({
        name: '💳 Stripe Donations (Private)',
        value: `$${donationUSD} USD donated (visible only to admin)`,
        inline: false
      });
    }
    
    if (u.wins || u.losses) {
      embed.fields.push({ 
        name: '🏆 Record', 
        value: `${u.wins || 0}W - ${u.losses || 0}L${u.streak > 1 ? ` (🔥 ${u.streak} streak)` : ''}`, 
        inline: false 
      });
    }
    
    if (u.pathChoice) {
      embed.fields.push({ 
        name: '🛤️  Path', 
        value: u.pathChoice.toUpperCase(), 
        inline: false 
      });
    }
    
    // Linked Accounts
    if (u.linkedPlatforms && u.linkedPlatforms.length > 0) {
      embed.fields.push({
        name: '🔗 Linked Accounts',
        value: u.linkedPlatforms.join(', ').toUpperCase(),
        inline: false
      });
    }
    
    return sendAutoDelete(msg, { embeds: [embed] });
  }
  
  
  if (cmd === 'trivia') {
    const started = startTrivia();
    
    // Check if trivia was actually started (not blocked by cooldown/already active)
    if (!started) {
      return sendAutoDelete(msg, '⏳ Trivia on cooldown or already active. Please wait 30 seconds or answer the current question!');
    }
    
    const q = triviaActive.question;
    const opts = triviaActive.options;
    const embed = {
      color: 0xffaa00,
      title: `🎯 TRIVIA [${triviaActive.difficulty.toUpperCase()}]`,
      description: q,
      fields: [
        { name: 'a)', value: opts[0], inline: true },
        { name: 'b)', value: opts[1], inline: true },
        { name: 'c)', value: opts[2], inline: true },
      ],
      footer: { text: 'Type a, b, or c to answer' },
    };
    return sendAutoDelete(msg, { embeds: [embed] });
  }

  if (cmd === 'a' || cmd === 'b' || cmd === 'c') {
    // Check trivia cooldown (15 minutes)
    const now = Date.now();
    const lastAnswer = triviaCooldowns[msg.author.id] || 0;
    const cooldownRemaining = TRIVIA_COOLDOWN_MS - (now - lastAnswer);
    
    if (cooldownRemaining > 0) {
      const mins = Math.ceil(cooldownRemaining / 60000);
      return sendAutoDelete(msg, `⏳ Trivia cooldown: ${mins}m remaining`);
    }
    
    if (!triviaActive) {
      return sendAutoDelete(msg, '❌ No trivia active. Start with `!trivia`');
    }
    
    // Only first person to answer gets PL
    if (triviaAnswered) {
      return sendAutoDelete(msg, '⏳ Someone already answered this question!');
    }
    
    const idx = cmd.charCodeAt(0) - 97;
    const selected = triviaActive.options[idx];
    
    if (!selected) {
      return sendAutoDelete(msg, '❌ Invalid option');
    }
    
    if (selected === triviaActive.answer) {
      const plReward = { easy: 500, medium: 1000, hard: 1500, insane: 2500 }[triviaActive.difficulty] || 500;
      
      // Record cooldown for this user
      triviaCooldowns[msg.author.id] = now;
      
      // Award PL to the first person who answered
      const answerer = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
      addXP(answerer.id, msg.author.username, 'trivia', plReward, 1, { difficulty: triviaActive.difficulty });
      
      const embed = {
        color: 0x00ff00,
        title: '✅ CORRECT!',
        description: `${msg.author.username} earned **${plReward} PL**!`,
        fields: [
          { name: 'Difficulty', value: triviaActive.difficulty.toUpperCase(), inline: true },
          { name: 'Answer', value: triviaActive.answer, inline: true },
        ],
      };
      triviaActive = false;
      triviaAnswered = true; // Lock out other answers
      return sendAutoDelete(msg, { embeds: [embed] });
    } else {
      // Penalize wrong answer based on difficulty
      const penaltyMap = { easy: 250, medium: 500, hard: 750, insane: 1250 };
      const xpPenalty = penaltyMap[triviaActive.difficulty] || 250;
      
      const wronger = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
      
      // Deduct XP (use negative value)
      addXP(wronger.id, msg.author.username, 'trivia_wrong', -xpPenalty, 1, { difficulty: triviaActive.difficulty });
      
      const embed = {
        color: 0xff0000,
        title: '❌ WRONG!',
        description: `The correct answer was: **${triviaActive.answer}**\n\n**−${xpPenalty} PL penalty** (${triviaActive.difficulty.toUpperCase()} difficulty)`,
        fields: [
          { name: 'You answered', value: `~~${selected}~~`, inline: true },
        ],
      };
      triviaActive = false;
      triviaAnswered = true; // Lock out other answers
      return sendAutoDelete(msg, { embeds: [embed] });
    }
  }
  
  if (cmd === 'daily') {
    const today = new Date().toLocaleDateString();
    const topGifterValue = dailyStats.topGifter?.value || 0;
    const topGifterDisplay = topGifterValue > 100 ? `$${(topGifterValue / 100).toFixed(2)}` : `${topGifterValue} coins`;
    
    const embed = {
      color: 0xf39c12,
      title: `📅 Daily Community Report`,
      description: `${today}`,
      fields: [
        { 
          name: '🏆 MVP (Most XP)', 
          value: `**${dailyStats.mvp?.name || 'N/A'}**\n${(dailyStats.mvp?.xp || 0).toLocaleString()} XP`, 
          inline: true 
        },
        { 
          name: '💸 Top Supporter', 
          value: `**${dailyStats.topGifter?.name || 'N/A'}**\n${topGifterDisplay}`, 
          inline: true 
        },
        { 
          name: '❤️  Top Follower', 
          value: `**${dailyStats.topFollower?.name || 'N/A'}**\n${dailyStats.topFollower?.follows || 0} follows`, 
          inline: true 
        },
        { 
          name: '💬 Top Chatter', 
          value: `**${dailyStats.topChatter?.name || 'N/A'}**\n${dailyStats.topChatter?.messages || 0} messages`, 
          inline: true 
        },
        {
          name: '📊 Community Stats',
          value: `Total XP: **${dailyStats.totalXpGained.toLocaleString()}**\nTotal Support Value: **$${(dailyStats.totalGiftValue / 100).toFixed(2)}** (TikTok + Donations)\nTotal Follows: **${dailyStats.totalFollows}**\nTotal Messages: **${dailyStats.totalChats}**\nActive Users: **${Object.values(users).filter(u => u.dailyXpGained > 0).length}**`,
          inline: false
        }
      ],
    };
    return sendAutoDelete(msg, { embeds: [embed] });
  }
  
  if (cmd === 'leaderboard' || cmd === 'lb') {
    const board = Object.values(users).sort((a, b) => b.xp - a.xp).slice(0, 10);
    const description = board.map((u, i) => {
      const rank = getRank(u.xp, u.pathChoice);
      const record = (u.wins || u.losses) ? ` | ${u.wins}W-${u.losses}L` : '';
      return `**${i + 1}.** ${u.name} - ${u.xp.toLocaleString()} XP (${rank.short})${record}`;
    }).join('\n');
    const embed = {
      color: 0xe74c3c,
      title: '🏁 TOP FIGHTERS',
      description: description || 'No users yet',
    };
    return sendAutoDelete(msg, { embeds: [embed] });
  }
  
  if (cmd === 'link') {
    // Generate a code to link Discord ↔ TikTok
    const code = genLinkCode();
    const userId = msg.author.id;
    linkCodes[code] = { canonicalId: userId, name: msg.author.username, platform: 'discord', createdAt: Date.now() };
    
    const embed = {
      color: 0x9b59b6,
      title: '🔗 DISCORD ↔ TIKTOK LINKING',
      description: `Your link code is ready!`,
      fields: [
        { name: 'Your Code', value: `\`${code}\``, inline: false },
        { name: 'How to Link', value: `During your TikTok livestream, type in chat:\n\`!link ${code}\``, inline: false },
        { name: 'Expires', value: '10 minutes', inline: true },
        { name: '✅ Result', value: 'All TikTok activity (chat, gifts, follows) counts toward your Discord profile!', inline: false },
      ],
      footer: { text: 'Code expires in 10 minutes. Need a new one? Type !link again' },
    };
    return sendAutoDelete(msg, { embeds: [embed] });
  }

  if (cmd === 'watch') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'off') { WATCH_RATES.enabled = false; return console.log('⏱️  Watch-time XP OFF'); }
    if (sub === 'on')  { WATCH_RATES.enabled = true;  return console.log('⏱️  Watch-time XP ON'); }
    if (sub === 'rate' && parts[2]) {
      const v = parseInt(parts[2]);
      if (!isNaN(v) && v >= 0) { WATCH_RATES.perMinute = v; return console.log(`⏱️  Watch-time rate: ${v} XP/min`); }
    }
    if (sub === 'cutoff' && parts[2]) {
      const v = parseInt(parts[2]);
      if (!isNaN(v) && v > 0) { WATCH_RATES.idleCutoffMs = v * 60_000; return console.log(`⏱️  Idle cutoff: ${v} min`); }
    }
    console.log(`\n⏱️  WATCH-TIME XP (Twitch/Kick/YouTube — TikTok already has likes)`);
    console.log(`   Status: ${WATCH_RATES.enabled ? 'ON' : 'OFF'}`);
    console.log(`   Rate:   ${WATCH_RATES.perMinute} XP/min`);
    console.log(`   Idle cutoff: ${WATCH_RATES.idleCutoffMs/60000} min of no activity stops it`);
    console.log(`   Change: watch rate 15 | watch cutoff 15 | watch on | watch off\n`);
    return;
  }

  if (cmd === 'worth') {
    const amt = parseFloat(parts[1]);
    if (isNaN(amt)) {
      console.log('\n💰 ECONOMY REFERENCE (all platforms share this scale)');
      console.log(`   1 diamond / 1 bit / 1 Kick  ≈  $0.01`);
      [1,5,10,25,50,100].forEach(d => console.log(`   $${d.toFixed(2).padEnd(6)} → ${dollarsToXP(d).toLocaleString()} XP`));
      console.log(`   Twitch/Kick sub T1 ($4.99)  → ${dollarsToXP(SUB_TIER_USD[1]).toLocaleString()} XP`);
      console.log(`   Twitch/Kick sub T2 ($9.99)  → ${dollarsToXP(SUB_TIER_USD[2]).toLocaleString()} XP`);
      console.log(`   Twitch/Kick sub T3 ($24.99) → ${dollarsToXP(SUB_TIER_USD[3]).toLocaleString()} XP`);
      console.log(`   Resub                        → ${Math.round(RESUB_MULT*100)}% of a fresh sub`);
      console.log('   Usage: worth 15   (any dollar amount)\n');
      return;
    }
    console.log(`💰 $${amt.toFixed(2)} → ${dollarsToXP(amt).toLocaleString()} XP`);
    return;
  }

  if (cmd === 'path') {
    const target = parts[1];
    const choice = (parts[2] || '').toLowerCase();
    if (!target || (choice !== 'ssbe' && choice !== 'uisign')) {
      return console.log('Usage: path <name> <ssbe|uisign>');
    }
    const u = findUser(target);
    if (!u) return console.log(`❌ No user matching "${target}"`);
    u.pathChoice = choice;
    u.rankId = getRank(u.xp, u.pathChoice).id;
    saveState(); debouncedPush();
    const rank = rankFor(8, choice);
    console.log(`⚔️  ${u.name} set to ${rank.name} (${rank.short})`);
    send(wssLB, { type: 'pathChosen', userId: u.id, name: u.name,
                  path: choice, short: rank.short, color: rank.color, aura: rank.aura, emoji: rank.emoji });
    return;
  }

  if (cmd === 'kick') {
    const sub = (parts[1] || '').toLowerCase();

    if (sub === 'setroom' && parts[2]) {
      const chatroomId = parts[2];
      const channelId = parts[3] || null;  // Optional second parameter
      manualKickIds = { chatroomId, channelId };
      console.log(`🔗 Set Kick IDs: chatroom=${chatroomId}${channelId ? `, channel=${channelId}` : ''}`);
      console.log(`   Connecting with manual IDs...`);
      connectKick();
      return;
    }

    if (sub === 'clearroom') {
      manualKickIds = null;
      console.log(`🔗 Cleared manual IDs - will fetch from API again`);
      connectKick();
      return;
    }

    if (sub === 'token' && parts[2]) {
      kickSessionToken = parts[2];
      console.log(`🔗 Set Kick session token`);
      console.log(`   Reconnecting with authentication...`);
      connectKick();
      return;
    }

    console.log(`\n🟢 KICK CONNECTION STATUS`);
    console.log(`   Channel:   ${MULTISTREAM.kick || '(disabled)'}`);
    console.log(`   Connected: ${kickConnected ? '✅ Yes' : '❌ No'}`);
    console.log(`   Retries:   ${kickRetries}`);
    if (manualKickIds) {
      console.log(`   Room ID:   ${manualKickIds.chatroomId} (manual)`);
      if (manualKickIds.channelId) console.log(`   Channel ID: ${manualKickIds.channelId} (manual)`);
    }
    if (kickConnected) {
      console.log(`   Status:    Listening for chat, subs, and tips`);
      console.log(`   Next test: Type '!link' on Kick and check the overlay for code`);
    } else {
      console.log(`   Status:    Disconnected or failed to connect (API blocked)`);
      console.log(`   Options:`);
      console.log(`      1. 'kick retry'           — Try API again (wait 1-2 hours first)`);
      console.log(`      2. 'kick setroom <ID>'    — Bypass API with manual chatroom ID`);
      console.log(`      3. Check guide for how to find your chatroom ID`);
    }
    console.log('');
    if (sub === 'retry') {
      console.log('🔗 Attempting immediate Kick reconnection...');
      connectKick();
    }
    return;
  }

  if (cmd === 'link') {
    const sub = (parts[1] || '').toLowerCase();

    if (sub === 'list' || !sub) {
      const entries = Object.entries(linkMap);
      if (!entries.length) return console.log('🔗 No linked accounts yet');
      console.log('\n🔗 LINKED ACCOUNTS');
      entries.forEach(([raw, canon]) => {
        const u = users[canon];
        console.log(`   ${raw}  →  ${canon}${u ? ` (${u.name}, ${u.xp.toLocaleString()} XP)` : ' (missing?)'}`);
      });
      console.log('');
      return;
    }

    if (sub === 'codes') {
      const now = Date.now();
      const active = Object.entries(linkCodes).filter(([,e]) => now - e.createdAt < LINK_CODE_TTL);
      if (!active.length) return console.log('🔗 No active link codes right now');
      console.log('\n🔗 ACTIVE CODES');
      active.forEach(([code, e]) => console.log(`   ${code}  —  ${e.name} (${e.platform}), ${Math.ceil((LINK_CODE_TTL-(now-e.createdAt))/1000)}s left`));
      console.log('');
      return;
    }

    // manual: link <platform:rawname> <canonical display name or id>
    if (parts.length >= 3) {
      const rawId = parts[1];
      const target = parts.slice(2).join(' ');
      const canonUser = findUser(target);
      if (!canonUser) return console.log(`❌ No user matching "${target}" to link into`);
      const result = mergeIntoCanonical(rawId, canonUser.id, rawId.includes(':') ? rawId.split(':')[0] : 'manual');
      if (result.merged) console.log(`🔗 Linked ${rawId} → ${canonUser.name} (${fmtXP(result.totalXp)} XP combined)`);
      else console.log(`🔗 Skipped: ${result.reason}`);
      return;
    }

    console.log('Usage: link list | link codes | link <platform:rawname> <target user>');
    return;
  }

  if (cmd === 'unlink' && parts[1]) {
    const rawId = parts[1];
    if (!linkMap[rawId]) return console.log(`❌ "${rawId}" isn't linked to anything`);
    delete linkMap[rawId];
    saveState();
    console.log(`🔗 Unlinked ${rawId} — future activity there builds its own profile again`);
    return;
  }

  if (cmd === 'reset') {
    const sub = (parts[1] || '').toLowerCase();

    // reset <name>  → wipe one person back to 0
    if (sub && sub !== 'all' && sub !== 'confirm') {
      const target = parts.slice(1).join(' ');
      const u = findUser(target);
      if (!u) return console.log(`❌ No user matching "${target}"`);
      const before = u.xp;
      u.xp = 0; u.rankId = 0;
      saveState(); debouncedPush();
      return console.log(`🔄 ${u.name}: ${before.toLocaleString()} → 0 XP (LOW CLASS)`);
    }

    // reset all → asks for confirmation
    if (sub === 'all') {
      const n = Object.keys(users).length;
      pendingReset = Date.now();
      console.log(`⚠️  This wipes ALL XP for ${n} users. Type "reset confirm" within 30s to proceed.`);
      return;
    }

    // reset confirm → actually does it
    if (sub === 'confirm') {
      if (!pendingReset || Date.now() - pendingReset > 30000) {
        return console.log('❌ Nothing pending. Type "reset all" first.');
      }
      const n = Object.keys(users).length;
      // Archive the season before wiping
      try {
        const stamp = new Date().toISOString().slice(0,10);
        writeFileSync(`season-${stamp}.json`, JSON.stringify(users, null, 2));
        console.log(`💾 Archived ${n} users to season-${stamp}.json`);
      } catch (e) { console.log('⚠️  Archive failed:', e.message); }

      users = {};
      pendingReset = null;
      lastBattleAt = 0; lastBattleKey = ''; lastBattleLead = '';
      saveState();
      send(wssLB, { type: 'leaderboard', leaderboard: [] });
      send(wssLB, { type: 'reset' });
      console.log(`🔄 SEASON RESET — ${n} users wiped. Everyone starts at 0.`);
      return;
    }

    if (!sub) return console.log('Usage: reset all  (wipe everyone) | reset <n> (wipe one person)');
  }

  if (cmd === 'backup') {
    const sub = (parts[1] || '').toLowerCase();
    const backupDir = join(__dirname, 'backups');

    if (sub === 'list' || !sub) {
      if (!existsSync(backupDir)) {
        return console.log('💾 No backups yet');
      }
      const files = require('fs').readdirSync(backupDir).sort().reverse().slice(0, 20);
      if (!files.length) return console.log('💾 No backup files found');
      console.log('\n💾 RECENT BACKUPS (newest first):');
      files.forEach(f => {
        const stat = require('fs').statSync(join(backupDir, f));
        const size = (stat.size / 1024).toFixed(1);
        console.log(`   ${f}  (${size} KB)`);
      });
      console.log('\n   To restore: backup restore <filename>\n');
      return;
    }

    if (sub === 'restore' && parts[2]) {
      const filename = parts[2];
      const backupPath = join(backupDir, filename);
      if (!existsSync(backupPath)) {
        return console.log(`❌ Backup not found: ${filename}`);
      }
      try {
        const backup = JSON.parse(require('fs').readFileSync(backupPath, 'utf8'));
        const before = Object.keys(users).length;
        users = backup.users || {};
        linkMap = backup.linkMap || {};
        saveState();
        debouncedPush();
        console.log(`✅ RESTORED from ${filename}`);
        console.log(`   Before: ${before} users  →  After: ${Object.keys(users).length} users\n`);
      } catch (e) {
        console.log(`❌ Restore failed: ${e.message}`);
      }
      return;
    }

    if (sub === 'now') {
      if (!existsSync(backupDir)) {
        require('fs').mkdirSync(backupDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(backupDir, `rankings-manual-${timestamp}.json`);
      try {
        writeFileSync(backupPath, JSON.stringify({ users, linkMap, savedAt: Date.now() }, null, 2));
        const stat = require('fs').statSync(backupPath);
        console.log(`💾 Manual backup created: rankings-manual-${timestamp}.json (${(stat.size / 1024).toFixed(1)} KB)\n`);
      } catch (e) {
        console.log(`❌ Backup failed: ${e.message}`);
      }
      return;
    }

    console.log('Usage: backup list | backup now | backup restore <filename>\n');
  }

  if (cmd === 'stop') {
    if (!tiktokConnected) {
      return console.log('❌ Not connected to TikTok live');
    }
    manualDisconnect = true;
    tiktok.disconnect();
    console.log('\n⏹️  Stream stopped — bot will not auto-reconnect\n');
    console.log('   To restart: type "start" or the bot will auto-reconnect on next TikTok live\n');
    console.log('Usage: reset all  (wipe everyone) | reset <name> (wipe one person)');
    return;
  }

  if (cmd === 'record' || cmd === 'wl') {
    const q = parts.slice(1).join(' ');
    if (q) {
      const u = findUser(q);
      if (!u) return console.log(`❌ No user matching "${q}"`);
      const w = u.wins||0, l = u.losses||0, t = u.tapouts||0;
      const pctW = (w+l) ? Math.round(w/(w+l)*100) : 0;
      console.log(`\n📋 ${u.name} — ${w}W ${l}L (${pctW}%)`);
      console.log(`   Tapouts: ${t} | Current streak: ${u.streak||0} | Best: ${u.bestStreak||0}\n`);
      return;
    }
    const ranked = Object.values(users)
      .filter(u => (u.wins||0) + (u.losses||0) > 0)
      .sort((a,b) => (b.wins||0) - (a.wins||0) || (a.losses||0) - (b.losses||0));
    if (!ranked.length) return console.log('📋 No race records yet');
    console.log('\n📋 RACE RECORDS');
    ranked.slice(0,15).forEach((u,i) => {
      const w=u.wins||0,l=u.losses||0,t=u.tapouts||0;
      console.log(`  ${String(i+1).padStart(2)}. ${u.name.padEnd(18)} ${w}W-${l}L${t?`  (${t} tapout${t>1?'s':''})`:''}${u.streak>1?`  🔥${u.streak}`:''}`);
    });
    console.log('');
    return;
  }

  if (cmd === 'stakes') {
    const key = (parts[1] || '').toLowerCase();
    const raw = parts[2];
    const pct = parseFloat(raw); // percentages entered as e.g. 50 for 50%
    // All stakes are now percentages, not flat XP — they scale with tier.
    const pctMap = { sprint:'sprintPct', win:'winBonusPct', lose:'loserPenPct', quit:'quitPenPct' };
    if (key === 'expire' && !isNaN(pct)) { RACE.maxMs = pct * 60000; return console.log(`💰 Race expiry set to ${pct}min`); }
    if (key === 'grace'  && !isNaN(pct)) { RACE.graceMs = pct * 1000; return console.log(`💰 Tapout grace set to ${pct}s`); }
    if (key === 'floor'  && !isNaN(pct)) { RACE.minSprint = Math.round(pct); return console.log(`💰 Sprint floor set to ${Math.round(pct).toLocaleString()} XP`); }
    if (pctMap[key] && !isNaN(pct)) {
      RACE[pctMap[key]] = pct / 100;
      return console.log(`💰 ${key} set to ${pct}% of the sprint${key === 'sprint' ? ' (of leader XP)' : ''}`);
    }
    if (key === 'demote') {
      RACE.neverDemote = (parts[2] || '').toLowerCase() !== 'on';
      return console.log(`💰 Penalties ${RACE.neverDemote ? 'can NEVER demote' : 'CAN demote (default)'}`);
    }
    // Worked example at a few tiers so the percentages are legible
    const ex = (xp) => {
      const s = calcSprint(xp);
      return `${xp.toLocaleString().padStart(10)} → sprint ${s.toLocaleString().padStart(8)}, win +${Math.round(s*RACE.winBonusPct).toLocaleString().padStart(7)}, lose −${Math.round(s*RACE.loserPenPct).toLocaleString().padStart(6)}, quit −${Math.round(s*RACE.quitPenPct).toLocaleString().padStart(6)}`;
    };
    console.log(`\n💰 RACE STAKES (all scale with tier)`);
    console.log(`   Sprint distance: ${Math.round(RACE.sprintPct*100)}% of the leader's XP (floor ${RACE.minSprint.toLocaleString()})`);
    console.log(`   Winner bonus:   +${Math.round(RACE.winBonusPct*100)}% of the sprint`);
    console.log(`   Loser loses:    −${Math.round(RACE.loserPenPct*100)}% of the sprint`);
    console.log(`   Quitter loses:  −${Math.round(RACE.quitPenPct*100)}% of the sprint  (highest, by design)`);
    console.log(`   Demotion:        ${RACE.neverDemote ? 'OFF — never drops a rank' : 'ON — enough losses CAN demote you'}`);
    console.log(`   Tapout grace:    ${RACE.graceMs / 1000}s countdown before it's final`);
    console.log(`   Race expires:    ${RACE.maxMs / 60000}min max, ${RACE.stallMs / 60000}min if stalled`);
    console.log(`\n   Worked examples:`);
    [50000, 500000, 3000000].forEach(x => console.log(`   ${ex(x)}`));
    console.log(`\n   Change: stakes sprint 8 | stakes win 50 | stakes lose 18 | stakes quit 35 | stakes demote on|off | stakes floor 1000\n`);
    return;
  }

  if (cmd === 'race') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'end') {
      if (!race) return console.log('🏁 No race running');
      send(wssLB, { type: 'raceEnd', reason: 'manual' });
      race = null; return console.log('🏁 Race ended manually');
    }
    if (sub === 'target' && parts[2]) {
      if (!race) return console.log('🏁 No race running');
      const v = parseInt(parts[2]);
      if (isNaN(v)) return console.log('Usage: race target 50000');
      race.target = v; console.log(`🏁 Target set to ${v.toLocaleString()} XP`);
      send(wssLB, { type: 'raceUpdate', ...racePayload() }); return;
    }
    if (!race) return console.log('🏁 No race running. Commands: race end | race target <xp>');
    const pl = racePayload();
    console.log(`\n🏁 RACE to ${pl.target.toLocaleString()} XP (${pl.targetRank}) — ${pl.alive} still in`);
    pl.runners.forEach((r,i) => console.log(`   ${r.quit ? '🚪' : (i+1)+'.'} ${r.name} — ${r.xp.toLocaleString()} (${r.pct}%)${r.quit ? ' QUIT' : ` need ${r.need.toLocaleString()}`}`));
    console.log('');
    return;
  }

  if (cmd === 'war') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'off')      { BATTLE.enabled = false; console.log('⚔️  Battle alerts OFF'); }
    else if (sub === 'on')  { BATTLE.enabled = true;  console.log('⚔️  Battle alerts ON'); }
    else if (sub === 'followers') {
      const v = (parts[2] || '').toLowerCase();
      if (v === 'on')  { BATTLE.followersOnly = true;  console.log('⚔️  Followers-only requirement ON'); }
      else if (v === 'off') { BATTLE.followersOnly = false; console.log('⚔️  Followers-only requirement OFF'); }
      else console.log(`⚔️  Followers-only is ${BATTLE.followersOnly ? 'ON' : 'OFF'} — use: war followers off`);
    }
    else if (sub === 'why') {
      const now = Date.now();
      const all = Object.values(users);
      const aboveXp  = all.filter(u => u.xp >= BATTLE.minXp);
      const active   = aboveXp.filter(u => (now - (u.lastActive || 0)) < BATTLE.activeMs);
      const follows  = active.filter(u => !BATTLE.followersOnly || u.follows > 0 || u.isFollower);
      console.log(`\n⚔️  BATTLE DIAGNOSTIC`);
      console.log(`   Total users:            ${all.length}`);
      console.log(`   Above ${BATTLE.minXp} XP:          ${aboveXp.length}`);
      console.log(`   ...and active (${BATTLE.activeMs/60000}min):  ${active.length}`);
      console.log(`   ...and follower-ok:     ${follows.length}  (followersOnly=${BATTLE.followersOnly})`);
      if (follows.length >= 2) {
        const s = follows.sort((a,b)=>b.xp-a.xp);
        const gap = (s[0].xp - s[1].xp) / s[0].xp * 100;
        console.log(`   Closest pair: ${s[0].name} vs ${s[1].name} — ${gap.toFixed(1)}% apart (need ≤${(BATTLE.gapPct*100).toFixed(0)}%)`);
      }
      const since = ((Date.now() - lastBattleAt)/60000).toFixed(1);
      console.log(`   Last alert: ${lastBattleAt ? since + ' min ago (cooldown ' + BATTLE.cooldownMs/60000 + 'min)' : 'never'}\n`);
    }
    else if (sub === 'now') {
      const b = findBattle();
      if (!b) return console.log('⚔️  No qualifying rivalry — run "war why" to see which gate is blocking');
      lastBattleAt = Date.now(); lastBattleKey = b.key; lastBattleLead = b.leader;
      send(wssLB, { type: 'battle', ...b, leadChange: false, displayMs: BATTLE.displayMs });
      startRace(b);
      console.log(`⚔️  Forced ${b.kind} — ${b.total} contenders for ${b.rank}`);
    }
    else if (sub === 'active' && parts[2]) {
      const v = parseInt(parts[2]);
      if (!isNaN(v) && v > 0) { BATTLE.activeMs = v * 1000; console.log(`⚔️  Active window set to ${v}s`); }
      else console.log('Usage: war active 90');
    }
    else if (sub === 'gap' && parts[2]) {
      const v = parseFloat(parts[2]);
      if (!isNaN(v) && v > 0 && v < 100) { BATTLE.gapPct = v / 100; console.log(`⚔️  Gap threshold set to ${v}%`); }
      else console.log('Usage: war gap 5');
    }
    else if (sub === 'cool' && parts[2]) {
      const v = parseInt(parts[2]);
      if (!isNaN(v) && v >= 0) { BATTLE.cooldownMs = v * 60000; console.log(`⚔️  Cooldown set to ${v} min`); }
      else console.log('Usage: war cool 15');
    }
    else {
      console.log(`⚔️  Battles ${BATTLE.enabled ? 'ON' : 'OFF'} | gap ${(BATTLE.gapPct*100).toFixed(0)}% | cooldown ${BATTLE.cooldownMs/60000}min`);
      console.log('    war on | war off | war now | war why | war gap 5 | war cool 15 | war active 90 | war followers off');
    }
    return;
  }

  if (cmd === 'q' || cmd === 'quiet') {
    QUIET = !QUIET;
    console.log(QUIET
      ? '🔇 QUIET MODE ON — event logs muted. Type commands freely. Type "q" to unmute.'
      : '🔊 QUIET MODE OFF — event logs back on.');
    return;
  }

  if (cmd === 'xp' || cmd === 'add') {
    const amount = parseInt(parts[parts.length - 1]);
    const name   = parts.slice(1, -1).join(' ');
    if (!name || isNaN(amount)) return console.log(`Usage: ${cmd} <name> <amount>`);
    const u = findUser(name);
    if (!u) return console.log(`❌ No user matching "${name}" — try: top`);
    applyEdit(u, cmd === 'xp' ? amount : u.xp + amount);

  } else if (cmd === 'rank') {
    const rankQ = parts[parts.length - 1];
    const name  = parts.slice(1, -1).join(' ');
    if (!name || !rankQ) return console.log('Usage: rank <name> <rank>  (e.g. rank vegeta UI)');
    const u = findUser(name);
    if (!u) return console.log(`❌ No user matching "${name}"`);
    const target = RANKS.find(r =>
      r.short.toLowerCase() === rankQ.toLowerCase() ||
      r.short.toLowerCase().replace(/\s+/g, '') === rankQ.toLowerCase() ||
      r.name.toLowerCase()  === rankQ.toLowerCase());
    if (!target) return console.log(`❌ Ranks: ${RANKS.map(r => r.short).join(' | ')}`);
    applyEdit(u, target.xp);

  } else if (cmd === 'who') {
    const name = parts.slice(1).join(' ');
    const u = findUser(name);
    if (!u) return console.log(`❌ No user matching "${name}"`);
    console.log(`ℹ️  ${u.name}: ${u.xp.toLocaleString()} XP (${getRank(u.xp, u.pathChoice).short})`);

  } else if (cmd === 'del') {
    const name = parts.slice(1).join(' ');
    const u = findUser(name);
    if (!u) return console.log(`❌ No user matching "${name}"`);
    delete users[u.id];
    saveState(); debouncedPush();
    console.log(`🗑️  Deleted ${u.name}`);

  } else if (cmd === 'top') {
    Object.values(users).sort((a, b) => b.xp - a.xp).slice(0, 20)
      .forEach((u, i) => console.log(`${String(i + 1).padStart(2)}. ${u.name} — ${u.xp.toLocaleString()} XP (${getRank(u.xp, u.pathChoice).short})`));

  } else if (cmd === 'ranks') {
    RANKS.forEach(r => console.log(`${r.short.padEnd(10)} ${r.xp.toLocaleString()} XP`));

  } else if (cmd === 'powerlevel' || cmd === 'pl') {
    const name = parts.slice(1).join(' ') || null;
    if (!name) return console.log('Usage: powerlevel <name>');
    const u = findUser(name);
    if (!u) return console.log(`❌ No user matching "${name}"`);
    const rank = getRank(u.xp, u.pathChoice);
    const nextRank = nextRankAfter(rank.id, u.pathChoice);
    const pct = rank.id >= MAX_RANK_ID ? 100 : Math.round((u.xp - rank.xp) / (nextRank.xp - rank.xp) * 100);
    console.log(`\n💪 ${u.name}`);
    console.log(`   Rank: ${rank.short} (${rank.name})`);
    console.log(`   XP: ${u.xp.toLocaleString()} / ${nextRank.xp.toLocaleString()} (${pct}%)`);
    if (u.wins || u.losses) console.log(`   Record: ${u.wins}W-${u.losses}L${u.streak > 1 ? ` (🔥 ${u.streak} streak)` : ''}`);
    if (u.pathChoice) console.log(`   Path: ${u.pathChoice.toUpperCase()}`);
    console.log('');

  } else if (cmd === 'leaderboard' || cmd === 'lb') {
    const slice = Object.values(users).sort((a, b) => b.xp - a.xp).slice(0, 25);
    console.log(`\n🏁 TOP ${slice.length} FIGHTERS\n`);
    slice.forEach((u, i) => {
      const rank = getRank(u.xp, u.pathChoice);
      const record = (u.wins || u.losses) ? ` | ${u.wins}W-${u.losses}L` : '';
      console.log(`${String(i + 1).padStart(2)}. ${u.name.padEnd(20)} ${String(u.xp).padStart(12)} XP | ${rank.short}${record}`);
    });
    console.log('');

  } else if (cmd === 'admin-xp' || cmd === 'admin-add' || cmd === 'admin-rank') {
    // Parse: admin-xp @user +5000
    const match = parts[1]?.match(/@?(.+)/);
    const name = match ? match[1] : null;
    const value = parseInt(parts[2]);
    if (!name || isNaN(value)) return console.log(`Usage: ${cmd} <name> <value>`);
    const u = findUser(name);
    if (!u) return console.log(`❌ No user matching "${name}"`);
    
    if (cmd === 'admin-xp') {
      const before = u.xp;
      u.xp = Math.max(0, value);
      saveState(); debouncedPush();
      const oldRank = getRank(before, u.pathChoice);
      const newRank = getRank(u.xp, u.pathChoice);
      console.log(`✅ ${u.name}: ${before.toLocaleString()} → ${u.xp.toLocaleString()} XP (${oldRank.short} → ${newRank.short})`);
      send(wssLB, {
        type: 'activity', action: 'admin', userId: u.id, name: u.name,
        xp: u.xp - before, entry: { ...u, rankName: newRank.short }
      });
    }

  } else if (cmd === 'list' || cmd === 'ls') {
    const all = Object.values(users).sort((a, b) => b.xp - a.xp);
    console.log(`\n📋 ${all.length} USERS TOTAL\n`);
    all.slice(0, 30).forEach((u, i) => {
      const rank = getRank(u.xp, u.pathChoice);
      console.log(`${String(i + 1).padStart(2)}. ${u.name.padEnd(20)} ${u.xp.toLocaleString().padStart(10)} XP | ${rank.short}`);
    });
    if (all.length > 30) console.log(`... and ${all.length - 30} more`);
    console.log('');

  } else if (cmd === 'status' || cmd === 'info') {
    console.log(`\n📊 BOT STATUS`);
    console.log(`   Users: ${Object.keys(users).length}`);
    console.log(`   TikTok: ${tiktokConnected ? '✅ LIVE' : '❌ OFFLINE'}`);
    console.log(`   Save file: rankings-save.json`);
    console.log(`   Backup file: rankings-backup.json`);
    console.log('');

  } else if (cmd === 'trivia') {
    startTrivia();

  } else if (cmd === 'a' || cmd === 'b' || cmd === 'c') {
    if (!triviaActive) return console.log('No trivia active');
    
    // Only first person to answer gets PL
    if (triviaAnswered) {
      return console.log('⏳ Someone already answered this question!');
    }
    
    const idx = cmd.charCodeAt(0) - 97;
    const selected = triviaActive.options[idx];
    if (!selected) return console.log('Invalid option');
    if (selected === triviaActive.answer) {
      const pl = { easy: 500, medium: 1000, hard: 1500, insane: 2500 }[triviaActive.difficulty] || 500;
      console.log(`\n✅ CORRECT! +${pl} PL (${triviaActive.difficulty})\n`);
      console.log(`Answer: ${triviaActive.answer}\n`);
      triviaActive = false;
      triviaAnswered = true;
    } else {
      console.log(`\n❌ WRONG! Correct answer: ${triviaActive.answer}\n`);
      triviaActive = false;
      triviaAnswered = true;
    }

  } else if (cmd === 'profile' || cmd === 'me') {
    const name = parts.slice(1).join(' ') || null;
    if (!name) return console.log('Usage: profile <name> OR just "me" for your profile');
    const u = findUser(name);
    if (!u) {
      const fuzzy = fuzzyFindUser(name);
      if (fuzzy) return console.log(`Did you mean "${fuzzy.name}"? (similar profile found)`);
      return console.log(`❌ No user matching "${name}"`);
    }
    const rank = getRank(u.xp, u.pathChoice);
    const nextRank = nextRankAfter(rank.id, u.pathChoice);
    const pct = rank.id >= MAX_RANK_ID ? 100 : Math.round((u.xp - rank.xp) / (nextRank.xp - rank.xp) * 100);
    const xpNeeded = Math.max(0, nextRank.xp - u.xp);
    console.log(`\n═══════════════════════════════════════`);
    console.log(`👤 ${u.name}`);
    console.log(`═══════════════════════════════════════`);
    console.log(`💪 Rank: ${rank.short} (${rank.name})`);
    console.log(`📊 XP: ${u.xp.toLocaleString()} / ${nextRank.xp.toLocaleString()}`);
    console.log(`📈 Progress: ${'█'.repeat(Math.floor(pct / 5))}${'░'.repeat(20 - Math.floor(pct / 5))} ${pct}% (${xpNeeded.toLocaleString()} XP to next rank)`);
    if (u.wins || u.losses) console.log(`🏆 Record: ${u.wins || 0}W - ${u.losses || 0}L${u.streak > 1 ? ` (🔥 ${u.streak} streak)` : ''}`);
    if (u.isFollower) console.log(`⭐ Status: Follower`);
    if (u.pathChoice) console.log(`🛤️  Path: ${u.pathChoice.toUpperCase()}`);
    if (u.linkedAccounts) console.log(`🔗 Linked: ${Object.keys(u.linkedAccounts).join(', ')}`);
    console.log(`═══════════════════════════════════════\n`);

  } else if (cmd === 'daily') {
    const today = new Date().toLocaleDateString();
    const topGifterValue = dailyStats.topGifter?.value || 0;
    const topGifterDisplay = topGifterValue > 100 ? `$${(topGifterValue / 100).toFixed(2)}` : `${topGifterValue} coins`;
    const totalGiftDisplay = dailyStats.totalGiftValue > 100 ? `$${(dailyStats.totalGiftValue / 100).toFixed(2)}` : `${dailyStats.totalGiftValue} coins`;
    
    console.log(`\n📅 DAILY COMMUNITY REPORT — ${today}`);
    console.log(`\n🏆 MVP (Most XP): ${dailyStats.mvp?.name || 'N/A'} — ${(dailyStats.mvp?.xp || 0).toLocaleString()} XP`);
    console.log(`💸 Top Supporter: ${dailyStats.topGifter?.name || 'N/A'} — ${topGifterDisplay} (TikTok + Donations)`);
    console.log(`❤️  Top Follower: ${dailyStats.topFollower?.name || 'N/A'} — ${dailyStats.topFollower?.follows || 0} follows`);
    console.log(`💬 Top Chatter: ${dailyStats.topChatter?.name || 'N/A'} — ${dailyStats.topChatter?.messages || 0} messages`);
    console.log(`\n📊 Community Stats:`);
    console.log(`   Total XP Gained: ${dailyStats.totalXpGained.toLocaleString()}`);
    console.log(`   Total Support Value: ${totalGiftDisplay}`);
    console.log(`   Total Follows: ${dailyStats.totalFollows}`);
    console.log(`   Total Messages: ${dailyStats.totalChats}`);
    console.log(`   Active Users: ${Object.values(users).filter(u => u.dailyXpGained > 0).length}`);
    console.log('');

  } else if (cmd === 'link-fuzzy' || cmd === 'fuzzy-link') {
    const tiktokHandle = parts[1]?.toLowerCase();
    if (!tiktokHandle) return console.log('Usage: link-fuzzy <tiktok_handle>');
    const match = fuzzyFindUser(tiktokHandle, 3);
    if (!match) return console.log(`❌ No close match for "${tiktokHandle}"`);
    console.log(`\n✅ Fuzzy match found!`);
    console.log(`   TikTok: ${tiktokHandle}`);
    console.log(`   Matched to: ${match.name}`);
    console.log(`   Confirm linking? (manual: link <name>)\n`);

  if (cmd === 'startlive' || cmd === 'start') {
    if (tiktokConnected) {
      return sendAutoDelete(msg, '✅ Already connected to TikTok Live!');
    }
    console.log('🔴 Starting TikTok Live connection...');
    tiktok.connect().catch((err) => {
      console.log('⚠️  TikTok connect failed:', err?.message || err);
    });
    sendAutoDelete(msg, '🔴 **STARTING LIVE** — Connecting to TikTok...');
    return;
  }

  if (cmd === 'endlive' || cmd === 'stop') {
    if (!tiktokConnected) {
      return sendAutoDelete(msg, '❌ Not connected to TikTok Live');
    }
    manualDisconnect = true;
    tiktok.disconnect();
    sendAutoDelete(msg, '⏹️  **STREAM ENDED** — Disconnected from TikTok');
    console.log('\n⏹️  Stream stopped manually\n');
    return;
  }

  } else if (cmd === 'help') {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║              SCOUTER BOT COMMANDS                              ║
╚════════════════════════════════════════════════════════════════╝

PROFILE COMMANDS:
  profile <name>                       View detailed profile & stats
  powerlevel <name>, pl <name>         Show rank, XP, progress
  leaderboard, lb                      Show top 25 fighters
  daily <name>                         Daily XP & battle report
  list, ls                             Show all users

TRIVIA COMMANDS:
  trivia                               Start manual trivia (auto every 15min)
  a, b, c                              Answer trivia (press during question)
  Difficulties: easy, medium, hard, insane
SUPPORT THE STREAM:
  donate <amount>                      Donate via Stripe, earn XP
  Example: donate 5 (for , get 500 XP)


ADMIN COMMANDS:
  xp <name> <amount>                   Set user XP
  add <name> <amount>                  Add/remove XP
  rank <name> <rank>                   Jump user to rank
  del <name>                           Delete user

ACCOUNT LINKING:
  link                                 Link TikTok account
  link-fuzzy <handle>                  Fuzzy match TikTok handle
  unlink <name>                        Unlink account
  kick <name>                          Kick from stream

OTHER:
  ranks                                Show rank thresholds
  who <name>                           Get user info
  status, info                         Bot status
  q, quiet                             Toggle quiet mode
  help                                 This menu

💡 Use !help in Discord for formatted guide

Type 'help' anytime for this menu
`);

  } else {
    // All other commands go through readline handler (xp, rank, del, etc.)
    rl.emit('line', input);
    
    // Send captured output to Discord after a short delay, with auto-delete
    setTimeout(() => {
      if (capturedOutput.length > 0) {
        const output = capturedOutput.join('\n').substring(0, 2000);
        sendAutoDelete(msg, `\`\`\`\n${output}\n\`\`\``);
      }
    }, 300);
  }
});

// ── TIKTOK EVENTS ──────────────────────────────────────────────────────────
const tiktok = new TikTokLive({ uniqueId: USERNAME, apiKey: API_KEY, signServerUrl: 'http://localhost:8084' });

// Start Discord
dclient.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('❌ Discord login failed:', err.message);
});

// TEMP: Skip auto-connect to debug — Discord only mode
console.log('⏸️  TikTok auto-connect DISABLED (Discord-only mode)');
console.log('   Type "start" in console to connect to TikTok\n');
// tiktokConnected = false;  // Already declared above

// Commented out to prevent hanging:
/*
tiktok.connect()
  .then(() => {
    clearTimeout(connectTimeout);
    console.log('✅ TikTok connected!');
  })
  .catch((err) => {
    clearTimeout(connectTimeout);
    console.log('⚠️  TikTok connect failed:', err?.message || err);
    console.log('   Retrying in 20s...\n');
    setTimeout(reconnectFresh, 20000);
  });
*/
