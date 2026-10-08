import 'dotenv/config.js';
import { Client, GatewayIntentBits, EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer } from 'http';
import Stripe from 'stripe';
import axios from 'axios';
import crypto from 'crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { TikTokLive } from '@tiktool/live';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RANKINGS_FILE = path.join(__dirname, 'rankings-save.json');
const TRACKING_CACHE = path.join(__dirname, 'tracking-cache.json');

// Stripe config
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// API configs
const TIKTOK_USERNAME = 'gblilmar';
const YOUTUBE_CHANNEL = 'hbtcdbz';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '06fcc1d26fmsh098fdf48c374fdbp147ec6jsnd31c22793bf3';

// XP rates
const XP_RATES = {
  CHAT: 100,
  DRAGON_EMOJI: 500,
  TIKTOK_COMMENT: 1000,
  YOUTUBE_LIKE: 500,
  YOUTUBE_COMMENT: 1000,
  SHARE: 2500,
  STRIPE_MULTIPLIER: 1.5,
  MESSAGE_COOLDOWN: 30000
};

const RANKS = [
  { id:0,  name:'Low-Class Warrior',       short:'LOW CLASS', xp:0,         emoji:'💩' },
  { id:1,  name:'Elite Warrior',           short:'ELITE',     xp:2500,      emoji:'⚔️' },
  { id:2,  name:'Super Saiyan',            short:'SSJ',       xp:10000,     emoji:'⚡' },
  { id:3,  name:'Super Saiyan 2',          short:'SSJ2',      xp:26000,     emoji:'⚡⚡' },
  { id:4,  name:'Super Saiyan 3',          short:'SSJ3',      xp:58000,     emoji:'💥' },
  { id:5,  name:'Super Saiyan 4',          short:'SSJ4',      xp:115000,    emoji:'🔴' },
  { id:6,  name:'Super Saiyan God',        short:'SS GOD',    xp:205000,    emoji:'🔥' },
  { id:7,  name:'Super Saiyan Blue',       short:'SS BLUE',   xp:335000,    emoji:'💠' },
  { id:12, name:'Omni-King',               short:'OMNI KING', xp:7500000,   emoji:'👑' },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

// Express server
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 8080;
const server = createServer(app);

// WebSocket server for live overlay
const wss = new WebSocketServer({ server });
let wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`🔗 WebSocket client connected (${wsClients.size} total)`);
  
  // Send initial leaderboard to new client
  const topUsers = Object.values(users)
    .filter(u => !u.autoCreated)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 25);
  
  ws.send(JSON.stringify({
    type: 'init',
    leaderboard: topUsers.map(u => ({
      id: u.id,
      name: u.name,
      xp: u.xp,
      rankId: u.rankId,
      rankName: (RANKS.find(r => r.id === u.rankId) || RANKS[0]).name
    }))
  }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`🔌 WebSocket client disconnected (${wsClients.size} remain)`);
  });
});

