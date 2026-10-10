import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { TikTokLive } from '@tiktool/live';
import { google } from 'googleapis';
// Kick integration - using custom WebSocket connection instead of broken library
import { WebSocket as WSLib } from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import readline from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const API_KEY   = 'tk_8f99451968a57ef6230ae3d85ff249ef7d3f23358b5fbd6a';

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
const XP_RATES = { chat: 100, like: 1, follow: 2000, share: 50, member: 50 };

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
let linkCodes = {};   // { code: {...} } — in-memory only, expires, never saved

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
  }
}

function saveState() {
  try { writeFileSync(SAVE_FILE, JSON.stringify({ users, linkMap, savedAt: Date.now() }, null, 2)); }
  catch (e) { console.error('Save error:', e.message); }
}
setInterval(saveState, 3000);

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
  // exact id first
  if (users[q]) return users[q];
  // exact name
  let hit = Object.values(users).find(u => (u.name || '').toLowerCase() === needle);
  if (hit) return hit;
  // partial name
  hit = Object.values(users).find(u => (u.name || '').toLowerCase().includes(needle));
  return hit || null;
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
appLB.get('/auth/youtube', (req, res) => {
  if (!youtubeOAuth2Client) {
    return res.send('❌ YouTube not configured. Check YOUTUBE_CLIENT_ID environment variable.');
  }
  const authUrl = youtubeOAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube']
  });
  res.send(`<html><body><h2>YouTube Authorization</h2><p>Click below to authorize:</p><a href="${authUrl}" style="font-size:18px; padding:10px; background:#FF0000; color:white; text-decoration:none; border-radius:5px; display:inline-block;">Authorize YouTube</a></body></html>`);
});

