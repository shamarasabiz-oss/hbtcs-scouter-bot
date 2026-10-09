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
// Use persistent volume on Railway, or local directory in development
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const RANKINGS_FILE = path.join(DATA_DIR, 'rankings-save.json');
const TRACKING_CACHE = path.join(DATA_DIR, 'tracking-cache.json');

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
  TRIVIA: 500,
  STRIPE_MULTIPLIER: 1.5,
  MESSAGE_COOLDOWN: 30000
};

// ── TRIVIA SYSTEM ──────────────────────────────────────────────────────────
// ── GIFT XP CALCULATION ────────────────────────────────────────────────────────
// Tiered XP based on gift/diamond count - rewards bigger gifts with bonus rate
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

const TRIVIA_QUESTIONS = [
  { question: "What is the power level of Frieza's final form in the Saiyan Saga?", answers: ["1,200,000", "530,000", "900,000"], correct: 0, difficulty: "INSANE" },
  { question: "How many minutes does the Hyperbolic Time Chamber equal one day outside?", answers: ["1", "2", "3"], correct: 1, difficulty: "INSANE" },
  { question: "What is the exact transformation requirement for Ultra Instinct -Sign-?", answers: ["limitless speed without thought", "god ki release", "saiyan blue perfection"], correct: 0, difficulty: "INSANE" },
  { question: "In the Tournament of Power, how many Universes are erased?", answers: ["8", "4", "6"], correct: 0, difficulty: "INSANE" },
  { question: "What is Jiren's exact power level at his peak?", answers: ["unquantifiable", "40 quadrillion", "15 billion"], correct: 0, difficulty: "INSANE" },
  { question: "How many times did Goku achieve SSJ Blue Kaioken and survive?", answers: ["twice", "once", "three times"], correct: 1, difficulty: "INSANE" },
  { question: "What is the combined power of all 5 Universe 6 fighters at their peak?", answers: ["immeasurable", "50 sextillion", "10 quintillion"], correct: 0, difficulty: "INSANE" },
  { question: "Who scored exactly 37 points in the Tournament of Power?", answers: ["goku", "vegeta", "jiren"], correct: 0, difficulty: "INSANE" },
  { question: "What is the theoretical power cap for a mortal with perfect god ki control?", answers: ["undefined", "100 trillion", "no limit"], correct: 2, difficulty: "INSANE" },
  { question: "How many minutes did Goku last in MUI before first form-break?", answers: ["4", "6", "9"], correct: 2, difficulty: "INSANE" },
  { question: "What specific Saiyan bloodline factor allows SSBE transformation?", answers: ["vegeta's royal adaptation", "god consciousness merge", "ultra ego awakening"], correct: 1, difficulty: "INSANE" },
  { question: "In the TOP, what was Kale's exact transformation sequence?", answers: ["ss2 to berserker to fused", "legendary ss to berserker", "ss3 to fusion only"], correct: 0, difficulty: "INSANE" },
  { question: "How many Divine ki signatures exist across all 12 Universes?", answers: ["144", "impossible to quantify", "12"], correct: 1, difficulty: "INSANE" },
  { question: "What is the power differential between MUI Goku and final Jiren?", answers: ["virtually identical", "jiren +30%", "goku +15%"], correct: 0, difficulty: "INSANE" },
  { question: "How many Hakai energy signatures has Goku fully absorbed?", answers: ["zero", "one partial", "three complete"], correct: 1, difficulty: "INSANE" },
];

let triviaState = {
  active: false,
  currentQuestion: null,
  correctAnswer: null,
  winner: null,
  messageId: null,
  guildId: null,
  answered: new Set(),
  cooldown: 0
};

function startTrivia() {
  if (triviaState.active) return false;
  
  triviaState.active = true;
  triviaState.currentQuestion = TRIVIA_QUESTIONS[Math.floor(Math.random() * TRIVIA_QUESTIONS.length)];
  triviaState.correctAnswer = null;
  triviaState.winner = null;
  triviaState.answered.clear();
  triviaState.cooldown = Date.now() + 300000; // 5 minute cooldown
  
  return triviaState.currentQuestion;
}

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

// Function to get rank ID from XP
function getRankId(xp) {
  let rankId = 0;
  for (const rank of RANKS) {
    if (xp >= rank.xp) rankId = rank.id;
  }
  return rankId;
}

// Verify YouTube subscription
async function verifyYouTubeSubscription(youtubeUsername) {
  try {
    if (!YOUTUBE_API_KEY) return false;
    
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        forUsername: youtubeUsername,
        type: 'channel',
        key: YOUTUBE_API_KEY
      }
    });
    
    if (!response.data.items || response.data.items.length === 0) {
      return false;
    }
    
    const channelId = response.data.items[0].id.channelId;
    
    // Check if they're subscribed to hbtcdbz channel
    const subResponse = await axios.get('https://www.googleapis.com/youtube/v3/subscriptions', {
      params: {
        part: 'snippet',
        forChannelId: YOUTUBE_CHANNEL,
        mine: false,
        key: YOUTUBE_API_KEY
      }
    });
    
    if (subResponse.data.items) {
      return subResponse.data.items.some(sub => sub.snippet.resourceId.channelId === channelId);
    }
    
    return false;
  } catch (error) {
    console.error('YouTube verification error:', error.message);
    return false;
  }
}

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
  
  // Send initial leaderboard to new client (includes unclaimed TikTok Scouers!)
  const topUsers = Object.values(users)
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
const TIKTOK_API_KEY = process.env.TIKTOK_API_KEY;