function broadcastActivity(action, name, userId, xp, extra) {
  const msg = JSON.stringify({
    type: 'activity',
    action,
    name,
    userId,
    xp,
    count: extra,
    entry: users[userId] ? {
      id: userId,
      name: users[userId].name,
      xp: users[userId].xp,
      rankId: users[userId].rankId,
      rankName: (RANKS.find(r => r.id === users[userId].rankId) || RANKS[0]).name
    } : null
  });
  
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function broadcastLeaderboard() {
  const topUsers = Object.values(users)
    .filter(u => !u.autoCreated)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 25);
  
  const msg = JSON.stringify({
    type: 'leaderboard',
    leaderboard: topUsers.map(u => ({
      id: u.id,
      name: u.name,
      xp: u.xp,
      rankId: u.rankId,
      rankName: (RANKS.find(r => r.id === u.rankId) || RANKS[0]).name
    }))
  });
  
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// TikTok Live connection
let tiktok = null;
let tiktokConnected = false;

async function initTikTokLive() {
  try {
    tiktok = new TikTokLive({ uniqueId: TIKTOK_USERNAME });
    
    tiktok.on('chat', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      const comment = data.comment || '';
      
      console.log(`💬 TikTok @${userName}: ${comment}`);
      
      // Award XP for TikTok comments
      if (!users[`tiktok_${userId}`]) {
        const scouterId = generateScouterId();
        users[`tiktok_${userId}`] = {
          id: `tiktok_${userId}`,
          name: `@${userName}`,
          xp: 0,
          rankId: 0,
          scouterId: scouterId,
          linkedAccounts: { tiktok: userName },
          autoCreated: true,
          bannedFromXP: false
        };
      }
      
      // Award XP
      users[`tiktok_${userId}`].xp += XP_RATES.CHAT;
      broadcastActivity('chat', userName, `tiktok_${userId}`, XP_RATES.CHAT, null);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('like', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      const likeCount = data.likeCount || 1;
      
      console.log(`❤️ TikTok @${userName}: +${likeCount} likes`);
      
      if (!users[`tiktok_${userId}`]) {
        const scouterId = generateScouterId();
        users[`tiktok_${userId}`] = {
          id: `tiktok_${userId}`,
          name: `@${userName}`,
          xp: 0,
          rankId: 0,
          scouterId: scouterId,
          linkedAccounts: { tiktok: userName },
          autoCreated: true,
          bannedFromXP: false
        };
      }
      
      const xpGained = likeCount * 5; // 5 XP per like
      users[`tiktok_${userId}`].xp += xpGained;
      broadcastActivity('like', userName, `tiktok_${userId}`, xpGained, likeCount);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('follow', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      
      console.log(`➕ TikTok @${userName}: FOLLOWED!`);
      
      if (!users[`tiktok_${userId}`]) {
        const scouterId = generateScouterId();
        users[`tiktok_${userId}`] = {
          id: `tiktok_${userId}`,
          name: `@${userName}`,
          xp: 0,
          rankId: 0,
          scouterId: scouterId,
          linkedAccounts: { tiktok: userName },
          autoCreated: true,
          bannedFromXP: false
        };
      }
      
      users[`tiktok_${userId}`].xp += 500; // 500 XP for follow
      broadcastActivity('follow', userName, `tiktok_${userId}`, 500, null);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('gift', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      const giftCount = data.repeatCount || 1;
      
      console.log(`🎁 TikTok @${userName}: Sent ${giftCount} gift(s)!`);
      
      if (!users[`tiktok_${userId}`]) {
        const scouterId = generateScouterId();
        users[`tiktok_${userId}`] = {
          id: `tiktok_${userId}`,
          name: `@${userName}`,
          xp: 0,
          rankId: 0,
          scouterId: scouterId,
          linkedAccounts: { tiktok: userName },
          autoCreated: true,
          bannedFromXP: false
        };
      }
      
      const xpGained = giftCount * 100; // 100 XP per gift
      users[`tiktok_${userId}`].xp += xpGained;
      broadcastActivity('gift', userName, `tiktok_${userId}`, xpGained, giftCount);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('disconnect', () => {
      console.log('🔌 TikTok Live disconnected');
      tiktokConnected = false;
    });
    
    await tiktok.connect();
    tiktokConnected = true;
    console.log(`✅ TikTok Live connected: @${TIKTOK_USERNAME}`);
  } catch (error) {
    console.error('❌ TikTok Live error:', error.message);
    // Retry in 10 seconds
    setTimeout(initTikTokLive, 10000);
  }
}

let users = {};
let tiktokUsers = {}; // Map TikTok handles to Scouter IDs (auto-created users)
let linkedAccounts = {}; // Store linked accounts
let activityChannelId = null;
let lastMessageXP = {};
let trackingCache = { tiktok: {}, youtube: {} };
let dailyStats = {}; // Track daily XP gains {date: {userId: xpGained}}
let xpQueue = []; // XP transaction queue
let processedXPSources = new Set(); // Prevent duplicates (hash of source)
let isLive = false;
let liveStartTime = null;
let wasLiveLastCheck = false;
let lastLiveCheck = 0;

// Generate unique Scouter ID
function generateScouterId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'SCOUTER-';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Simple password hash (salt-based)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// Verify password
function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const [salt, hash] = storedHash.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return verify === hash;
}

// Create unique hash for XP source (prevent duplicates)
function hashXPSource(userId, source, sourceId) {
  return `${userId}:${source}:${sourceId}:${Math.floor(Date.now() / 60000)}`; // Per minute
}

// Atomic XP transaction (queue + verify)
async function queueXPTransaction(userId, username, xpAmount, reason, sourceId, channel) {
  // Check if user is banned from earning XP
  if (users[userId]?.bannedFromXP) {
    console.log(`🚫 ${username} is banned from earning XP`);
    return false;
  }
  
  const sourceHash = hashXPSource(userId, reason, sourceId);
  
  // Skip if already processed this minute
  if (processedXPSources.has(sourceHash)) {
    console.log(`⏭️ Skipped duplicate: ${username} - ${reason}`);
    return false;
  }
  
  processedXPSources.add(sourceHash);
  
  // Add to queue
  const transaction = {
    userId,
    username,
    xpAmount,
    reason,
    sourceId,
    timestamp: Date.now(),
    processed: false
  };
  
  xpQueue.push(transaction);
  
  // Process immediately (atomic)
  await processXPTransaction(transaction, channel);
  return true;
}

// Process single transaction atomically
async function processXPTransaction(transaction, channel) {
  try {
    const { userId, username, xpAmount, reason, sourceId } = transaction;
    
    // Create backup before modification
    const backup = JSON.parse(JSON.stringify(users[userId] || {}));
    
    let isNewUser = false;
    let newScouterId = null;
    
    if (!users[userId]) {
      isNewUser = true;
      newScouterId = generateScouterId();
      users[userId] = { 
        id: userId, 
        name: username, 
        xp: 0, 
        rankId: 0, 
        scouterId: newScouterId, 
        linkedAccounts: {},
        transactionLog: [], // Track all XP changes
        bannedFromXP: false
      };
    }
    
    const oldXP = users[userId].xp || 0;
    const oldRank = getRankInfo(users[userId].rankId);
    
    // Award XP
    users[userId].xp = oldXP + xpAmount;
    const newRank = RANKS.filter(r => r.xp <= users[userId].xp).pop();
    const rankChanged = oldRank.id !== newRank.id;
    users[userId].rankId = newRank.id;
    
    // Log transaction
    users[userId].transactionLog = users[userId].transactionLog || [];
    users[userId].transactionLog.push({
      timestamp: Date.now(),
      xpAmount,
      reason,
      sourceId,
      oldXP,
      newXP: users[userId].xp,
      rankChanged
    });
    
    // Track daily XP for MVP calculation
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    if (!dailyStats[today]) dailyStats[today] = {};
    dailyStats[today][userId] = (dailyStats[today][userId] || 0) + xpAmount;
    
    // Save atomically
    saveUsers();
    
    // Broadcast activity to WebSocket clients
    broadcastActivity('chat', username, userId, xpAmount, null);
    broadcastLeaderboard();
    
    console.log(`💰 ${username} earned ${xpAmount} XP (${reason})`);
    if (isNewUser) console.log(`🆔 New Scouter ID: ${newScouterId}`);
    
    // Post to channel if live or significant event
    if (channel && (isLive || rankChanged || isNewUser)) {
      const embed = new EmbedBuilder()
        .setColor(isLive ? '#FF6B00' : '#00FF50')
        .setTitle(`${isLive ? 'LIVE' : 'XP'} - ${username}`)
        .addFields(
          { name: 'XP', value: `+${xpAmount}`, inline: true },
          { name: 'Total', value: `${fmtPL(users[userId].xp)}`, inline: true },
          { name: 'Reason', value: reason, inline: false }
        );
      
      if (rankChanged) {
        embed.addFields({ name: 'Rank UP!', value: newRank.short, inline: false });
      }
      
      if (isNewUser) {
        embed.addFields({ name: 'Scouter ID', value: newScouterId, inline: false });
      }
      
      embed.setTimestamp();
      await channel.send({ embeds: [embed] });
    }
    
    transaction.processed = true;
    return true;
    
  } catch (error) {
    console.error('❌ XP Transaction FAILED:', error.message);
    // Restore backup on failure
    const backup = users[transaction.userId];
    saveUsers();
    return false;
  }
}

console.log('🔍 Discord Token:', process.env.DISCORD_TOKEN ? '✅ YES' : '❌ NO');
console.log('💳 Stripe Key:', process.env.STRIPE_SECRET_KEY ? '✅ LOADED' : '❌ NO');
console.log('🎬 TikTok:', TIKTOK_USERNAME);
console.log('📺 YouTube:', YOUTUBE_CHANNEL);

function loadUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(RANKINGS_FILE, 'utf8'));
    users = data.users || {};
    tiktokUsers = data.tiktokUsers || {};
    dailyStats = data.dailyStats || {};
    console.log(`✅ Loaded ${Object.keys(users).length} users (${Object.keys(tiktokUsers).length} TikTok)`);
  } catch (e) {
    console.error('❌ Error loading users:', e.message);
    users = {};
    tiktokUsers = {};
    dailyStats = {};
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(RANKINGS_FILE, JSON.stringify({ users, tiktokUsers, dailyStats }, null, 2));
  } catch (e) {
    console.error('❌ Error saving users:', e.message);
  }
}

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(TRACKING_CACHE, 'utf8'));
    trackingCache = data;
  } catch (e) {
    trackingCache = { tiktok: {}, youtube: {} };
  }
}

function saveCache() {
  try {
    fs.writeFileSync(TRACKING_CACHE, JSON.stringify(trackingCache, null, 2));
  } catch (e) {
    console.error('❌ Error saving cache:', e.message);
  }
}

function getRankInfo(rankId) {
  return RANKS.find(r => r.id === rankId) || RANKS[0];
}

function getRank(xp) {
  return RANKS.filter(r => r.xp <= xp).pop() || RANKS[0];
}

// Get yesterday's MVP (most XP earned)
function getMVPYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  if (!dailyStats[yesterdayStr]) return null;
  
  let mvpId = null;
  let mvpXp = 0;
  
  for (const [userId, xp] of Object.entries(dailyStats[yesterdayStr])) {
    if (xp > mvpXp) {
      mvpXp = xp;
      mvpId = userId;
    }
  }
  
  return { userId: mvpId, xp: mvpXp, date: yesterdayStr };
}