appLB.get('/auth/youtube-callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('❌ No authorization code');

  try {
    const { tokens } = await youtubeOAuth2Client.getToken(code);
    youtubeOAuth2Client.setCredentials(tokens);
    fs.writeFileSync(YOUTUBE_TOKEN_FILE, JSON.stringify(tokens, null, 2));
    console.log('✅ YouTube token saved');
    youtubeAPI = (await import('googleapis')).google.youtube({ version: 'v3', auth: youtubeOAuth2Client });
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
    delete users[rawId];
  }

  const oldRank = getRank((dst.xp || 0) - (src?.xp || 0), dst.pathChoice).id;
  dst.rankId = getRank(dst.xp, dst.pathChoice).id;
  linkMap[rawId] = canonicalId;
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
  console.log(`🔗 Attempting merge: ${canonicalOfSender} + ${entry.canonicalId}`);
  const result = mergeIntoCanonical(canonicalOfSender, entry.canonicalId, platform);
  if (result.merged) {
    console.log(`🔗 ✅ LINKED — ${name}: ${entry.platform} + ${platform} → ${fmtXP(result.totalXp)} XP combined`);
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
  userId = resolveId(userId);
  const now = Date.now();
  if (!users[userId]) {
    users[userId] = {
      id: userId, name, xp: 0, rankId: 0, pathChoice: null,
      comments: 0, gifts: 0, follows: 0, shares: 0, likes: 0,
      wins: 0, losses: 0, tapouts: 0, streak: 0, bestStreak: 0,
      firstSeen: now, lastSeen: now, lastActive: now, sessions: 0,
      activePlatforms: [],  // ← Track which platforms they're currently on
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

// ── TIKTOK EVENTS ──────────────────────────────────────────────────────────
const tiktok = new TikTokLive({ uniqueId: USERNAME, apiKey: API_KEY, signServerUrl: 'http://localhost:8084' });

// Fetch the live room ID, trying multiple sources to bypass sign server cache.
async function fetchRoomIdDirect() {
  // 1) Try TikTok's page HTML (multiple patterns)
  try {
    const res = await fetch(`https://www.tiktok.com/@${USERNAME}/live`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      }
    });
    const html = await res.text();
    const patterns = [
      /"roomId"\s*:\s*"(\d+)"/,
      /"room_id"\s*:\s*"(\d+)"/,
      /roomId=(\d+)/,
      /"liveRoomId"\s*:\s*"(\d+)"/,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) { console.log(`📡 Found room ID from TikTok page: ${m[1]}`); return m[1]; }
    }
    console.log('⚠️  TikTok page loaded but no room ID pattern matched');
  } catch (e) { console.log('⚠️  TikTok page fetch failed:', e.message); }

  // 2) Try webcast API
  try {
    const res = await fetch(`https://webcast.tiktok.com/webcast/room/info/?aid=1988&app_name=tiktok_web&live_id=1&device_platform=web&screen_width=1920&screen_height=1080&web_browser_language=en&unique_id=${USERNAME}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
    });
    const json = await res.json();
    const rid = json?.data?.room?.id_str || json?.data?.id_str;
    if (rid) { console.log(`📡 Found room ID from webcast API: ${rid}`); return rid; }
  } catch {}

  return null;
}

let reconnecting = false;
async function reconnectFresh() {
  if (reconnecting) return;
  reconnecting = true;
  console.log('\n🔄 Reconnecting — letting sign server resolve room ID...');
  // Always clear preset so sign server does full room_id + ws_credentials flow
  tiktok._presetRoomId = '';
  try { tiktok.disconnect(); } catch {}
  await new Promise(r => setTimeout(r, 2000));
  reconnecting = false;
  tiktok.connect().catch((e) => {
    console.log('⚠️  Reconnect failed:', e?.message);
    setTimeout(reconnectFresh, 30000);
  });
}

tiktok.on('connected', () => {
  console.log(`\n✅ CONNECTED → @${USERNAME} is LIVE\n`);
  tiktok._presetRoomId = ''; // clear override so next connect re-fetches
});

tiktok.on('disconnected', () => {
  console.log(`\n❌ Disconnected — retrying in 15s...\n`);
  setTimeout(reconnectFresh, 15000);
});

tiktok.on('control', (e) => {
  console.log(`\n⚠️  Stream control event (action=${e.action}) — finding new stream in 10s...\n`);
  setTimeout(reconnectFresh, 10000);
});

tiktok.on('error', (err) => {
  console.error('❌ TikTool error:', err?.message || err);
  setTimeout(reconnectFresh, 15000);
});

// ── DEBUG: log every event the library fires so we can see what names it uses
['chat','comment','like','gift','member','follow','share','subscribe',
 'social','roomUser','viewer','envelope','question','rawData','liveIntro'].forEach(evt => {
  tiktok.on(evt, (data) => {
    elog(`[EVT] ${evt} |`, JSON.stringify(data).slice(0, 120));
  });
});

tiktok.on('chat', (e) => {
  const u = e.user || {};
  elog(`💬 [CHAT] ${uname(u)}: ${e.comment}`);
  if (handlePathCommand(uid(u), uname(u), e.comment) || handleLinkCommand(uid(u), uname(u), e.comment, 'tiktok')) {
    broadcastChat({ platform:'tiktok', user:uid(u), displayName:uname(u), message:e.comment });
    return;
  }
  // Check for !challenge <name> duel command
  if (handleChallengeCommand(uid(u), uname(u), e.comment)) {
    broadcastChat({ platform:'tiktok', user:uid(u), displayName:uname(u), message:e.comment });
    return;
  }
  addXP(uid(u), uname(u), 'chat', XP_RATES.chat, 0, {});
  broadcastChat({ platform:'tiktok', user:uid(u), displayName:uname(u), message:e.comment });
});

tiktok.on('like', (e) => {
  const u     = e.user || {};
  const count = e.likeCount || 1;
  elog(`❤️  [LIKE] ${uname(u)} ×${count}`);

  // Dragon ball — track totalLikes and check ball thresholds
  const prevLikes = dbState.totalLikes;
  dbState.totalLikes += count;

  // Server-side ball unlock tracking so ballsUnlocked is correct on reconnect
  if (!dbState.giftUnlocked) {
    for (let i = 0; i < BALL_THRESHOLDS.length; i++) {
      if (dbState.totalLikes >= BALL_THRESHOLDS[i] && prevLikes < BALL_THRESHOLDS[i]) {
        dbState.ballsUnlocked = i + 1;
        send(wssDB, { type: 'ballUnlocked', ball: i + 1, totalLikes: dbState.totalLikes });
        console.log(`⭐ Ball ${i + 1} unlocked! (${dbState.totalLikes.toLocaleString()} total likes)`);
      }
    }
  }

  send(wssDB, { type: 'like', count, totalLikes: dbState.totalLikes, ballsUnlocked: dbState.ballsUnlocked });
  addXP(uid(u), uname(u), 'like', Math.min(XP_RATES.like * count, 5), count, {});
});

// member events cover: join (1), follow (2), share (3)
tiktok.on('member', (e) => {
  const u      = e.user || {};
  const action = e.action;
  if (action === 'follow' || action === 2) {
    console.log(`➕ [FOLLOW] ${uname(u)} — +${XP_RATES.follow.toLocaleString()} XP`);
    const id = resolveId(uid(u));
    addXP(id, uname(u), 'follow', XP_RATES.follow, 0, {});
    if (users[id]) users[id].isFollower = true;
    send(wssLB, { type: 'followBonus', name: uname(u), xp: XP_RATES.follow, totalXp: users[id]?.xp || 0 });
  } else if (action === 'share' || action === 3) {
    elog(`🔁 [SHARE] ${uname(u)}`);
    addXP(uid(u), uname(u), 'share', XP_RATES.share, 0, {});
  } else {
    // Join / new viewer entering the stream
    elog(`👋 [JOIN] ${uname(u)}`);
    addXP(uid(u), uname(u), 'member', XP_RATES.member, 0, {});
  }
});

tiktok.on('gift', (e) => {
  const u            = e.user || {};
  const diamondCount = e.diamondCount || 1;
  const repeatCount  = e.repeatCount  || 1;
  const totalCoins   = diamondCount * repeatCount;
  const xp           = calcGiftXP(diamondCount, repeatCount);

  elog(`🎁 [GIFT] ${uname(u)} → ${e.giftName || 'gift'} ×${repeatCount} (${totalCoins}💎 +${xp} XP)`);
  broadcastGift({ platform:'tiktok', user:uname(u), giftName:e.giftName||'Gift', diamondCount, repeatCount });

  dbState.totalCoins += totalCoins;
  send(wssDB, { type: 'giftProgress', totalCoins: dbState.totalCoins });

  if (!dbState.giftUnlocked && dbState.totalCoins >= GIFT_GOAL) {
    dbState.giftUnlocked  = true;
    dbState.ballsUnlocked = 7;
    send(wssDB, { type: 'gift' });
    console.log('🐉 Ball 7 unlocked! SHENRON / SUPER SONIC!');
  }

  // Broadcast gift event to scouter overlay for attack name display
  send(wssLB, { type: 'economyEvent', platform: 'tiktok', kind: 'gift', name: uname(u), xp, detail: `${totalCoins} diamonds` });

  // Check for beam struggle (simultaneous large gifts)
  const beamContenders = checkBeamStruggle(xp, uname(u));
  if (beamContenders && beamContenders.length > 0) {
    console.log(`⚡ BEAM STRUGGLE — ${uname(u)} clashed with ${beamContenders.map(c => c.name).join(', ')}`);
    send(wssLB, { type: 'beamStruggle',
                  initiator: uname(u),
                  initiatorXp: xp,
                  contenders: beamContenders.map(c => ({ name: c.name, xp: c.xp })) });
  }

  recordLargeGift(uname(u), xp);
  addXP(uid(u), uname(u), 'gift', xp, repeatCount, { coins: totalCoins });
});

tiktok.on('subscribe', (e) => {
  const u = e.user || {};
  elog(`⭐ [SUB] ${uname(u)}`);
  addXP(uid(u), uname(u), 'member', XP_RATES.member, 0, {});
});

// ── START ──────────────────────────────────────────────────────────────────
// Just the two overlays that matter. Twitch/Kick still connect the same as
// ============ YOUTUBE LIVE CHAT ============
// YouTube OAuth2 Constants
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || '439638866702-uk78s5d1k32gct44fj7ed2mfq2i6hpi4.apps.googleusercontent.com';
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || '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';
const YOUTUBE_REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:8081/auth/youtube-callback';
const YOUTUBE_TOKEN_FILE = join(DATA_DIR, 'youtube-token.json');

// YouTube Live Chat State
let youtubeOAuth2Client = null;
let youtubeAPI = null;
let youtubeActiveLiveChat = null;
let processedYouTubeMessageIds = new Set();

async function initYouTube() {
  try {
    // YouTube temporarily disabled - will re-enable after testing
    return;
    const { google } = await import('googleapis');
    youtubeOAuth2Client = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI);
    
    if (fs.existsSync(YOUTUBE_TOKEN_FILE)) {
      const token = JSON.parse(fs.readFileSync(YOUTUBE_TOKEN_FILE, 'utf8'));
      youtubeOAuth2Client.setCredentials(token);
      youtubeAPI = google.youtube({ version: 'v3', auth: youtubeOAuth2Client });
      console.log('🎥 YouTube OAuth2 token loaded');
      connectYouTube();
      monitorYouTubeVideos();
    } else {
      console.log('⚠️ YouTube not authorized - visit /auth/youtube');
    }
  } catch (e) {
    console.warn('⚠️ YouTube init error:', e.message);
  }
}

async function connectYouTube() {
  if (!youtubeAPI) return;
  try {
    const response = await youtubeAPI.liveBroadcasts.list({
      part: 'snippet,contentDetails,status',
      mine: true,
      maxResults: 50
    });
    const broadcasts = response.data.items || [];
    const activeBroadcast = broadcasts.find(b => b.status?.lifeCycleStatus === 'live');
    if (!activeBroadcast) {
      youtubeActiveLiveChat = null;
      setTimeout(connectYouTube, 60000);
      return;
    }
    const chatId = activeBroadcast.snippet?.liveChatId;
    if (!chatId) {
      setTimeout(connectYouTube, 60000);
      return;
    }
    youtubeActiveLiveChat = chatId;
    console.log(`🎥 ✅ YouTube Live: ${activeBroadcast.snippet.title}`);
    pollYouTubeChat();
  } catch (e) {
    console.error('🎥 YouTube error:', e.message);
    setTimeout(connectYouTube, 30000);
  }
}

async function pollYouTubeChat() {
  if (!youtubeActiveLiveChat || !youtubeAPI) {
    setTimeout(connectYouTube, 60000);
    return;
  }
  try {
    const response = await youtubeAPI.liveChatMessages.list({
      liveChatId: youtubeActiveLiveChat,
      part: 'snippet,authorDetails',
      maxResults: 200
    });
    for (const msg of (response.data.items || [])) {
      if (processedYouTubeMessageIds.has(msg.id)) continue;
      processedYouTubeMessageIds.add(msg.id);
      const author = msg.authorDetails.displayName;
      const msgType = msg.snippet.type;
      if (msgType === 'textMessageEvent') {
        const text = msg.snippet.displayMessage;
        const xp = 1000;
        console.log(`💬 YouTube @${author}: ${text} → +${xp} XP`);
        addXP(`youtube_${author}`, author, xp, 'YouTube Comment');
      } else if (msgType === 'superChatEvent') {
        const usd = (msg.snippet.superChatDetails?.amountMicros || 0) / 1000000;
        const xp = Math.round(usd * 10000);
        console.log(`💰 YouTube @${author}: $${usd.toFixed(2)} → +${xp} XP`);
        addXP(`youtube_${author}`, author, xp, 'YouTube Super Chat');
      } else if (msgType === 'superStickerEvent') {
        const usd = (msg.snippet.superStickerDetails?.amountMicros || 0) / 1000000;
        const xp = Math.round(usd * 10000);
        console.log(`✨ YouTube @${author}: $${usd.toFixed(2)} → +${xp} XP`);
        addXP(`youtube_${author}`, author, xp, 'YouTube Super Sticker');
      }
    }
    setTimeout(pollYouTubeChat, 5000);
  } catch (e) {
    console.error('🎥 Poll error:', e.message);
    youtubeActiveLiveChat = null;
    setTimeout(connectYouTube, 30000);
  }
}
// YouTube Video Monitoring (Comments, Likes, Shares)
let processedYouTubeCommentIds = new Set();
let youtubeLastLikeCount = 0;
let youtubeLastShareCount = 0;

async function monitorYouTubeVideos() {
  if (!youtubeAPI) {
    setTimeout(monitorYouTubeVideos, 60000);
    return;
  }

  try {
    const channelsResponse = await youtubeAPI.channels.list({
      part: 'contentDetails',
      mine: true
    });

    const channel = channelsResponse.data.items[0];
    if (!channel) {
      setTimeout(monitorYouTubeVideos, 60000);
      return;
    }

    const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
    const videosResponse = await youtubeAPI.playlistItems.list({
      playlistId: uploadsPlaylistId,
      part: 'snippet,contentDetails',
      maxResults: 5
    });

    for (const item of (videosResponse.data.items || [])) {
      const videoId = item.contentDetails.videoId;
      
      const statsResponse = await youtubeAPI.videos.list({
        id: videoId,
        part: 'statistics,snippet'
      });

      const video = statsResponse.data.items[0];
      if (!video) continue;

      const likeCount = parseInt(video.statistics.likeCount || 0);
      const shareCount = parseInt(video.statistics.shareCount || 0);
      const title = video.snippet.title;

      if (youtubeLastLikeCount < likeCount) {
        const newLikes = likeCount - youtubeLastLikeCount;
        const xp = newLikes * 5;
        console.log(`❤️ YouTube VIDEO "${title}": +${newLikes} likes → +${xp} XP`);
        youtubeLastLikeCount = likeCount;
      }

      if (youtubeLastShareCount < shareCount) {
        const newShares = shareCount - youtubeLastShareCount;
        const xp = newShares * 500;
        console.log(`🔗 YouTube VIDEO "${title}": +${newShares} shares → +${xp} XP`);
        youtubeLastShareCount = shareCount;
      }

      await pollVideoComments(videoId, title);
    }

    setTimeout(monitorYouTubeVideos, 30000);
  } catch (e) {
    console.error('🎥 Video monitor error:', e.message);
    setTimeout(monitorYouTubeVideos, 60000);
  }
}

async function pollVideoComments(videoId, videoTitle) {
  if (!youtubeAPI) return;

  try {
    const response = await youtubeAPI.commentThreads.list({
      videoId: videoId,
      part: 'snippet',
      maxResults: 50,
      textFormat: 'plainText'
    });

    for (const thread of (response.data.items || [])) {
      const comment = thread.snippet.topLevelComment;
      const commentId = comment.id;
      
      if (processedYouTubeCommentIds.has(commentId)) continue;
      processedYouTubeCommentIds.add(commentId);

      const author = comment.snippet.authorDisplayName;
      const text = comment.snippet.textDisplay.substring(0, 50);
      const xp = 1000;
      console.log(`💬 YouTube VIDEO @${author}: "${text}..." on "${videoTitle}" → +${xp} XP`);
      addXP(`youtube_${author}`, author, xp, 'YouTube Video Comment');
    }
  } catch (e) {
    if (!e.message.includes('commentsDisabled')) {
      console.error('🎥 Comment poll error:', e.message);
    }
  }
}

// ============ END YOUTUBE ============

// always — they don't need the chat overlay running to earn XP, that was
// only ever a visual extra.
const PORT = process.env.PORT || 8081;
// Only httpLB listens on the public PORT for Railway
httpLB.listen(PORT, () => {
  console.log(`🔭 Scouter      → http://localhost:${PORT}`);
  connectTwitch();
  connectKick();
  // YouTube will init after token is set up
  setTimeout(() => initYouTube(), 2000);
});

console.log('\n🧪 Test without going live:');
console.log('   http://localhost:8081/test?action=chat&name=Goku');
console.log('   http://localhost:8081/test?action=gift&name=Vegeta&diamonds=1000');
console.log('   http://localhost:8081/test?action=like&name=Piccolo&xp=500');

console.log('\n📺 MULTISTREAM SETUP:');
console.log(`   TikTok:  ${MULTISTREAM.tiktok ? '@' + MULTISTREAM.tiktok + ' ✅' : '(disabled)'}`);
console.log(`   Twitch:  ${MULTISTREAM.twitch ? MULTISTREAM.twitch + ' ✅' : '(disabled)'}`);
console.log(`   Kick:    ${MULTISTREAM.kick ? MULTISTREAM.kick + ' ✅' : '(disabled)'}`);
if (youtubeAuthToken) {
  console.log(`   YouTube: ${MULTISTREAM.youtube} ✅`);
} else {
  console.log(`   YouTube: ${MULTISTREAM.youtube} (not authorized yet)`);
  console.log('   To authorize: http://localhost:8081/auth/youtube-login');
}
console.log('');

// ── QUIET MODE ─────────────────────────────────────────────────────────────
// Type "q" to toggle event log spam off/on so you can type commands cleanly.
// Admin command output always prints regardless.
let QUIET = false;
function elog(...args) { if (!QUIET) console.log(...args); }

// ── TERMINAL COMMANDS ──────────────────────────────────────────────────────
//   xp <name> <amount>     → set exact XP        (xp vegeta 50000)
//   add <name> <amount>    → add/remove XP       (add vegeta 5000 | add vegeta -5000)
//   rank <name> <rank>     → jump to rank        (rank vegeta UI)
//   who <name>             → show user's XP/rank
//   del <name>             → delete user
//   top                    → top 20 list
//   ranks                  → list rank names/thresholds
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const parts = line.trim().split(/\s+/);
  const cmd   = (parts[0] || '').toLowerCase();
  if (!cmd) return;

  const applyEdit = (u, newXp) => {
    const before  = u.xp;
    const oldRank = getRank(before, u.pathChoice);
    u.xp = Math.max(0, newXp);
    const newRank = getRank(u.xp, u.pathChoice);
    saveState();
    debouncedPush();
    if (newRank.id > oldRank.id) {
      send(wssLB, {
        type: 'rankup', userId: u.id, name: u.name,
        oldRank: { id: oldRank.id, short: oldRank.short, name: oldRank.name },
        newRank: { id: newRank.id, short: newRank.short, name: newRank.name,
                   color: newRank.color, aura: newRank.aura },
      });
    }
    console.log(`🛠️  ${u.name}: ${before.toLocaleString()} → ${u.xp.toLocaleString()} XP (${oldRank.short} → ${newRank.short})`);
  };

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

  } else if (cmd === 'help') {
    console.log('Commands: xp <name> <amt> | add <name> <amt> | rank <name> <rank> | who <name> | del <name> | top | ranks | war | race | stakes | record | link | unlink | kick | path | worth | watch | reset | q');

  } else {
    console.log('Unknown command — type: help');
  }
});

tiktok.connect().catch((err) => {
  console.log('⚠️  Initial connect failed:', err?.message || err);
  console.log('   Retrying in 20s...\n');
  setTimeout(reconnectFresh, 20000);
});