async function initTikTokLive() {
  try {
    if (!TIKTOK_API_KEY) {
      console.warn('⚠️  TIKTOK_API_KEY not set. Get free key at https://tik.tools');
      setTimeout(initTikTokLive, 30000); // Retry in 30 seconds
      return;
    }
    
    console.log(`🔌 Attempting TikTok Live connection to @${TIKTOK_USERNAME}...`);
    tiktok = new TikTokLive({ uniqueId: TIKTOK_USERNAME, apiKey: TIKTOK_API_KEY });
    
    tiktok.on('join', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      
      console.log(`➕ TikTok @${userName} JOINED THE LIVE!`);
      
      // CHECK: Is this TikTok user already linked to a Discord account?
      const linkedDiscordId = findLinkedDiscordUser(userName);
      
      // If linked to Discord, just announce them as linked
      if (linkedDiscordId && users[linkedDiscordId]) {
        console.log(`✅ Linked user joined: ${users[linkedDiscordId].name} (@${userName})`);
        
        // Post to Discord if desired
        if (activityChannelId) {
          client.channels.fetch(activityChannelId).then(channel => {
            channel.send({
              embeds: [{
                color: '#00FF50',
                title: '✅ LINKED VIEWER JOINED',
                description: `${users[linkedDiscordId].name} joined the stream!`,
                fields: [
                  { name: 'TikTok', value: `@${userName}`, inline: true },
                  { name: 'Power Level', value: `${users[linkedDiscordId].xp} XP`, inline: true }
                ]
              }]
            }).catch(() => {});
          }).catch(() => {});
        }
        return;
      }
      
      // Otherwise, create auto-created TikTok user if doesn't exist
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
        tiktokUsers[userName.toLowerCase()] = scouterId;
        saveUsers();
      }
      
      // Post to Discord #scouter-activity
      if (activityChannelId) {
        client.channels.fetch(activityChannelId).then(channel => {
          channel.send({
            embeds: [{
              color: '#00FF50',
              title: '✅ NEW VIEWER',
              description: `@${userName} joined the stream!`,
              fields: [
                { name: 'Scouter ID', value: users[`tiktok_${userId}`].scouterId, inline: true }
              ],
              timestamp: new Date()
            }]
          }).catch(() => {});
        }).catch(() => {});
      }
      
      broadcastActivity('join', userName, `tiktok_${userId}`, 0, null);
      broadcastLeaderboard();
    });
    
    tiktok.on('chat', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      const comment = data.comment || '';
      
      console.log(`💬 TikTok @${userName}: ${comment} → +1000 XP`);
      
      // CHECK FOR VERIFICATION CODE: scouter:CODE
      const codeMatch = comment.match(/scouter:([A-Z0-9]{6})/i);
      if (codeMatch) {
        const code = codeMatch[1].toUpperCase();
        const verification = verifyLinkingCode(code, userName);
        
        if (verification.success) {
          const discordId = verification.discordId;
          const tiktokHandle = verification.tiktokHandle;
          
          // Mark code as verified
          linkingCodes[code].verified = true;
          
          // Find or create TikTok user data
          let tiktokXP = 0;
          let tiktokScouterId = null;
          
          // Look for auto-created TikTok user with this XP
          for (const [id, user] of Object.entries(users)) {
            if (user.autoCreated && user.linkedAccounts?.tiktok?.toLowerCase() === tiktokHandle) {
              tiktokXP = user.xp || 0;
              tiktokScouterId = user.scouterId;
              delete users[id]; // Remove old auto-created user
              break;
            }
          }
          
          // Permanently link Discord account to TikTok
          users[discordId].scouterId = tiktokScouterId || users[discordId].scouterId;
          users[discordId].xp = (users[discordId].xp || 0) + tiktokXP; // Merge XP
          users[discordId].linkedAccounts.tiktok = tiktokHandle;
          users[discordId].linkedAt = Date.now();
          users[discordId].rankId = getRank(users[discordId].xp).id;
          saveUsers();
          
          // Announce success
          console.log(`✅ VERIFIED LINK: ${users[discordId].name} (@${tiktokHandle}) - XP merged: +${tiktokXP}`);
          
          // Broadcast to Discord
          if (activityChannelId) {
            client.channels.fetch(activityChannelId).then(channel => {
              channel.send({
                embeds: [{
                  color: '#00FF50',
                  title: '✅ TIKTOK LINKED & VERIFIED',
                  description: `Account linking successful!`,
                  fields: [
                    { name: 'Discord', value: users[discordId].name, inline: true },
                    { name: 'TikTok', value: `@${tiktokHandle}`, inline: true },
                    { name: 'XP Merged', value: `+${tiktokXP}`, inline: true }
                  ]
                }]
              }).catch(() => {});
            }).catch(() => {});
          }
          
          // Broadcast to overlay
          broadcastActivity('link', users[discordId].name, discordId, tiktokXP, null);
          broadcastLeaderboard();
          
          return; // Exit after verification
        } else {
          console.warn(`❌ Invalid code attempt: ${verification.error}`);
          return; // Don't process as regular chat XP
        }
      }
      
      // CHECK: Is this TikTok user already explicitly linked to Discord?
      const linkedDiscordId = findLinkedDiscordUser(userName);
      
      // If linked to Discord, award XP there instead
      if (linkedDiscordId && users[linkedDiscordId]) {
        const xpAmount = 100;
        users[linkedDiscordId].xp = (users[linkedDiscordId].xp || 0) + xpAmount;
        const oldRank = users[linkedDiscordId].rankId;
        users[linkedDiscordId].rankId = getRank(users[linkedDiscordId].xp).id;
        saveUsers();
        
        console.log(`✅ XP to linked Discord: ${users[linkedDiscordId].name} +${xpAmount} (now ${users[linkedDiscordId].xp})`);
        
        // Broadcast to overlay
        broadcastActivity('chat', users[linkedDiscordId].name, linkedDiscordId, xpAmount, null);
        if (users[linkedDiscordId].rankId > oldRank) {
          broadcastActivity('rankup', users[linkedDiscordId].name, linkedDiscordId, users[linkedDiscordId].xp, users[linkedDiscordId].rankId);
          // Check if they reached SSB and need to choose path
          checkPathChoice(linkedDiscordId, users[linkedDiscordId].rankId);
        }
        broadcastLeaderboard();
        return; // Don't create TikTok user
      }
      
      // Otherwise, create/update auto-created TikTok user
      let isNewUser = false;
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
        // ADD TO TIKTOK MAPPING (so !link-tiktok can find them!)
        tiktokUsers[userName.toLowerCase()] = scouterId;
        isNewUser = true;
      }
      
      const oldRank = users[`tiktok_${userId}`].rankId;
      users[`tiktok_${userId}`].xp += XP_RATES.CHAT;
      const newRank = getRankId(users[`tiktok_${userId}`].xp);
      users[`tiktok_${userId}`].rankId = newRank;
      const rankChanged = oldRank !== newRank;
      
      // Post to Discord if rank up or new user
      if (rankChanged || isNewUser) {
        if (activityChannelId) {
          client.channels.fetch(activityChannelId).then(channel => {
            const rankName = RANKS[newRank]?.name || 'Unknown';
            channel.send({
              embeds: [{
                color: rankChanged ? '#FFD700' : '#00FF50',
                title: rankChanged ? '🎉 RANK UP!' : '🆕 NEW SCOUTER',
                description: `@${userName} ${rankChanged ? `reached ${rankName}` : 'joined Scouter system'}!`,
                fields: [
                  { name: 'Power Level', value: users[`tiktok_${userId}`].xp.toString(), inline: true },
                  { name: 'Rank', value: rankName, inline: true },
                  { name: 'Scouter ID', value: users[`tiktok_${userId}`].scouterId, inline: true }
                ],
                timestamp: new Date()
              }]
            }).catch(() => {});
          }).catch(() => {});
        }
      }
      
      broadcastActivity('chat', userName, `tiktok_${userId}`, XP_RATES.CHAT, null);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('like', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      const likeCount = data.likeCount || 1;
      const xpAmount = 5 * likeCount;
      
      console.log(`❤️ TikTok @${userName}: +${likeCount} likes → +${xpAmount} XP`);
      
      // CHECK: Is this TikTok user already explicitly linked to Discord?
      const linkedDiscordId = findLinkedDiscordUser(userName);
      
      // If linked to Discord, award XP there instead
      if (linkedDiscordId && users[linkedDiscordId]) {
        users[linkedDiscordId].xp = (users[linkedDiscordId].xp || 0) + xpAmount;
        const oldRank = users[linkedDiscordId].rankId;
        users[linkedDiscordId].rankId = getRank(users[linkedDiscordId].xp).id;
        saveUsers();
        
        broadcastActivity('like', users[linkedDiscordId].name, linkedDiscordId, xpAmount, likeCount);
        if (users[linkedDiscordId].rankId > oldRank) {
          broadcastActivity('rankup', users[linkedDiscordId].name, linkedDiscordId, users[linkedDiscordId].xp, users[linkedDiscordId].rankId);
        }
        broadcastLeaderboard();
        return;
      }
      
      // Otherwise, create/update auto-created TikTok user
      let isNewUser = false;
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
        tiktokUsers[userName.toLowerCase()] = scouterId;
        isNewUser = true;
      }
      
      const oldRank = users[`tiktok_${userId}`].rankId;
      const xpGained = likeCount * 5; // 5 XP per like
      users[`tiktok_${userId}`].xp += xpGained;
      const newRank = getRankId(users[`tiktok_${userId}`].xp);
      users[`tiktok_${userId}`].rankId = newRank;
      const rankChanged = oldRank !== newRank;
      
      if (rankChanged || isNewUser) {
        if (activityChannelId) {
          client.channels.fetch(activityChannelId).then(channel => {
            const rankName = RANKS[newRank]?.name || 'Unknown';
            channel.send({
              embeds: [{
                color: rankChanged ? '#FFD700' : '#00FF50',
                title: rankChanged ? '🎉 RANK UP!' : '🆕 NEW SCOUTER',
                description: `@${userName} ${rankChanged ? `reached ${rankName}` : 'joined Scouter system'}!`,
                fields: [
                  { name: 'Power Level', value: users[`tiktok_${userId}`].xp.toString(), inline: true },
                  { name: 'Rank', value: rankName, inline: true },
                  { name: 'Scouter ID', value: users[`tiktok_${userId}`].scouterId, inline: true }
                ],
                timestamp: new Date()
              }]
            }).catch(() => {});
          }).catch(() => {});
        }
      }
      
      broadcastActivity('like', userName, `tiktok_${userId}`, xpGained, likeCount);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('follow', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      
      console.log(`➕ TikTok @${userName}: FOLLOWED! → +500 XP`);
      
      // CHECK: Is this TikTok user already explicitly linked to Discord?
      const linkedDiscordId = findLinkedDiscordUser(userName);
      
      // If linked to Discord, award XP there instead
      if (linkedDiscordId && users[linkedDiscordId]) {
        const xpAmount = 500;
        users[linkedDiscordId].xp = (users[linkedDiscordId].xp || 0) + xpAmount;
        const oldRank = users[linkedDiscordId].rankId;
        users[linkedDiscordId].rankId = getRank(users[linkedDiscordId].xp).id;
        saveUsers();
        
        broadcastActivity('follow', users[linkedDiscordId].name, linkedDiscordId, xpAmount, null);
        if (users[linkedDiscordId].rankId > oldRank) {
          broadcastActivity('rankup', users[linkedDiscordId].name, linkedDiscordId, users[linkedDiscordId].xp, users[linkedDiscordId].rankId);
        }
        broadcastLeaderboard();
        return;
      }
      
      // Otherwise, create/update auto-created TikTok user
      let isNewUser = false;
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
        tiktokUsers[userName.toLowerCase()] = scouterId;
        isNewUser = true;
      }
      
      const oldRank = users[`tiktok_${userId}`].rankId;
      users[`tiktok_${userId}`].xp += 500; // 500 XP for follow
      const newRank = getRankId(users[`tiktok_${userId}`].xp);
      users[`tiktok_${userId}`].rankId = newRank;
      const rankChanged = oldRank !== newRank;
      
      if (rankChanged || isNewUser) {
        if (activityChannelId) {
          client.channels.fetch(activityChannelId).then(channel => {
            const rankName = RANKS[newRank]?.name || 'Unknown';
            channel.send({
              embeds: [{
                color: rankChanged ? '#FFD700' : '#00FF50',
                title: rankChanged ? '🎉 RANK UP!' : '🆕 NEW SCOUTER',
                description: `@${userName} ${rankChanged ? `reached ${rankName}` : 'joined Scouter system'}!`,
                fields: [
                  { name: 'Power Level', value: users[`tiktok_${userId}`].xp.toString(), inline: true },
                  { name: 'Rank', value: rankName, inline: true },
                  { name: 'Scouter ID', value: users[`tiktok_${userId}`].scouterId, inline: true }
                ],
                timestamp: new Date()
              }]
            }).catch(() => {});
          }).catch(() => {});
        }
      }
      
      broadcastActivity('follow', userName, `tiktok_${userId}`, 500, null);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('gift', (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      const giftCount = data.giftCount || data.repeatCount || 1;
      
      // Use tiered XP calculation: bigger gifts = bonus multiplier
      const xpAmount = calcGiftXP(giftCount, 1);
      console.log(`🎁 TikTok @${userName}: Sent ${giftCount} gift(s) → +${xpAmount} XP`);
      
      // CHECK: Is this TikTok user already explicitly linked to Discord?
      const linkedDiscordId = findLinkedDiscordUser(userName);
      
      // If linked to Discord, award XP there instead
      if (linkedDiscordId && users[linkedDiscordId]) {
        users[linkedDiscordId].xp = (users[linkedDiscordId].xp || 0) + xpAmount;
        const oldRank = users[linkedDiscordId].rankId;
        users[linkedDiscordId].rankId = getRank(users[linkedDiscordId].xp).id;
        saveUsers();
        
        broadcastActivity('gift', users[linkedDiscordId].name, linkedDiscordId, xpAmount, giftCount);
        if (users[linkedDiscordId].rankId > oldRank) {
          broadcastActivity('rankup', users[linkedDiscordId].name, linkedDiscordId, users[linkedDiscordId].xp, users[linkedDiscordId].rankId);
        }
        broadcastLeaderboard();
        return;
      }
      
      // Otherwise, create/update auto-created TikTok user
      let isNewUser = false;
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
        tiktokUsers[userName.toLowerCase()] = scouterId;
        isNewUser = true;
      }
      
      const oldRank = users[`tiktok_${userId}`].rankId;
      users[`tiktok_${userId}`].xp += xpAmount;
      const newRank = getRankId(users[`tiktok_${userId}`].xp);
      users[`tiktok_${userId}`].rankId = newRank;
      const rankChanged = oldRank !== newRank;
      
      if (rankChanged || isNewUser) {
        if (activityChannelId) {
          client.channels.fetch(activityChannelId).then(channel => {
            const rankName = RANKS[newRank]?.name || 'Unknown';
            channel.send({
              embeds: [{
                color: rankChanged ? '#FFD700' : '#00FF50',
                title: rankChanged ? '🎉 RANK UP!' : '🆕 NEW SCOUTER',
                description: `@${userName} ${rankChanged ? `reached ${rankName}` : 'joined Scouter system'}!`,
                fields: [
                  { name: 'Power Level', value: users[`tiktok_${userId}`].xp.toString(), inline: true },
                  { name: 'Rank', value: rankName, inline: true },
                  { name: 'Scouter ID', value: users[`tiktok_${userId}`].scouterId, inline: true }
                ],
                timestamp: new Date()
              }]
            }).catch(() => {});
          }).catch(() => {});
        }
      }
      
      broadcastActivity('gift', userName, `tiktok_${userId}`, xpAmount, giftCount);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('subscribe', async (data) => {
      const userId = data.uniqueId || data.user?.uniqueId;
      const userName = data.nickname || data.user?.nickname || 'Unknown';
      
      console.log(`📺 TikTok @${userName}: Subscribe event triggered`);
      
      // Verify YouTube subscription before awarding XP
      const isSubscribed = await verifyYouTubeSubscription(userName);
      
      if (!isSubscribed) {
        console.log(`❌ @${userName}: Not verified as YouTube subscriber`);
        return;
      }
      
      console.log(`✅ @${userName}: YouTube subscription verified!`);
      
      // CHECK: Is this TikTok user already linked to a Discord account?
      const linkedDiscordId = findLinkedDiscordUser(userName);
      
      // If linked to Discord, award XP there instead
      if (linkedDiscordId && users[linkedDiscordId]) {
        const xpAmount = 20000;
        users[linkedDiscordId].xp = (users[linkedDiscordId].xp || 0) + xpAmount;
        const oldRank = users[linkedDiscordId].rankId;
        users[linkedDiscordId].rankId = getRank(users[linkedDiscordId].xp).id;
        users[linkedDiscordId].linkedAccounts = users[linkedDiscordId].linkedAccounts || {};
        users[linkedDiscordId].linkedAccounts.youtube = true;
        saveUsers();
        
        broadcastActivity('youtube-verify', users[linkedDiscordId].name, linkedDiscordId, xpAmount, null);
        if (users[linkedDiscordId].rankId > oldRank) {
          broadcastActivity('rankup', users[linkedDiscordId].name, linkedDiscordId, users[linkedDiscordId].xp, users[linkedDiscordId].rankId);
        }
        broadcastLeaderboard();
        return;
      }
      
      // Otherwise, create/update auto-created TikTok user
      let isNewUser = false;
      if (!users[`tiktok_${userId}`]) {
        const scouterId = generateScouterId();
        users[`tiktok_${userId}`] = {
          id: `tiktok_${userId}`,
          name: `@${userName}`,
          xp: 0,
          rankId: 0,
          scouterId: scouterId,
          linkedAccounts: { tiktok: userName, youtube: true },
          autoCreated: true,
          bannedFromXP: false
        };
        tiktokUsers[userName.toLowerCase()] = scouterId;
        isNewUser = true;
      } else {
        users[`tiktok_${userId}`].linkedAccounts = users[`tiktok_${userId}`].linkedAccounts || {};
        users[`tiktok_${userId}`].linkedAccounts.youtube = true;
      }
      
      const oldRank = users[`tiktok_${userId}`].rankId;
      users[`tiktok_${userId}`].xp += 20000; // YouTube subscription bonus
      const newRank = getRankId(users[`tiktok_${userId}`].xp);
      users[`tiktok_${userId}`].rankId = newRank;
      const rankChanged = oldRank !== newRank;
      
      // Post to Discord
      if (activityChannelId) {
        client.channels.fetch(activityChannelId).then(channel => {
          const rankName = RANKS[newRank]?.name || 'Unknown';
          channel.send({
            embeds: [{
              color: '#FF0000',
              title: '📺 YOUTUBE SUBSCRIBER',
              description: `@${userName} subscribed to the YouTube channel!`,
              fields: [
                { name: 'Bonus XP', value: '20,000 XP', inline: true },
                { name: 'Power Level', value: users[`tiktok_${userId}`].xp.toString(), inline: true },
                { name: 'Rank', value: rankName, inline: true },
                { name: 'Scouter ID', value: users[`tiktok_${userId}`].scouterId, inline: true }
              ],
              timestamp: new Date()
            }]
          }).catch(() => {});
        }).catch(() => {});
      }
      
      broadcastActivity('subscribe', userName, `tiktok_${userId}`, 20000, null);
      broadcastLeaderboard();
      saveUsers();
    });
    
    tiktok.on('disconnect', () => {
      console.log('🔌 TikTok Live disconnected');
      tiktokConnected = false;
      console.log('🔄 Will attempt to reconnect in 5 seconds...');
      setTimeout(initTikTokLive, 5000);
    });
    
    tiktok.on('error', (error) => {
      console.error('❌ TikTok Live stream error:', error.message);
      tiktokConnected = false;
    });
    
    await tiktok.connect();
    tiktokConnected = true;
    console.log(`✅ TikTok Live CONNECTED: @${TIKTOK_USERNAME} - ready for comments/likes/follows/gifts`);
  } catch (error) {
    console.error('❌ TikTok Live connection FAILED:', error.message);
    console.error('   Error details:', error.toString());
    tiktokConnected = false;
    // Retry in 10 seconds
    console.log('🔄 Retrying TikTok connection in 10 seconds...');
    setTimeout(initTikTokLive, 10000);
  }
}