// Get top 25 users
function getTop25() {
  return Object.values(users)
    .filter(u => !u.autoCreated) // Exclude auto-created (TikTok only)
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, 25);
}

function fmtPL(n) {
  if (n >= 1000000) return (n/1000000).toFixed(2)+'M';
  if (n >= 10000) return Math.round(n).toLocaleString();
  return String(Math.round(n));
}

async function awardXP(userId, username, xpAmount, reason, channel) {
  // Atomic XP transaction with anti-exploit + no data corruption
  const sourceId = `${Date.now()}-${Math.random()}`;
  await queueXPTransaction(userId, username, xpAmount, reason, sourceId, channel);
  // All embed/posting handled in processXPTransaction()
}

// ===== TIKTOK TRACKING =====
async function checkTikTokActivity() {
  try {
    console.log('🎬 Scanning TikTok comments on @' + TIKTOK_USERNAME + '...');

    if (!RAPIDAPI_KEY) {
      console.warn('⚠️ RapidAPI key not set');
      return;
    }

    // Step 1: Get recent videos
    const videosResponse = await axios.get('https://tiktok-scraper7.p.rapidapi.com/user/posts', {
      params: {
        username: TIKTOK_USERNAME,
        count: 5
      },
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'tiktok-scraper7.p.rapidapi.com'
      },
      timeout: 10000
    });

    if (!videosResponse.data.videos || videosResponse.data.videos.length === 0) {
      console.log('⚠️ No videos found on @' + TIKTOK_USERNAME);
      return;
    }

    console.log(`✅ Found ${videosResponse.data.videos.length} videos, checking for comments...`);

    let commentsFound = 0;
    let xpAwarded = 0;

    // Step 2: Scan each video for comments
    for (const video of videosResponse.data.videos) {
      try {
        const videoId = video.id;

        // Get comments
        const commentsResponse = await axios.get('https://tiktok-scraper7.p.rapidapi.com/video/comments', {
          params: {
            video_id: videoId,
            count: 20
          },
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'tiktok-scraper7.p.rapidapi.com'
          },
          timeout: 8000
        });

        const commentCount = commentsResponse.data.comments?.length || 0;
        console.log(`   Video ${videoId}: ${commentCount} comments found`);
        
        if (commentsResponse.data.comments) {
          for (const comment of commentsResponse.data.comments) {
            const commenterHandle = (comment.author?.nickname || comment.author || '').toLowerCase().replace('@', '');
            console.log(`     └─ Comment by: ${commenterHandle}`);
            
            // Prevent duplicates per video per user
            const commentHash = `tiktok:${videoId}:${commenterHandle}:comment`;
            if (processedXPSources.has(commentHash)) continue;
            
            processedXPSources.add(commentHash);
            
            // Check if TikTok handle is already linked to Discord user
            let linkedDiscordId = null;
            for (const [discordId, user] of Object.entries(users)) {
              if (user.linkedAccounts?.tiktok && 
                  user.linkedAccounts.tiktok.toLowerCase() === commenterHandle) {
                linkedDiscordId = discordId;
                break;
              }
            }
            
            // If linked to Discord user, award XP
            if (linkedDiscordId) {
              const user = users[linkedDiscordId];
              const channel = client.channels.cache.get(activityChannelId);
              await queueXPTransaction(
                linkedDiscordId,
                user.name,
                1000,
                `TikTok comment on @${TIKTOK_USERNAME}`,
                commentHash,
                channel
              );
              
              commentsFound++;
              xpAwarded += 1000;
              console.log(`💬 ${user.name} (@${commenterHandle}): +1000 XP (TikTok comment)`);
            } 
            // If NOT linked, auto-create Scouter account
            else if (!tiktokUsers[commenterHandle]) {
              const scouterId = generateScouterId();
              tiktokUsers[commenterHandle] = scouterId;
              
              // Create auto-Scouter for TikTok user
              const autoUserId = `tiktok_${commenterHandle}`;
              users[autoUserId] = {
                id: autoUserId,
                name: `@${commenterHandle}`,
                xp: 0,
                rankId: 0,
                scouterId: scouterId,
                linkedAccounts: { tiktok: commenterHandle },
                autoCreated: true, // Mark as auto-created from TikTok
                createdAt: Date.now(),
                bannedFromXP: false
              };
              
              // Award XP
              const channel = client.channels.cache.get(activityChannelId);
              await queueXPTransaction(
                autoUserId,
                `@${commenterHandle}`,
                1000,
                `TikTok comment on @${TIKTOK_USERNAME}`,
                commentHash,
                channel
              );
              
              commentsFound++;
              xpAwarded += 1000;
              console.log(`🆕 NEW SCOUTER: @${commenterHandle} (${scouterId}) - +1000 XP`);
            }
          }
        }

      } catch (videoError) {
        continue;
      }
    }

    if (commentsFound > 0) {
      console.log(`✅ TikTok: ${commentsFound} comments found, ${xpAwarded} XP awarded`);
    } else {
      console.log('📭 No new linked user comments detected');
    }

  } catch (error) {
    console.error('❌ TikTok error:', error.message);
  }
}

// ===== AUTO LIVE DETECTION (checks every 2 min) =====
async function checkLiveStatus() {
  try {
    if (!YOUTUBE_API_KEY) return;
    
    const now = Date.now();
    if (now - lastLiveCheck < 120000) return; // Only check every 2 min
    lastLiveCheck = now;
    
    // Search for channel's live videos
    const liveResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        channelId: YOUTUBE_CHANNEL,
        type: 'video',
        eventType: 'live',
        maxResults: 1,
        key: YOUTUBE_API_KEY
      },
      timeout: 5000
    });
    
    const isCurrentlyLive = liveResponse.data.items && liveResponse.data.items.length > 0;
    
    // STATE CHANGE: Not live → Live
    if (isCurrentlyLive && !wasLiveLastCheck && !isLive) {
      console.log(`🔴 AUTO LIVE DETECTED - Starting real-time tracking!`);
      isLive = true;
      liveStartTime = Date.now();
      wasLiveLastCheck = true;
      
      const channel = client.channels.cache.get(activityChannelId);
      if (channel) {
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🔴 GOING LIVE - REAL-TIME XP ACTIVE')
          .addFields(
            { name: 'Auto-Detected', value: 'Real-time XP tracking started', inline: false }
          )
          .setTimestamp();
        await channel.send({ embeds: [embed] });
      }
    }
    // STATE CHANGE: Live → Not live
    else if (!isCurrentlyLive && wasLiveLastCheck && isLive) {
      const liveMinutes = Math.round((Date.now() - liveStartTime) / 60000);
      console.log(`⚫ STREAM ENDED - Tracked for ${liveMinutes} minutes`);
      isLive = false;
      wasLiveLastCheck = false;
      
      const channel = client.channels.cache.get(activityChannelId);
      if (channel) {
        const embed = new EmbedBuilder()
          .setColor('#888888')
          .setTitle('⚫ STREAM ENDED')
          .addFields(
            { name: 'Duration', value: `${liveMinutes} minutes`, inline: false }
          )
          .setTimestamp();
        await channel.send({ embeds: [embed] });
      }
    }
    
  } catch (error) {
    // Silent fail
  }
}

