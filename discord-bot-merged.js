import 'dotenv/config.js';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { TikTokLive } from '@tiktool/live';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8081;

// 🔥 DRAGON BALL TRIVIA DATABASE - 100+ RANDOMIZED QUESTIONS
const triviaQuestions = [
  { question: "What is the name of Goku's adoptive grandfather?", answers: { a: "Grandpa Gohan", b: "Master Roshi", c: "Krillin" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "How many Dragon Balls are there?", answers: { a: "5", b: "7", c: "9" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is Bulma's primary invention?", answers: { a: "Time Machine", b: "Dragon Radar", c: "Gravity Chamber" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "Who is Goku's best friend from childhood?", answers: { a: "Krillin", b: "Yamcha", c: "Tien" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "What martial arts tournament does Goku first enter?", answers: { a: "World Martial Arts Tournament", b: "21st Tenkaichi Budokai", c: "Regional Tournament" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What planet is Vegeta the prince of?", answers: { a: "Planet Saiyan", b: "Planet Vegeta", c: "Planet Sadala" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "What is Goku's Saiyan birth name?", answers: { a: "Kakarot", b: "Vegeta Jr.", c: "Broly" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "How many power levels did Nappa have?", answers: { a: "4000", b: "5000", c: "7500" }, correct: "a", difficulty: "Hard", xp: 1500 },
  { question: "How many days do the Saiyans have before arriving on Earth?", answers: { a: "20 days", b: "30 days", c: "365 days" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "Who was the first Super Saiyan in a thousand years?", answers: { a: "Vegeta", b: "Goku", c: "Broly" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "What emotion triggers the Super Saiyan transformation?", answers: { a: "Fear", b: "Rage and desperation", c: "Anger alone" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "What color does Goku's hair turn when Super Saiyan?", answers: { a: "Red", b: "Golden yellow", c: "Purple" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "How much does power increase with Super Saiyan?", answers: { a: "2x", b: "25x", c: "50x" }, correct: "c", difficulty: "Hard", xp: 1500 },
  { question: "What is Frieza's race called?", answers: { a: "Demon Clan", b: "Frost Demon", c: "Galactic Tyrant" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "How many forms does Frieza have?", answers: { a: "2", b: "3", c: "4" }, correct: "c", difficulty: "Medium", xp: 1000 },
  { question: "What is Frieza's power level in his final form?", answers: { a: "500,000", b: "1,200,000", c: "2,000,000" }, correct: "b", difficulty: "Hard", xp: 1500 },
  { question: "Who destroys Planet Vegeta?", answers: { a: "Zarbon", b: "Frieza", c: "King Vegeta" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "Who created the Androids?", answers: { a: "Bulma", b: "Dr. Gero", c: "Capsule Corporation" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is Cell's goal?", answers: { a: "Destroy Earth", b: "Achieve perfect form", c: "Kill Goku" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "What tournament does Cell create?", answers: { a: "World Tournament", b: "Cell Games", c: "Z Tournament" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "Who releases Majin Buu?", answers: { a: "Vegeta", b: "Babidi", c: "Goku" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is the original color of Majin Buu?", answers: { a: "Red", b: "Pink", c: "Purple" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is the most powerful form of Majin Buu?", answers: { a: "Evil Buu", b: "Kid Buu", c: "Super Buu" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "Who defeats Kid Buu?", answers: { a: "Vegeta", b: "Goku", c: "Fusion" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is Super Saiyan Blue?", answers: { a: "SSJ with blue hair", b: "God Ki + SSJ", c: "New form" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "Who is the God of Destruction of Universe 7?", answers: { a: "Beerus", b: "Champa", c: "Toppo" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "What is the Tournament of Power?", answers: { a: "Annual tournament", b: "Tournament between universes", c: "Training event" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "How many universes compete in Tournament of Power?", answers: { a: "4", b: "6", c: "8" }, correct: "c", difficulty: "Medium", xp: 1000 },
  { question: "What is Ultra Instinct?", answers: { a: "New SSJ form", b: "Technique to dodge", c: "God technique" }, correct: "b", difficulty: "Hard", xp: 1500 },
  { question: "What is the Kamehameha?", answers: { a: "Beam attack", b: "Meditation", c: "Transformation" }, correct: "a", difficulty: "Easy", xp: 500 },
];

function getRandomTriviaQuestion(usedIndices = []) {
  const available = triviaQuestions.filter((q, idx) => !usedIndices.includes(idx));
  if (available.length === 0) return null;
  const randomIdx = Math.floor(Math.random() * available.length);
  const question = available[randomIdx];
  const questionIdx = triviaQuestions.indexOf(question);
  return { question, index: questionIdx };
}

// Ranks for overlay
const RANKS = [
  { id: 0, name: 'Low-Class Warrior', short: 'LOW CLASS', xp: 0 },
  { id: 1, name: 'Elite Warrior', short: 'ELITE', xp: 2500 },
  { id: 2, name: 'Super Saiyan', short: 'SSJ', xp: 10000 },
  { id: 3, name: 'Super Saiyan 2', short: 'SSJ2', xp: 26000 },
  { id: 4, name: 'Super Saiyan 3', short: 'SSJ3', xp: 58000 },
  { id: 5, name: 'Super Saiyan 4', short: 'SSJ4', xp: 115000 },
  { id: 6, name: 'Super Saiyan God', short: 'SSG', xp: 205000 },
  { id: 7, name: 'Super Saiyan Blue', short: 'SSBE', xp: 335000 },
  { id: 8, name: 'Ultra Ego', short: 'ULTRA EGO', xp: 900000 },
  { id: 9, name: 'God of Destruction', short: 'DESTROYER', xp: 2200000 },
  { id: 10, name: 'Angel', short: 'ANGEL', xp: 4200000 },
  { id: 11, name: 'Omni-King', short: 'OMNI KING', xp: 7500000 },
];

function getRank(xp) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (xp >= r.xp) rank = r;
  }
  return rank;
}

// 🔇 MUTED CHANNELS - Bot won't send any responses in these channels
const mutedChannels = [];

function isMuted(channelName) {
  return mutedChannels.some(muted => channelName.toLowerCase().includes(muted.toLowerCase()));
}

function generateLinkCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

// Discord bot
const dclient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let users = {};
let linkCodes = {};
let triviaActive = null;
let triviaAnswered = false;
let triviaCooldowns = {};
let tiktokConnected = false;

const USERNAME = process.env.TIKTOK_USERNAME || 'gblilmar';
const API_KEY = process.env.TIKTOK_API_KEY || 'tk_8f99451968a57ef6230ae3d85ff249ef7d3f23358b5fbd6a';
const tiktok = new TikTokLive({ uniqueId: USERNAME, apiKey: API_KEY, signServerUrl: 'http://localhost:8084' });

function findUser(nameOrId) {
  const query = nameOrId.toLowerCase();
  return Object.values(users).find(u => 
    u.name.toLowerCase() === query || 
    u.id === nameOrId ||
    u.aliases?.some(a => a.toLowerCase() === query)
  );
}

function resolveId(idOrName) {
  if (users[idOrName]) return idOrName;
  const u = findUser(idOrName);
  return u?.id || idOrName;
}

function saveData() {
  writeFileSync('rankings-save.json', JSON.stringify({ users }, null, 2));
}

function loadData() {
  if (existsSync('rankings-save.json')) {
    const data = JSON.parse(readFileSync('rankings-save.json', 'utf8'));
    users = data.users || {};
  }
}

dclient.once('ready', () => {
  console.log(`🤖 Discord: ${dclient.user.tag} — READY`);
});

dclient.on('messageCreate', (msg) => {
  try {
    console.log(`[RECV] Channel: ${msg.channelId} | Author: ${msg.author.username} | Content: "${msg.content}"`);

    if (msg.author.bot) {
      console.log(`  ↳ Skipped (bot)`);
      return;
    }

    // Check if channel is muted
    if (isMuted(msg.channel.name)) {
      console.log(`  ↳ Muted channel - skipping responses`);
      return;
    }

    // Trivia answer
    if (msg.content.match(/^[AaBbCc]$/)) {
      console.log(`  [TRIVIA-ANSWER-NO-PREFIX] "${msg.content}"`);
      const cmd = msg.content.toLowerCase();

      if (!triviaActive) {
        console.log(`  ✓ No trivia active`);
        return msg.reply({ embeds: [{ color: 0xFF5555, title: '❌ No Trivia Active', description: 'Start a trivia with `!trivia` first!' }] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }

      if (triviaAnswered) {
        console.log(`  ✓ Already answered`);
        return msg.reply({ embeds: [{ color: 0xFF5555, title: '⏳ Already Answered', description: 'Someone already answered this question!' }] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }

      const now = Date.now();
      triviaAnswered = true;

      const isCorrect = cmd === triviaActive.answer;
      console.log(`  → User answered: ${cmd} | Correct answer: ${triviaActive.answer} | Match: ${isCorrect}`);

      if (isCorrect) {
        const xp = triviaActive.xp || 500;

        const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
        const uid = resolveId(u.id);

        if (!users[uid]) {
          users[uid] = { id: uid, name: u.name, xp: 0, comments: 0, gifts: 0, follows: 0, likes: 0, shares: 0, aliases: [] };
        }
        users[uid].xp += xp;
        saveData();

        triviaCooldowns[msg.author.id] = now;

        console.log(`  ✓ CORRECT! Awarded ${xp} XP`);
        const corrEmbed = {
          color: 0x00FF00,
          title: '✅ CORRECT!',
          description: `${msg.author.username} earned **${xp} XP**!`,
          fields: [
            { name: 'Difficulty', value: (triviaActive.difficulty || 'Easy').toUpperCase(), inline: true },
            { name: 'Your New XP', value: `${users[uid].xp.toLocaleString()}`, inline: true }
          ]
        };
        triviaActive = null;
        triviaAnswered = false;
        return msg.reply({ embeds: [corrEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      } else {
        const xp = triviaActive.xp || 500;
        const loss = Math.floor(xp / 2);

        const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
        const uid = resolveId(u.id);

        if (!users[uid]) {
          users[uid] = { id: uid, name: u.name, xp: 0, comments: 0, gifts: 0, follows: 0, likes: 0, shares: 0, aliases: [] };
        }
        users[uid].xp = Math.max(0, users[uid].xp - loss);
        saveData();

        triviaCooldowns[msg.author.id] = now;

        console.log(`  ✓ WRONG! Penalty: ${loss} XP`);

        const answerLetter = triviaActive.answer.toUpperCase();
        const correctAnswerText = triviaActive[triviaActive.answer] || 'Unknown';

        const wrongEmbed = {
          color: 0xFF5555,
          title: '❌ WRONG!',
          description: `Correct answer: **${answerLetter}** - ${correctAnswerText}`,
          fields: [
            { name: 'You answered', value: cmd.toUpperCase(), inline: true },
            { name: 'Penalty', value: `-${loss} XP`, inline: true }
          ]
        };
        triviaActive = null;
        triviaAnswered = false;
        return msg.reply({ embeds: [wrongEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
    }

    if (!msg.content.startsWith('!')) {
      const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
      const uid = resolveId(u.id);
      if (!users[uid]) {
        users[uid] = { id: uid, name: u.name, xp: 0, comments: 0, gifts: 0, follows: 0, likes: 0, shares: 0, aliases: [] };
      }
      users[uid].comments = (users[uid].comments || 0) + 1;
      users[uid].xp += 100;
      saveData();
      sendLB();
      return;
    }

    const parts = msg.content.slice(1).trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === 'help') {
      const helpEmbed = {
        color: 0x00AAFF,
        title: '🆘 SCOUTER COMMANDS',
        fields: [
          { name: '👤 Profile & Stats', value: '!profile - Show your stats\n!leaderboard / !lb - Top 10 fighters', inline: false },
          { name: '🎮 Games', value: '!trivia - Start trivia question\na/b/c - Answer (no ! prefix)', inline: false },
          { name: '🔗 Account Linking', value: '!link - Get linking code for TikTok', inline: false },
          { name: '📊 Status', value: '!startlive - Begin tracking\n!endlive - Stop tracking', inline: false }
        ]
      };
      return msg.reply({ embeds: [helpEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
    }

    if (cmd === 'profile') {
      const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
      const uid = resolveId(u.id);
      const user = users[uid] || { name: u.name, xp: 0, comments: 0, gifts: 0, follows: 0, likes: 0 };
      const rank = getRank(user.xp);

      const profileEmbed = {
        color: 0x00FF00,
        title: `⚡ ${user.name.toUpperCase()}`,
        description: rank.short,
        fields: [
          { name: 'Power Level', value: `${user.xp.toLocaleString()} XP`, inline: true },
          { name: 'Rank', value: rank.name, inline: true },
          { name: 'Comments', value: `${user.comments || 0}`, inline: true },
          { name: 'Likes', value: `${user.likes || 0}`, inline: true },
          { name: 'Follows', value: `${user.follows || 0}`, inline: true },
          { name: 'Gifts', value: `${user.gifts || 0}`, inline: true }
        ]
      };
      return msg.reply({ embeds: [profileEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
    }

    if (cmd === 'leaderboard' || cmd === 'lb') {
      const sorted = Object.values(users).sort((a, b) => b.xp - a.xp).slice(0, 10);
      const lbText = sorted.map((u, i) => `${i + 1}. **${u.name}** - ${u.xp.toLocaleString()} XP (${getRank(u.xp).short})`).join('\n');

      const lbEmbed = {
        color: 0xFF6B00,
        title: '🏆 TOP 10 LEADERBOARD',
        description: lbText || 'No users yet',
      };
      return msg.reply({ embeds: [lbEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
    }

    if (cmd === 'trivia') {
      if (triviaActive && !triviaAnswered) {
        console.log(`  ✓ Trivia already running`);
        return msg.reply('⏳ Trivia already running').catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      }

      const usedIndices = triviaActive?.usedIndices || [];
      const trivia = getRandomTriviaQuestion(usedIndices);

      if (!trivia) {
        return msg.reply('❌ All trivia questions used!').catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }

      const q = trivia.question;
      triviaActive = {
        question: q.question,
        answer: q.correct,
        difficulty: q.difficulty,
        a: q.answers.a,
        b: q.answers.b,
        c: q.answers.c,
        xp: q.xp,
        usedIndices: [...usedIndices, trivia.index]
      };
      triviaAnswered = false;

      console.log(`  ✓ Starting ${q.difficulty} trivia`);
      const triviaEmbed = {
        color: 0x9966FF,
        title: `🧠 TRIVIA [${q.difficulty.toUpperCase()}] +${q.xp} XP`,
        description: q.question,
        fields: [
          { name: 'A', value: q.answers.a, inline: true },
          { name: 'B', value: q.answers.b, inline: true },
          { name: 'C', value: q.answers.c, inline: true },
          { name: '⏱️ How to Answer', value: 'Type **a**, **b**, or **c** (no ! prefix)', inline: false }
        ]
      };
      return msg.reply({ embeds: [triviaEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
    }

    if (cmd === 'link') {
      const linkCode = generateLinkCode();
      linkCodes[linkCode] = { userId: msg.author.id, userName: msg.author.username, createdAt: Date.now() };

      const linkEmbed = {
        color: 0xFF0000,
        title: '🔴 LINK YOUR TIKTOK',
        description: 'Go to @gblilmar TikTok Live and comment this code',
        fields: [
          { name: '📌 Your Code', value: `\`${linkCode}\``, inline: false },
          { name: '⏰ Expires In', value: '10 MINUTES', inline: false }
        ]
      };
      return msg.reply({ embeds: [linkEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
    }

    if (cmd === 'startlive') {
      tiktokConnected = true;
      const startEmbed = { color: 0xFF0000, title: '🔴 LIVE STARTED', description: 'Tracking TikTok engagement' };
      return msg.reply({ embeds: [startEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
    }

    if (cmd === 'endlive') {
      tiktokConnected = false;
      const stopEmbed = { color: 0x555555, title: '⏹️ LIVE ENDED', description: 'Stopped tracking' };
      return msg.reply({ embeds: [stopEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
    }
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
  }
});

dclient.login(process.env.DISCORD_TOKEN).catch(err => console.error('❌ Discord login failed:', err.message));

console.log('📂 Loading data...');
loadData();
console.log(`✅ Loaded ${Object.keys(users).length} users`);

// ────────────────────────────────────────────
// 🌐 EXPRESS + WEBSOCKET SERVER (for overlay)
// ────────────────────────────────────────────

const appLB = express();
const httpLB = createServer(appLB);
const wssLB = new WebSocketServer({ server: httpLB });

// Serve leaderboard overlay HTML
appLB.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'leaderboard-overlay.html'));
});

// Broadcast leaderboard to all connected clients
function broadcastLeaderboard() {
  const lb = Object.values(users)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 10)
    .map(u => ({
      name: u.name,
      xp: u.xp,
      rank: getRank(u.xp).short
    }));

  const msg = JSON.stringify({ type: 'leaderboard', leaderboard: lb });
  let sent = 0;

  wssLB.clients.forEach(client => {
    try {
      if (client.readyState === 1) {
        client.send(msg);
        sent++;
      }
    } catch (e) {
      console.error('  ✗ WebSocket send failed:', e.message);
    }
  });

  if (sent > 0) {
    console.log(`  📡 Broadcast to ${sent} overlay client(s)`);
  }
}

function sendLB() {
  broadcastLeaderboard();
}

wssLB.on('connection', (ws) => {
  console.log('📊 Overlay client connected');
  broadcastLeaderboard();

  ws.on('close', () => console.log('📊 Overlay client disconnected'));
  ws.on('error', (err) => console.error('  ✗ WebSocket error:', err.message));
});

// Start server
httpLB.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
  console.log(`📊 Overlay: https://hbtcs-scouter-bot-production.up.railway.app/`);
});

// Broadcast leaderboard every 2 seconds
setInterval(sendLB, 2000);