let users = {};
let tiktokUsers = {}; // Map TikTok handles to Scouter IDs (auto-created users)
let linkedAccounts = {}; // Store linked accounts
let activityChannelId = null;
let lastMessageXP = {}; // Track last message time per user (30s cooldown)
let trackingCache = { tiktok: {}, youtube: {} };
let dailyStats = {}; // Track daily XP gains {date: {userId: xpGained}}
let xpQueue = []; // XP transaction queue
let processedXPSources = new Set(); // Prevent duplicates (hash of source)
let dailyXPCaps = {}; // Track daily XP per user {date: {userId: totalXP}}
let linkingCodes = {}; // Pending link verifications {code: {discordId, tiktokHandle, expiresAt}}
const MAX_DAILY_XP = 50000; // Max XP per user per day
const MESSAGE_XP_COOLDOWN = 30000; // 30 seconds between message XP
const LINKING_CODE_DURATION = 600000; // 10 minutes to verify link code
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
        pathChoice: null, // For SSB path selection
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
    
    // Check if they just reached SSB and need path choice
    if (rankChanged && newRank.id === 7) {
      checkPathChoice(userId, newRank.id);
    }
    
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
    
    // Track daily XP for MVP calculation and cap enforcement
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    if (!dailyStats[today]) dailyStats[today] = {};
    dailyStats[today][userId] = (dailyStats[today][userId] || 0) + xpAmount;
    
    // Track daily XP cap
    if (!dailyXPCaps[today]) dailyXPCaps[today] = {};
    dailyXPCaps[today][userId] = (dailyXPCaps[today][userId] || 0) + xpAmount;
    
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
console.log('🎬 TikTok API Key:', TIKTOK_API_KEY ? '✅ LOADED' : '❌ NOT SET - TikTok live will not work!');
console.log('🎬 TikTok User:', TIKTOK_USERNAME);
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