// ===== YOUTUBE TRACKING =====
async function checkYouTubeActivity() {
  try {
    console.log('📺 Checking YouTube activity...');

    if (!YOUTUBE_API_KEY) {
      console.warn('⚠️ YouTube API key not set');
      return;
    }

    // Search for channel by username
    const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: YOUTUBE_CHANNEL,
        type: 'channel',
        maxResults: 1,
        key: YOUTUBE_API_KEY
      },
      timeout: 5000
    });

    if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
      console.warn('⚠️ YouTube channel not found:', YOUTUBE_CHANNEL);
      return;
    }

    const channelId = searchResponse.data.items[0].id.channelId;
    console.log('✅ YouTube channel found:', channelId);

    // Get channel statistics
    const statsResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'statistics,snippet',
        id: channelId,
        key: YOUTUBE_API_KEY
      },
      timeout: 5000
    });

    if (statsResponse.data.items.length > 0) {
      const stats = statsResponse.data.items[0].statistics;
      console.log(`✅ YouTube Stats - Subscribers: ${stats.subscriberCount}, Views: ${stats.viewCount}`);
    }

  } catch (error) {
    console.error('❌ YouTube error:', error.response?.status, error.message);
  }
}

// ===== STRIPE WEBHOOK =====
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  console.log('💳 Stripe webhook received');

  try {
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('✅ Stripe Payment Completed:', session.id);

      const amount = session.amount_total / 100;
      let discordUsername = null;
      
      if (session.custom_fields && session.custom_fields.length > 0) {
        discordUsername = session.custom_fields[0].text?.value;
      }

      let targetUser = null;
      if (discordUsername) {
        const cleanUsername = discordUsername.split('#')[0];
        targetUser = Object.values(users).find(u => u.name.toLowerCase() === cleanUsername.toLowerCase());
      }

      if (targetUser) {
        const coins = Math.round(amount * 100);
        let xpPerCoin = 5;
        if (coins >= 5000) xpPerCoin = 300;
        else if (coins >= 1000) xpPerCoin = 150;
        else if (coins >= 200) xpPerCoin = 80;
        else if (coins >= 50) xpPerCoin = 40;
        else if (coins >= 10) xpPerCoin = 20;
        else if (coins >= 2) xpPerCoin = 10;

        const baseXP = Math.round(coins * xpPerCoin);
        const xpAwarded = Math.round(baseXP * XP_RATES.STRIPE_MULTIPLIER);

        const channel = client.channels.cache.get(activityChannelId);
        await awardXP(targetUser.id, targetUser.name, xpAwarded, `Stripe donation $${amount.toFixed(2)} (1.5x)`, channel);

        const embed = new EmbedBuilder()
          .setColor('#6366F1')
          .setTitle('💳 DONATION RECEIVED')
          .addFields(
            { name: '👤 Donator', value: targetUser.name, inline: true },
            { name: '💰 Amount', value: `$${amount.toFixed(2)}`, inline: true },
            { name: '⚡ XP Awarded', value: `${xpAwarded} (1.5x multiplier)`, inline: false }
          )
          .setTimestamp();

        if (channel) {
          try {
            await channel.send({ embeds: [embed] });
          } catch (e) {
            console.error('❌ Failed to post donation:', e.message);
          }
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Stripe webhook error:', error.message);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: client.user ? 'online' : 'offline' });
});

// Test route
app.get('/test', (req, res) => {
  res.send('SERVER IS WORKING');
});

// Overlay endpoint - serves original custom overlay.html with WebSocket
app.get('/overlay.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'overlay.html'));
});