// Find if a TikTok handle is linked to a Discord account
function findLinkedDiscordUser(tiktokHandle) {
  const cleanHandle = tiktokHandle.toLowerCase();
  for (const [discordId, user] of Object.entries(users)) {
    if (user.linkedAccounts?.tiktok?.toLowerCase() === cleanHandle && user.linkedAt) {
      return discordId;
    }
  }
  return null;
}

// Check if user just reached SSB and needs path choice
function checkPathChoice(userId, newRankId) {
  if (newRankId === 7 && !users[userId]?.pathChoice) {
    // Just reached SSB - need to choose path
    const user = users[userId];
    if (user && client) {
      client.users.fetch(userId).then(userObj => {
        userObj.send({
          embeds: [{
            color: '#335BFF',
            title: '⚡ CHOOSE YOUR PATH ⚡',
            description: 'You\'ve reached Super Saiyan Blue! Select your evolution:',
            fields: [
              { name: '💠 Super Saiyan Blue Evolved', value: 'Run: `!ssbe`\nContinue the Blue evolution', inline: true },
              { name: '🌀 Ultra Instinct Sign', value: 'Run: `!uisign`\nMaster the instinct', inline: true }
            ]
          }]
        }).catch(() => {});
      }).catch(() => {});
    }
  }
}

// Validate XP award - prevent exploits
function validateXPAward(userId, xpAmount, source) {
  // Check daily XP cap
  const today = new Date().toISOString().split('T')[0];
  if (!dailyXPCaps[today]) dailyXPCaps[today] = {};
  
  const userDailyXP = dailyXPCaps[today][userId] || 0;
  if (userDailyXP + xpAmount > MAX_DAILY_XP) {
    console.warn(`⚠️ ${userId} would exceed daily XP cap (${userDailyXP + xpAmount} > ${MAX_DAILY_XP})`);
    return false;
  }
  
  // Check for duplicate transactions (same source within 5 seconds)
  const sourceKey = `${userId}-${source}`;
  if (processedXPSources.has(sourceKey)) {
    console.warn(`⚠️ Duplicate XP source detected: ${sourceKey}`);
    return false;
  }
  
  // Mark this source as processed
  processedXPSources.add(sourceKey);
  setTimeout(() => processedXPSources.delete(sourceKey), 5000);
  
  return true;
}

// Check message XP cooldown (prevent spam)
function canAwardMessageXP(userId) {
  const now = Date.now();
  const lastXPTime = lastMessageXP[userId] || 0;
  
  if (now - lastXPTime < MESSAGE_XP_COOLDOWN) {
    return false; // Cooldown still active
  }
  
  lastMessageXP[userId] = now;
  return true;
}