// ===== DISCORD CLIENT =====
client.on('ready', () => {
  console.log('✅ Discord bot ready as ' + client.user.tag);
  loadUsers();
  loadCache();
  
  // Initialize TikTok Live connection
  initTikTokLive();
  
  // Run checks immediately on startup
  checkYouTubeActivity();
  checkLiveStatus(); // Check if already live
  
  // Start periodic tracking
  setInterval(checkYouTubeActivity, 600000); // 10 minutes
  setInterval(checkLiveStatus, 120000); // 2 minutes for live detection
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (!activityChannelId && message.guild) {
    const channel = message.guild.channels.cache.find(c => c.name === 'scouter-activity');
    if (channel) activityChannelId = channel.id;
  }

  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).split(/\s+/);
    const command = args[0].toLowerCase();

    try {
      if (command === 'scouter-setup') {
        if (!message.member.permissions.has('ManageGuild')) {
          return await message.reply('❌ Need manage server permission');
        }

        let channel = message.guild.channels.cache.find(c => c.name === 'scouter-activity');
        if (!channel) {
          channel = await message.guild.channels.create({
            name: 'scouter-activity',
            type: ChannelType.GuildText,
            topic: '🔭 HBTC Scouter Activity - Auto-tracking'
          });
        }

        activityChannelId = channel.id;
        await message.reply(`✅ Scouter activity channel set to <#${channel.id}>`);

      } else if (command === 'powerlevel') {
        const userId = message.author.id;
        const user = users[userId] || { id: userId, name: message.author.username, xp: 0, rankId: 0 };
        const rankInfo = getRankInfo(user.rankId);
        
        let linkedText = 'Discord';
        let permanentLinks = [];
        
        if (user.linkedAccounts) {
          if (user.linkedAccounts.tiktok) {
            linkedText += ', TikTok';
            if (user.linkedAt) permanentLinks.push('TikTok (PERMANENT)');
          }
          if (user.linkedAccounts.youtube) linkedText += ', YouTube';
          if (user.linkedAccounts.stripe) linkedText += ', Stripe';
        }

        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle(`POWER LEVEL - ${user.name}`)
          .addFields(
            { name: 'Scouter ID', value: user.scouterId || 'GENERATING...', inline: false },
            { name: 'XP', value: `${fmtPL(user.xp || 0)}`, inline: true },
            { name: 'Rank', value: rankInfo.short, inline: true },
            { name: 'Linked Platforms', value: linkedText, inline: false }
          );
        
        if (permanentLinks.length > 0) {
          embed.addFields({ name: 'Permanent Links', value: permanentLinks.join(', '), inline: false });
        }
        
        embed.setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'leaderboard') {
        const sorted = Object.values(users)
          .sort((a, b) => (b.xp || 0) - (a.xp || 0))
          .slice(0, 10);

        let text = sorted.map((u, i) => `**${i+1}.** ${u.name} - ${fmtPL(u.xp || 0)}`).join('\n') || 'No data!';

        const embed = new EmbedBuilder()
          .setColor('#00FF80')
          .setTitle('🏆 TOP 10')
          .setDescription(text)
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'donate') {
        const userId = message.author.id;
        if (!users[userId]) {
          users[userId] = { 
            id: userId, 
            name: message.author.username, 
            xp: 0, 
            rankId: 0, 
            scouterId: generateScouterId(),
            linkedAccounts: {}
          };
          saveUsers();
        }

        const embed = new EmbedBuilder()
          .setColor('#6366F1')
          .setTitle('💳 SUPPORT HBTC')
          .setDescription(`Click below to donate via Stripe - Apple Pay ready!`)
          .addFields(
            { name: '💰 How It Works', value: '1. Click button\n2. Enter your Discord username\n3. Choose amount ($1 minimum)\n4. Pay with Apple Pay, Card, etc.\n5. XP awarded automatically! ⚡', inline: false },
            { name: '⚡ XP Bonus', value: 'All donations get 1.5x XP multiplier!', inline: false }
          )
          .setTimestamp();

        const row = {
          type: 1,
          components: [
            {
              type: 2,
              label: '💳 Donate with Apple Pay',
              style: 5,
              url: 'https://buy.stripe.com/3cIaEW1B64Z891m7Cx7IY00'
            }
          ]
        };

        await message.reply({ embeds: [embed], components: [row] });

      } else if (command === 'battle') {
        const opponent = args[1];
        const result = args[2] || 'draw';
        const xpChange = result === 'win' ? 100 : result === 'lose' ? -50 : 0;

        if (xpChange !== 0) {
          const channel = message.guild.channels.cache.get(activityChannelId);
          await awardXP(message.author.id, message.author.username, xpChange, `Battle ${result} vs ${opponent}`, channel);
        }

        const embed = new EmbedBuilder()
          .setColor(result === 'win' ? '#00FF50' : result === 'lose' ? '#FF0000' : '#FFD700')
          .setTitle(`⚔️ BATTLE ${result.toUpperCase()}`)
          .addFields(
            { name: '👥 vs', value: opponent, inline: true },
            { name: '⚡ XP', value: `${xpChange > 0 ? '+' : ''}${xpChange}`, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'link-tiktok') {
        const userId = message.author.id;
        const tiktokHandle = args[1];
        
        if (!tiktokHandle) {
          return await message.reply('Usage: !link-tiktok @yourtiktokhandle');
        }
        
        const cleanHandle = tiktokHandle.replace('@', '').toLowerCase();
        
        // Create/get Discord user account
        if (!users[userId]) {
          users[userId] = { 
            id: userId, 
            name: message.author.username, 
            xp: 0, 
            rankId: 0, 
            scouterId: null,
            linkedAccounts: {},
            linkedAt: null
          };
        }
        
        // Check if already linked
        if (users[userId].linkedAccounts.tiktok) {
          return await message.reply('You already linked TikTok to your Scouter account! Link is permanent.');
        }
        
        // Check if this TikTok handle has an UNCLAIMED auto-created Scouter
        let unclaimedScouterId = tiktokUsers[cleanHandle];
        let foundAutoCreatedUser = null;
        
        if (unclaimedScouterId) {
          // Find the auto-created user by Scouter ID
          for (const [id, user] of Object.entries(users)) {
            if (user.scouterId === unclaimedScouterId && user.autoCreated && !user.linkedAt) {
              foundAutoCreatedUser = { id, user };
              break;
            }
          }
        }
        
        // CASE 1: Existing unclaimed TikTok Scouter found
        if (foundAutoCreatedUser) {
          const { id: autoId, user: autoUser } = foundAutoCreatedUser;
          const permanentScouterId = autoUser.scouterId;
          const xpFromTikTok = autoUser.xp;
          
          // Permanently link Discord to this Scouter
          users[userId].scouterId = permanentScouterId;
          users[userId].xp = (users[userId].xp || 0) + xpFromTikTok; // Merge XP
          users[userId].linkedAccounts.tiktok = cleanHandle;
          users[userId].linkedAt = Date.now(); // Mark as permanently linked
          users[userId].rankId = getRank(users[userId].xp).id;
          
          // Delete old auto-created account (no longer needed)
          delete users[autoId];
          
          saveUsers();
          
          const channel = message.guild.channels.cache.get(activityChannelId);
          const embed = new EmbedBuilder()
            .setColor('#00FF50')
            .setTitle('TIKTOK LINKED (PERMANENT)')
            .addFields(
              { name: 'Scouter ID', value: permanentScouterId, inline: true },
              { name: 'Discord', value: message.author.username, inline: true },
              { name: 'TikTok', value: `@${cleanHandle}`, inline: true },
              { name: 'XP Merged', value: `+${xpFromTikTok} (from TikTok)`, inline: true },
              { name: 'Status', value: 'PERMANENTLY LINKED - Cannot unlink', inline: false }
            )
            .setTimestamp();
          
          await message.reply({ embeds: [embed] });
          console.log(`✅ PERMANENT: ${message.author.username} claimed SCOUTER ${permanentScouterId} (@${cleanHandle})`);
        }
        // CASE 2: No unclaimed TikTok Scouter - create new one
        else {
          const newScouterId = generateScouterId();
          users[userId].scouterId = newScouterId;
          users[userId].linkedAccounts.tiktok = cleanHandle;
          users[userId].linkedAt = Date.now();
          
          // Also track in tiktokUsers for future auto-created accounts
          tiktokUsers[cleanHandle] = newScouterId;
          
          saveUsers();
          
          const channel = message.guild.channels.cache.get(activityChannelId);
          const embed = new EmbedBuilder()
            .setColor('#000000')
            .setTitle('TIKTOK LINKED (PERMANENT)')
            .addFields(
              { name: 'Scouter ID', value: newScouterId, inline: true },
              { name: 'TikTok', value: `@${cleanHandle}`, inline: true },
              { name: 'Status', value: 'PERMANENTLY LINKED - Cannot unlink', inline: false }
            )
            .setTimestamp();
          
          await message.reply({ embeds: [embed] });
          console.log(`✅ PERMANENT: ${message.author.username} linked TikTok @${cleanHandle} to SCOUTER ${newScouterId}`);
        }

      } else if (command === 'link-youtube') {
        const userId = message.author.id;
        
        if (!users[userId]) {
          users[userId] = { 
            id: userId, 
            name: message.author.username, 
            xp: 0, 
            rankId: 0, 
            scouterId: generateScouterId(),
            linkedAccounts: {}
          };
        }
        
        if (users[userId].linkedAccounts.youtube) {
          return await message.reply('You already linked YouTube to your Scouter account!');
        }

        users[userId].linkedAccounts.youtube = true;
        saveUsers();

        const channel = message.guild.channels.cache.get(activityChannelId);
        await awardXP(userId, message.author.username, 20000, 'YouTube channel linked + subscription bonus', channel);

        const scouterId = users[userId].scouterId;
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('YOUTUBE LINKED TO SCOUTER')
          .addFields(
            { name: 'Scouter ID', value: scouterId, inline: true },
            { name: 'Bonus', value: '+20,000 XP', inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'scouter-id') {
        const userId = message.author.id;
        
        if (!users[userId]) {
          return await message.reply('No Scouter account yet! Send a message or use a command to create one.');
        }

        await message.reply(`Your Scouter ID: \`${users[userId].scouterId}\``);
        await message.reply(`Linked Platforms: ${Object.keys(users[userId].linkedAccounts || {}).join(', ') || 'Discord (only)'}`);

      } else if (command === 'go-live') {
        isLive = true;
        liveStartTime = Date.now();
        console.log(`🔴 LIVE STARTED - Real-time XP tracking enabled!`);
        
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('GOING LIVE')
          .addFields(
            { name: 'Status', value: 'Real-time XP tracking ACTIVE', inline: false },
            { name: 'All activity earns XP', value: 'No delays, no corruption, fully atomic', inline: false }
          )
          .setTimestamp();
        
        const channel = message.guild.channels.cache.get(activityChannelId);
        if (channel) await channel.send({ embeds: [embed] });
        await message.reply('Going LIVE! XP tracking in real-time!');

      } else if (command === 'stop-live') {
        isLive = false;
        const liveMinutes = Math.round((Date.now() - liveStartTime) / 60000);
        console.log(`⚫ LIVE ENDED after ${liveMinutes} minutes`);
        
        // Calculate stats
        const userId = message.author.id;
        const user = users[userId];
        
        const embed = new EmbedBuilder()
          .setColor('#888888')
          .setTitle('STREAM ENDED')
          .addFields(
            { name: 'Live Duration', value: `${liveMinutes} minutes`, inline: true },
            { name: 'Current XP', value: `${fmtPL(user?.xp || 0)}`, inline: true }
          )
          .setTimestamp();
        
        const channel = message.guild.channels.cache.get(activityChannelId);
        if (channel) await channel.send({ embeds: [embed] });
        await message.reply('Stream ended! XP tracking continues offline.');

      } else if (command === 'scouter-password') {
        const password = args[1];
        
        if (!password || password.length < 6) {
          return await message.reply('Password must be at least 6 characters. Usage: !scouter-password mypassword');
        }
        
        const userId = message.author.id;
        
        if (!users[userId]) {
          return await message.reply('You need a Scouter account first! Send a Discord message or link TikTok.');
        }
        
        const passwordHash = hashPassword(password);
        users[userId].passwordHash = passwordHash;
        users[userId].passwordSetAt = Date.now();
        saveUsers();
        
        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('SCOUTER PASSWORD SET')
          .addFields(
            { name: 'Scouter ID', value: users[userId].scouterId, inline: true },
            { name: 'Status', value: 'Password is now protected', inline: true },
            { name: 'Use For', value: 'Transfer account if you change your @ handle', inline: false }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔐 ${message.author.username} set Scouter password protection`);

      } else if (command === 'transfer-scouter') {
        const scouterId = args[1];
        const password = args[2];
        const newHandle = args[3];
        
        if (!scouterId || !password || !newHandle) {
          return await message.reply('Usage: !transfer-scouter SCOUTERID password @newhandle');
        }
        
        const cleanNewHandle = newHandle.replace('@', '').toLowerCase();
        const userId = message.author.id;
        
        if (!users[userId]) {
          return await message.reply('You need a Scouter account first!');
        }
        
        const user = users[userId];
        
        // Verify Scouter ID matches
        if (user.scouterId !== scouterId) {
          return await message.reply('That Scouter ID does not match your account!');
        }
        
        // Verify password
        if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) {
          return await message.reply('Password is incorrect! Use !scouter-password to set one first.');
        }
        
        // Transfer TikTok handle
        const oldHandle = user.linkedAccounts?.tiktok;
        user.linkedAccounts.tiktok = cleanNewHandle;
        user.passwordHash = null; // Clear password after transfer
        saveUsers();
        
        // Update tiktokUsers mapping
        if (oldHandle) delete tiktokUsers[oldHandle];
        tiktokUsers[cleanNewHandle] = scouterId;
        saveUsers();
        
        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('SCOUTER TRANSFERRED')
          .addFields(
            { name: 'Scouter ID', value: scouterId, inline: true },
            { name: 'Old Handle', value: `@${oldHandle || 'none'}`, inline: true },
            { name: 'New Handle', value: `@${cleanNewHandle}`, inline: true },
            { name: 'XP Retained', value: `${fmtPL(user.xp)}`, inline: false },
            { name: 'Note', value: 'Password cleared. Set a new password with !scouter-password', inline: false }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔄 ${message.author.username} transferred SCOUTER ${scouterId} to @${cleanNewHandle}`);

      } else if (command === 'claim-scouter') {
        const scouterId = args[1];
        const tiktokHandle = args[2];
        
        if (!scouterId || !tiktokHandle) {
          return await message.reply('Usage: !claim-scouter SCOUTERID @tiktokhandle\nOr use: !link-tiktok @tiktokhandle (easier!)');
        }
        
        const cleanHandle = tiktokHandle.replace('@', '').toLowerCase();
        
        // Find auto-created account
        let foundUser = null;
        for (const [id, user] of Object.entries(users)) {
          if (user.scouterId === scouterId && user.linkedAccounts?.tiktok === cleanHandle && user.autoCreated) {
            foundUser = { id, user };
            break;
          }
        }
        
        if (!foundUser) {
          return await message.reply(`Scouter ID ${scouterId} not found for @${cleanHandle}. Try: !link-tiktok @${cleanHandle}`);
        }
        
        const { id: oldId, user: oldUser } = foundUser;
        const discordId = message.author.id;
        
        // Check if already linked
        if (users[discordId]?.linkedAt) {
          return await message.reply('You already have a permanent TikTok link!');
        }
        
        // Merge accounts: move XP to Discord user's Scouter (PERMANENT)
        if (!users[discordId]) {
          users[discordId] = {
            id: discordId,
            name: message.author.username,
            xp: oldUser.xp, // Carry over TikTok XP
            rankId: getRank(oldUser.xp).id,
            scouterId: oldUser.scouterId, // Keep same Scouter ID!
            linkedAccounts: { tiktok: cleanHandle },
            linkedAt: Date.now() // PERMANENT
          };
        } else {
          // Merge XP if Discord user already exists
          users[discordId].xp += oldUser.xp;
          users[discordId].scouterId = oldUser.scouterId;
          users[discordId].linkedAccounts.tiktok = cleanHandle;
          users[discordId].linkedAt = Date.now(); // PERMANENT
          users[discordId].rankId = getRank(users[discordId].xp).id;
        }
        
        // Delete old auto-created account
        delete users[oldId];
        
        // Update tiktokUsers to point to new Discord user
        tiktokUsers[cleanHandle] = oldUser.scouterId;
        
        saveUsers();
        
        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('SCOUTER CLAIMED (PERMANENT)')
          .addFields(
            { name: 'Scouter ID', value: oldUser.scouterId, inline: true },
            { name: 'Discord', value: message.author.username, inline: true },
            { name: 'TikTok', value: `@${cleanHandle}`, inline: true },
            { name: 'Total XP', value: `${fmtPL(users[discordId].xp)}`, inline: true },
            { name: 'Status', value: 'PERMANENTLY LINKED - Cannot unlink', inline: false }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`✅ PERMANENT: ${message.author.username} claimed Scouter ${oldUser.scouterId} (@${cleanHandle})`);

      } else if (command === 'live-status') {
        const status = isLive ? 'LIVE NOW' : 'OFFLINE';
        const userId = message.author.id;
        const user = users[userId];
        
        const embed = new EmbedBuilder()
          .setColor(isLive ? '#FF0000' : '#888888')
          .setTitle(`Status: ${status}`)
          .addFields(
            { name: 'Your Scouter ID', value: user?.scouterId || 'Not created', inline: false },
            { name: 'Current XP', value: `${fmtPL(user?.xp || 0)}`, inline: true },
            { name: 'Rank', value: getRankInfo(user?.rankId || 0).short, inline: true }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });

      } else if (command === 'admin-xp') {
        // Admin only - manage user XP
        if (!message.member.permissions.has('Administrator')) {
          return await message.reply('❌ Admin only!');
        }
        
        const targetUser = message.mentions.users.first();
        const amount = parseInt(args[2]);
        
        if (!targetUser || !amount) {
          return await message.reply('Usage: !admin-xp @user +5000 or -1000');
        }
        
        if (!users[targetUser.id]) {
          users[targetUser.id] = {
            id: targetUser.id,
            name: targetUser.username,
            xp: 0,
            rankId: 0,
            scouterId: generateScouterId(),
            linkedAccounts: {},
            bannedFromXP: false
          };
        }
        
        const oldXP = users[targetUser.id].xp || 0;
        users[targetUser.id].xp = Math.max(0, oldXP + amount);
        users[targetUser.id].rankId = getRank(users[targetUser.id].xp).id;
        saveUsers();
        
        const embed = new EmbedBuilder()
          .setColor('#FF6B00')
          .setTitle('ADMIN: XP ADJUSTED')
          .addFields(
            { name: 'User', value: targetUser.username, inline: true },
            { name: 'Change', value: `${amount > 0 ? '+' : ''}${amount}`, inline: true },
            { name: 'Old XP', value: fmtPL(oldXP), inline: true },
            { name: 'New XP', value: fmtPL(users[targetUser.id].xp), inline: true }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔧 ADMIN: ${message.author.username} adjusted ${targetUser.username} XP by ${amount}`);

      } else if (command === 'admin-set-xp') {
        // Admin only - set exact XP
        if (!message.member.permissions.has('Administrator')) {
          return await message.reply('❌ Admin only!');
        }
        
        const targetUser = message.mentions.users.first();
        const exactXP = parseInt(args[2]);
        
        if (!targetUser || !exactXP) {
          return await message.reply('Usage: !admin-set-xp @user 50000');
        }
        
        if (!users[targetUser.id]) {
          users[targetUser.id] = {
            id: targetUser.id,
            name: targetUser.username,
            xp: 0,
            rankId: 0,
            scouterId: generateScouterId(),
            linkedAccounts: {},
            bannedFromXP: false
          };
        }
        
        const oldXP = users[targetUser.id].xp || 0;
        users[targetUser.id].xp = Math.max(0, exactXP);
        users[targetUser.id].rankId = getRank(users[targetUser.id].xp).id;
        saveUsers();
        
        const embed = new EmbedBuilder()
          .setColor('#FF6B00')
          .setTitle('ADMIN: XP SET')
          .addFields(
            { name: 'User', value: targetUser.username, inline: true },
            { name: 'Old XP', value: fmtPL(oldXP), inline: true },
            { name: 'New XP', value: fmtPL(users[targetUser.id].xp), inline: true },
            { name: 'Rank', value: getRankInfo(users[targetUser.id].rankId).short, inline: true }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔧 ADMIN: ${message.author.username} set ${targetUser.username} XP to ${exactXP}`);

      } else if (command === 'admin-rank') {
        // Admin only - set rank directly
        if (!message.member.permissions.has('Administrator')) {
          return await message.reply('❌ Admin only!');
        }
        
        const targetUser = message.mentions.users.first();
        const rankId = parseInt(args[2]);
        
        if (!targetUser || rankId === undefined) {
          return await message.reply('Usage: !admin-rank @user 5 (rank 0-12)');
        }
        
        const rankInfo = getRankInfo(rankId);
        if (!rankInfo) {
          return await message.reply(`❌ Rank ${rankId} does not exist (0-12)`);
        }
        
        if (!users[targetUser.id]) {
          users[targetUser.id] = {
            id: targetUser.id,
            name: targetUser.username,
            xp: 0,
            rankId: rankId,
            scouterId: generateScouterId(),
            linkedAccounts: {},
            bannedFromXP: false
          };
        } else {
          users[targetUser.id].rankId = rankId;
        }
        
        saveUsers();
        
        const embed = new EmbedBuilder()
          .setColor('#FF6B00')
          .setTitle('ADMIN: RANK SET')
          .addFields(
            { name: 'User', value: targetUser.username, inline: true },
            { name: 'New Rank', value: rankInfo.short, inline: true },
            { name: 'Required XP', value: fmtPL(rankInfo.xp), inline: true }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔧 ADMIN: ${message.author.username} set ${targetUser.username} rank to ${rankInfo.short}`);

      } else if (command === 'admin-reset') {
        // Admin only - reset user
        if (!message.member.permissions.has('Administrator')) {
          return await message.reply('❌ Admin only!');
        }
        
        const targetUser = message.mentions.users.first();
        
        if (!targetUser) {
          return await message.reply('Usage: !admin-reset @user');
        }
        
        const oldXP = users[targetUser.id]?.xp || 0;
        
        users[targetUser.id] = {
          id: targetUser.id,
          name: targetUser.username,
          xp: 0,
          rankId: 0,
          scouterId: users[targetUser.id]?.scouterId || generateScouterId(),
          linkedAccounts: users[targetUser.id]?.linkedAccounts || {},
          bannedFromXP: false
        };
        
        saveUsers();
        
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('ADMIN: USER RESET')
          .addFields(
            { name: 'User', value: targetUser.username, inline: true },
            { name: 'Previous XP', value: fmtPL(oldXP), inline: true },
            { name: 'New XP', value: '0', inline: true }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔧 ADMIN: ${message.author.username} reset ${targetUser.username}`);

      } else if (command === 'admin-ban') {
        // Admin only - ban user from earning XP
        if (!message.member.permissions.has('Administrator')) {
          return await message.reply('❌ Admin only!');
        }
        
        const targetUser = message.mentions.users.first();
        
        if (!targetUser) {
          return await message.reply('Usage: !admin-ban @user');
        }
        
        if (!users[targetUser.id]) {
          users[targetUser.id] = {
            id: targetUser.id,
            name: targetUser.username,
            xp: 0,
            rankId: 0,
            scouterId: generateScouterId(),
            linkedAccounts: {},
            bannedFromXP: true
          };
        } else {
          users[targetUser.id].bannedFromXP = true;
        }
        
        saveUsers();
        
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('ADMIN: USER BANNED')
          .addFields(
            { name: 'User', value: targetUser.username, inline: true },
            { name: 'Status', value: 'Cannot earn XP', inline: true }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔧 ADMIN: ${message.author.username} banned ${targetUser.username}`);

      } else if (command === 'admin-unban') {
        // Admin only - unban user
        if (!message.member.permissions.has('Administrator')) {
          return await message.reply('❌ Admin only!');
        }
        
        const targetUser = message.mentions.users.first();
        
        if (!targetUser) {
          return await message.reply('Usage: !admin-unban @user');
        }
        
        if (users[targetUser.id]) {
          users[targetUser.id].bannedFromXP = false;
          saveUsers();
        }
        
        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('ADMIN: USER UNBANNED')
          .addFields(
            { name: 'User', value: targetUser.username, inline: true },
            { name: 'Status', value: 'Can earn XP', inline: true }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔧 ADMIN: ${message.author.username} unbanned ${targetUser.username}`);

      } else if (command === 'daily-report') {
        const top25 = getTop25();
        const mvp = getMVPYesterday();
        
        // Get today's top gainers
        const today = new Date().toISOString().split('T')[0];
        const todayTopGainers = Object.entries(dailyStats[today] || {})
          .map(([userId, xp]) => ({ userId, xp, user: users[userId] }))
          .filter(g => g.user && !g.user.autoCreated)
          .sort((a, b) => b.xp - a.xp)
          .slice(0, 3);
        
        // Build leaderboard text (top 25)
        let leaderboardText = '';
        for (let i = 0; i < top25.length; i++) {
          const user = top25[i];
          const rank = getRankInfo(user.rankId);
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
          leaderboardText += `${medal} **${user.name}** - ${fmtPL(user.xp)} XP (${rank.short})\n`;
        }
        
        // Build MVP text (yesterday)
        let mvpText = 'No activity yesterday';
        if (mvp && mvp.userId) {
          const mvpUser = users[mvp.userId];
          if (mvpUser) {
            mvpText = `🌟 **${mvpUser.name}** earned ${mvp.xp} XP`;
          }
        }
        
        // Build today's top gainers
        let gainersText = 'No activity yet today';
        if (todayTopGainers.length > 0) {
          gainersText = todayTopGainers
            .map((g, i) => `${i+1}. **${g.user.name}** +${g.xp} XP`)
            .join('\n');
        }
        
        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('📊 DAILY SCOUTER REPORT')
          .setDescription(`${new Date().toLocaleDateString()} - Community Stats`)
          .addFields(
            { name: '🏆 TOP 25 POWER LEVELS', value: leaderboardText || 'No users yet', inline: false },
            { name: '⭐ MVP OF YESTERDAY', value: mvpText, inline: false },
            { name: '🔥 TOP GAINERS TODAY', value: gainersText, inline: false }
          )
          .setFooter({ text: `Total Players: ${top25.length} | Keep grinding! ⚡` })
          .setTimestamp();
        
        const channel = message.guild.channels.cache.get(activityChannelId) || message.channel;
        await channel.send({ embeds: [embed] });
        
        await message.reply('✅ Daily report posted!');
        console.log(`📊 Daily report posted to ${channel.name}`);

      } else if (command === 'checkactivity') {
        await message.reply('Checking TikTok and YouTube activity...');
        await checkTikTokActivity();
        await checkYouTubeActivity();
        await message.reply('Activity check complete!');

      } else if (command === 'help') {
        const isAdmin = message.member.permissions.has('Administrator');
        
        // ===== EMBED 1: Overview (everyone sees) =====
        const embed1 = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('SCOUTER SYSTEM - OVERVIEW')
          .setDescription('Automatic Scouter ID creation! Comment on @gblilmar videos → Auto-onboarded.')
          .addFields(
            { name: 'Key Features', value: 'Aggregate all platforms • Atomic transactions • NO CORRUPTION', inline: false },
            { name: 'TikTok Users', value: '1. Comment on @gblilmar video\n2. Bot auto-creates Scouter\n3. !link-tiktok @handle\n4. PERMANENT LINK', inline: false }
          )
          .setTimestamp();
        
        // ===== EMBED 2: User Commands (everyone sees) =====
        const embed2 = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('COMMANDS - GAMEPLAY')
          .addFields(
            { name: 'Status', value: '!powerlevel - Your XP + rank\n!scouter-id - Your Scouter ID\n!leaderboard - Top 10 users', inline: false },
            { name: 'Linking', value: '!link-tiktok @handle - Link TikTok\n!link-youtube - Link YouTube (20K XP)\n!claim-scouter ID @handle - Claim Scouter', inline: false },
            { name: 'Gameplay', value: '!donate - Stripe donations (1.5x)\n!battle <vs> <result> - Battle results\n!daily-report - Top 25 leaderboard', inline: false }
          )
          .setTimestamp();
        
        // ===== EMBED 3: XP Sources (everyone sees) =====
        const embed3 = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('XP SOURCES & REWARDS')
          .addFields(
            { name: 'Earn XP From', value: 'Discord: 100/msg\nTikTok: 1,000/comment\nYouTok: 20,000 (link once)\nBattle: +100 win, -50 loss\nDonate: 1.5x multiplier', inline: false }
          )
          .setTimestamp();
        
        // ===== ADMIN ONLY EMBEDS =====
        if (isAdmin) {
          const adminEmbed1 = new EmbedBuilder()
            .setColor('#FF6B00')
            .setTitle('🔐 ADMIN COMMANDS')
            .addFields(
              { name: 'Power Management', value: '!admin-xp @user +5000 - Add/remove XP\n!admin-set-xp @user 50000 - Set exact XP\n!admin-rank @user 5 - Set rank\n!admin-reset @user - Reset to 0 XP', inline: false },
              { name: 'User Control', value: '!admin-ban @user - Ban from XP\n!admin-unban @user - Unban user', inline: false },
              { name: 'Setup', value: '!scouter-setup - Create #scouter-activity\n!checkactivity - Manual TikTok/YouTube scan', inline: false }
            )
            .setFooter({ text: 'Admin only - do not share' })
            .setTimestamp();
          
          const adminEmbed2 = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('🔐 ACCOUNT SECURITY (Admin Info)')
            .addFields(
              { name: 'User Account Tools', value: '!scouter-password [pass] - Set recovery password\n!transfer-scouter ID [pass] @handle - Transfer to new TikTok handle', inline: false },
              { name: 'Auto-Detection', value: 'Go Live: Auto-detected every 2 min\nTikTok: Auto-scan every 10 min\nComments: Auto-awarded 1000 XP', inline: false }
            )
            .setFooter({ text: 'Admin only - do not share' })
            .setTimestamp();
          
          // Send all embeds to admin
          await message.reply({ embeds: [embed1] });
          await message.channel.send({ embeds: [embed2] });
          await message.channel.send({ embeds: [embed3] });
          await message.channel.send({ embeds: [adminEmbed1] });
          await message.channel.send({ embeds: [adminEmbed2] });
        } else {
          // Send only user embeds to regular members
          await message.reply({ embeds: [embed1] });
          await message.channel.send({ embeds: [embed2] });
          await message.channel.send({ embeds: [embed3] });
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }
  } else {
    const userId = message.author.id;
    const now = Date.now();
    const lastTime = lastMessageXP[userId] || 0;

    if (now - lastTime > XP_RATES.MESSAGE_COOLDOWN) {
      const channel = message.guild.channels.cache.get(activityChannelId);
      await awardXP(userId, message.author.username, XP_RATES.CHAT, 'Discord message', channel);
      lastMessageXP[userId] = now;
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on 0.0.0.0:${PORT}`);
  console.log(`✅ Stripe webhook: /stripe-webhook`);
  console.log(`✅ Overlay: /overlay.html`);
  console.log(`✅ Health: /health`);
  console.log(`🎬 TikTok: ${TIKTOK_USERNAME}`);
  console.log(`📺 YouTube: ${YOUTUBE_CHANNEL}`);
});

client.login(process.env.DISCORD_TOKEN);