// Generate a unique linking code
function generateLinkingCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Create a linking code for verification
function createLinkingCode(discordId, tiktokHandle) {
  const code = generateLinkingCode();
  linkingCodes[code] = {
    discordId,
    tiktokHandle: tiktokHandle.toLowerCase(),
    expiresAt: Date.now() + LINKING_CODE_DURATION,
    verified: false
  };
  
  // Auto-delete expired codes
  setTimeout(() => {
    if (linkingCodes[code] && !linkingCodes[code].verified) {
      delete linkingCodes[code];
    }
  }, LINKING_CODE_DURATION);
  
  return code;
}

// Verify a linking code from TikTok
function verifyLinkingCode(code, tiktokHandle) {
  const linkData = linkingCodes[code];
  
  if (!linkData) {
    return { success: false, error: 'Code not found' };
  }
  
  if (Date.now() > linkData.expiresAt) {
    delete linkingCodes[code];
    return { success: false, error: 'Code expired (10 min timeout)' };
  }
  
  if (linkData.tiktokHandle !== tiktokHandle.toLowerCase()) {
    return { success: false, error: 'Code was for different TikTok handle' };
  }
  
  if (linkData.verified) {
    return { success: false, error: 'Code already used' };
  }
  
  return { success: true, discordId: linkData.discordId, tiktokHandle };
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
  // Validate XP award before processing
  const sourceId = `${reason}-${userId}-${Date.now()}`;
  if (!validateXPAward(userId, xpAmount, sourceId)) {
    console.warn(`⚠️ XP award rejected for ${username}: ${reason}`);
    return;
  }
  
  // Atomic XP transaction with anti-exploit + no data corruption
  const uniqueSourceId = `${Date.now()}-${Math.random()}`;
  await queueXPTransaction(userId, username, xpAmount, reason, uniqueSourceId, channel);
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

// Overlay endpoint - load HTML file and serve it
let overlayHTML = '';
try {
  overlayHTML = fs.readFileSync(path.join(__dirname, 'overlay.html'), 'utf8');
} catch (e) {
  console.warn('⚠️ overlay.html not found, using fallback');
  overlayHTML = `<!DOCTYPE html><html><head><title>Scouter Overlay</title></head><body style="background:transparent;color:#00ff50;text-align:center;padding-top:50vh">
    <h1>Connecting to Scouter...</h1>
    <p>WebSocket connecting...</p>
    <script>
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
      ws.onopen = () => document.body.innerHTML = '<h1>Connected!</h1>';
      ws.onerror = () => document.body.innerHTML = '<h1>Connection Error</h1>';
    </script>
  </body></html>`;
}

app.get('/overlay.html', (req, res) => {
  res.send(overlayHTML);
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

  // TRIVIA ANSWER CHECK
  if (triviaState.active && !message.content.startsWith('!')) {
    const answer = message.content.toLowerCase().trim();
    if (['a', 'b', 'c'].includes(answer)) {
      const userId = message.author.id;
      
      // Prevent same user answering twice
      if (triviaState.answered.has(userId)) {
        return await message.react('❌');
      }

      triviaState.answered.add(userId);
      const correctIndex = triviaState.currentQuestion.correct;
      const answerIndex = answer.charCodeAt(0) - 97; // a=0, b=1, c=2

      if (answerIndex === correctIndex) {
        triviaState.active = false;
        triviaState.winner = userId;

        const user = users[userId] || { id: userId, name: message.author.username, xp: 0, rankId: 0 };
        user.xp = (user.xp || 0) + XP_RATES.TRIVIA;
        user.rankId = getRank(user.xp).id;
        users[userId] = user;
        saveUsers();

        const answers = ['A', 'B', 'C'];
        await message.react('✅');
        await message.channel.send(`🎉 <@${userId}> got it right! **${answers[correctIndex]}** - **${triviaState.currentQuestion.answers[correctIndex]}**\n⭐ +${XP_RATES.TRIVIA} XP`);
      } else {
        // Just react with ❌, don't reveal answer
        await message.react('❌');
      }
      return; // Don't continue to chat XP for trivia answers
    }
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

      } else if (command === 'request-link') {
        // Secure TikTok linking via verification code
        const userId = message.author.id;
        const tiktokHandle = args[1];
        
        if (!tiktokHandle) {
          return await message.reply('Usage: `!request-link @yourtiktokhandle`\n\n**How it works:**\n1. Run this command with your TikTok handle\n2. Get a verification code (valid 10 min)\n3. Comment the code on the stream: `scouter:CODE`\n4. Bot verifies and links your accounts\n\n**Why?** Prevents typos and account mix-ups!');
        }
        
        const cleanHandle = tiktokHandle.replace('@', '').toLowerCase();
        
        // Create/get Discord user account
        if (!users[userId]) {
          users[userId] = { 
            id: userId, 
            name: message.author.username, 
            xp: 0, 
            rankId: 0, 
            scouterId: generateScouterId(),
            linkedAccounts: {},
            pathChoice: null,
            linkedAt: null
          };
        }
        
        // Check if already linked
        if (users[userId].linkedAccounts.tiktok) {
          return await message.reply('✅ You already linked TikTok! Your link is permanent and verified.');
        }
        
        // Generate linking code
        const code = createLinkingCode(userId, cleanHandle);
        
        const embed = new EmbedBuilder()
          .setColor('#FF6B00')
          .setTitle('🔐 VERIFY YOUR LINK')
          .setDescription('10-minute verification code generated!')
          .addFields(
            { name: 'Your Code', value: `\`${code}\``, inline: false },
            { name: 'Next Step', value: `Comment on the stream:\n\`scouter:${code}\`\n\n(exactly like that!)`, inline: false },
            { name: 'TikTok Handle', value: `@${cleanHandle}`, inline: true },
            { name: 'Expires In', value: '10 minutes', inline: true },
            { name: '⚠️ Important', value: 'Made a typo? Just don\'t use the code and run the command again!', inline: false }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        console.log(`🔐 Link code ${code} created for ${message.author.username} → @${cleanHandle}`);

      } else if (command === 'ssbe') {
        // Choose Super Saiyan Blue Evolved path
        const userId = message.author.id;
        
        if (!users[userId]) {
          return await message.reply('You don\'t have a Scouter account yet!');
        }
        
        if (users[userId].rankId !== 7) {
          return await message.reply('You must reach Super Saiyan Blue first!');
        }
        
        users[userId].pathChoice = 'ssbe';
        users[userId].rankId = 8; // Upgrade to SSBE
        saveUsers();
        
        broadcastActivity('pathChosen', message.author.username, userId, 0, 'ssbe');
        broadcastLeaderboard();
        
        await message.reply(`✅ **${message.author.username}** chose **Super Saiyan Blue Evolved**! ⚡💠`);
        console.log(`🔱 ${message.author.username} chose SSBE path`);

      } else if (command === 'uisign') {
        // Choose Ultra Instinct Sign path
        const userId = message.author.id;
        
        if (!users[userId]) {
          return await message.reply('You don\'t have a Scouter account yet!');
        }
        
        if (users[userId].rankId !== 7) {
          return await message.reply('You must reach Super Saiyan Blue first!');
        }
        
        users[userId].pathChoice = 'uisign';
        users[userId].rankId = 8; // Upgrade to UI SIGN
        saveUsers();
        
        broadcastActivity('pathChosen', message.author.username, userId, 0, 'uisign');
        broadcastLeaderboard();
        
        await message.reply(`✅ **${message.author.username}** chose **Ultra Instinct Sign**! 🌀💫`);
        console.log(`🌀 ${message.author.username} chose UI SIGN path`);

      } else if (command === 'link-youtube') {
        const userId = message.author.id;
        const youtubeHandle = args[0];
        
        if (!youtubeHandle) {
          return await message.reply('Usage: `!link-youtube @youtubehandle` - Verify your YouTube subscription to claim 20,000 XP!');
        }
        
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

        await message.reply(`🔍 Verifying your YouTube subscription to @${youtubeHandle}...`);
        
        // Verify subscription
        const isSubscribed = await verifyYouTubeSubscription(youtubeHandle);
        
        if (!isSubscribed) {
          return await message.reply(`❌ Verification failed! Either:\n- You're not subscribed to hbtcdbz\n- Your YouTube handle is incorrect\n- Your account is private`);
        }

        users[userId].linkedAccounts.youtube = true;
        saveUsers();

        const channel = message.guild.channels.cache.get(activityChannelId);
        await awardXP(userId, message.author.username, 20000, 'YouTube channel linked + subscription verified', channel);

        const scouterId = users[userId].scouterId;
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('✅ YOUTUBE VERIFIED & LINKED')
          .addFields(
            { name: 'Scouter ID', value: scouterId, inline: true },
            { name: 'Bonus', value: '+20,000 XP', inline: true },
            { name: 'YouTube', value: `@${youtubeHandle}`, inline: true }
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
        
        // NOTE: Admin commands do NOT trigger path choice or rank-up notifications
        // (only earned XP through natural gameplay does)
        
        // Broadcast to overlay (real-time update!)
        broadcastActivity('admin', targetUser.username, targetUser.id, amount, null);
        broadcastLeaderboard();
        
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
        
        // NOTE: Admin commands do NOT trigger path choice or rank-up notifications
        // (only earned XP through natural gameplay does)
        
        // Broadcast to overlay (real-time update!)
        broadcastActivity('admin', targetUser.username, targetUser.id, exactXP, null);
        broadcastLeaderboard();
        
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
        
        // Broadcast to overlay (real-time update!)
        broadcastActivity('admin-rank', targetUser.username, targetUser.id, rankId, rankInfo.name);
        broadcastLeaderboard();
        
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
        
        // Broadcast to overlay (real-time update!)
        broadcastActivity('admin-reset', targetUser.username, targetUser.id, -oldXP, null);
        broadcastLeaderboard();
        
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

      } else if (command === 'admin-link-account') {
        // Admin command to manually link accounts (for fixing mistakes)
        if (!message.member.permissions.has('Administrator')) {
          return await message.reply('❌ Admin only!');
        }
        
        const targetUser = message.mentions.users.first();
        const tiktokHandle = args[2];
        
        if (!targetUser || !tiktokHandle) {
          return await message.reply('Usage: !admin-link-account @user @tiktokhandle');
        }
        
        const cleanHandle = tiktokHandle.replace('@', '').toLowerCase();
        const userId = targetUser.id;
        
        if (!users[userId]) {
          users[userId] = {
            id: userId,
            name: targetUser.username,
            xp: 0,
            rankId: 0,
            scouterId: generateScouterId(),
            linkedAccounts: {},
            pathChoice: null,
            linkedAt: null
          };
        }
        
        // Find TikTok user's XP if it exists
        let tiktokXP = 0;
        for (const [id, user] of Object.entries(users)) {
          if (user.autoCreated && user.linkedAccounts?.tiktok?.toLowerCase() === cleanHandle) {
            tiktokXP = user.xp || 0;
            delete users[id];
            break;
          }
        }
        
        // Link the account
        users[userId].linkedAccounts.tiktok = cleanHandle;
        users[userId].xp = (users[userId].xp || 0) + tiktokXP;
        users[userId].linkedAt = Date.now();
        users[userId].rankId = getRank(users[userId].xp).id;
        saveUsers();
        
        // Notify
        broadcastActivity('link', targetUser.username, userId, tiktokXP, null);
        broadcastLeaderboard();
        
        await message.reply(`✅ Manually linked ${targetUser.username} to @${cleanHandle}${tiktokXP > 0 ? ` (+${tiktokXP} XP merged)` : ''}`);
        console.log(`🔧 ADMIN: ${message.author.username} manually linked ${targetUser.username} → @${cleanHandle}`);

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

      } else if (command === 'tiktok-status') {
        const status = tiktokConnected ? '✅ CONNECTED' : '❌ DISCONNECTED';
        const embed = new EmbedBuilder()
          .setColor(tiktokConnected ? '#00FF00' : '#FF0000')
          .setTitle('TikTok Live Status')
          .addFields(
            { name: 'Connection', value: status, inline: true },
            { name: 'Username', value: `@${TIKTOK_USERNAME}`, inline: true },
            { name: 'API Key', value: TIKTOK_API_KEY ? '✅ SET' : '❌ NOT SET', inline: true }
          )
          .setTimestamp();
        
        await message.reply({ embeds: [embed] });

      } else if (command === 'trivia') {
        // Check cooldown
        if (triviaState.cooldown > Date.now()) {
          const remaining = Math.ceil((triviaState.cooldown - Date.now()) / 1000);
          return await message.reply(`⏳ Trivia cooldown: ${remaining}s remaining`);
        }

        if (triviaState.active) {
          return await message.reply('❓ Trivia already active! Answer with the letter (a/b/c) to guess.');
        }

        const question = startTrivia();
        const userId = message.author.id;
        const user = users[userId];

        const embed = new EmbedBuilder()
          .setColor('#9146FF')
          .setTitle('🧠 SCOUTER TRIVIA')
          .setDescription(`**${question.question}**`)
          .addFields(
            { name: 'A', value: question.answers[0], inline: true },
            { name: 'B', value: question.answers[1], inline: true },
            { name: 'C', value: question.answers[2], inline: true },
            { name: 'Difficulty', value: question.difficulty, inline: true },
            { name: 'Reward', value: `+${XP_RATES.TRIVIA} XP to first correct answer`, inline: true }
          )
          .setFooter({ text: 'React with ✅ when you know the answer, then type: a, b, or c' })
          .setTimestamp();

        const msg = await message.reply({ embeds: [embed] });
        await msg.react('✅');
        
        triviaState.messageId = msg.id;
        triviaState.guildId = message.guildId;

        // Auto-end trivia after 2 minutes
        setTimeout(() => {
          if (triviaState.active) {
            triviaState.active = false;
            const answers = ['A', 'B', 'C'];
            message.channel.send(`⏰ Time's up! The correct answer was **${answers[triviaState.currentQuestion.correct]}**`);
          }
        }, 120000);

      } else if (command === 'help') {
        const isAdmin = message.member.permissions.has('Administrator');
        
        // ===== EMBED 1: Overview (everyone sees) =====
        const embed1 = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('SCOUTER SYSTEM - OVERVIEW')
          .setDescription('Automatic Scouter ID creation! Comment on @gblilmar videos → Auto-onboarded.')
          .addFields(
            { name: 'Key Features', value: 'Aggregate all platforms • Atomic transactions • NO CORRUPTION', inline: false },
            { name: 'TikTok Users', value: '1. Comment on @gblilmar video\n2. Bot auto-creates Scouter\n3. !request-link @handle → Get code\n4. Comment code on stream → VERIFIED LINK', inline: false }
          )
          .setTimestamp();
        
        // ===== EMBED 2: User Commands (everyone sees) =====
        const embed2 = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('COMMANDS - GAMEPLAY')
          .addFields(
            { name: 'Status', value: '!powerlevel - Your XP + rank\n!scouter-id - Your Scouter ID\n!leaderboard - Top 10 users', inline: false },
            { name: 'Linking', value: '!request-link @handle - Request code\n!link-youtube - Link YouTube (20K XP)\n!ssbe / !uisign - Choose path at SSB', inline: false },
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
              { name: 'Power Management', value: '!admin-xp @user +5000 - Add/remove XP\n!admin-set-xp @user 50000 - Set exact XP\n!admin-rank @user 5 - Set rank\n!admin-reset @user - Reset to 0 XP\n!admin-link-account @user @handle - Fix linking', inline: false },
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
  } else if (message.guild) {
    // Regular Discord chat XP
    const userId = message.author.id;
    const now = Date.now();
    const lastTime = lastMessageXP[userId] || 0;

    if (now - lastTime > XP_RATES.MESSAGE_COOLDOWN) {
      const channel = message.guild.channels.cache.get(activityChannelId);
      console.log(`💬 Chat XP: ${message.author.username} +${XP_RATES.CHAT} XP`);
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
