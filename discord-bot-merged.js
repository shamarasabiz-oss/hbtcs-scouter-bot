import 'dotenv/config.js';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { TikTokLive } from '@tiktool/live';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';

const dclient = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ]
});

let users = {};
let linkMap = {};
let linkCodes = {};
let triviaCooldowns = {};
let triviaActive = null;
let triviaAnswered = false;
let tiktokConnected = false;

const TRIVIA_COOLDOWN_MS = 15 * 60 * 1000;
const TRIVIAS = [
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What form did Goku achieve against Frieza?', a: 'b', d: 'medium', opts: ['SSJ2', 'Super Saiyan', 'Ultra Instinct'] },
  { q: 'How many forms does Frieza have?', a: 'c', d: 'medium', opts: ['3', '4', '5'] },
];

const USERNAME = process.env.TIKTOK_USERNAME || 'gblilmar';
const API_KEY = process.env.TIKTOK_API_KEY;

const RANKS = [
  { id: 0, name: 'Low-Class Warrior', short: 'LOW CLASS', xp: 0 },
  { id: 1, name: 'Elite Warrior', short: 'ELITE', xp: 2500 },
  { id: 2, name: 'Super Saiyan', short: 'SSJ', xp: 10000 },
  { id: 3, name: 'Super Saiyan 2', short: 'SSJ2', xp: 26000 },
  { id: 4, name: 'Super Saiyan 3', short: 'SSJ3', xp: 58000 },
  { id: 5, name: 'Super Saiyan 4', short: 'SSJ4', xp: 115000 },
  { id: 6, name: 'Super Saiyan God', short: 'SSG', xp: 205000 },
  { id: 7, name: 'Super Saiyan Blue', short: 'SSBE', xp: 335000 },
  { id: 8, name: 'SSBE / UI Sign', short: 'UI SIGN', xp: 520000 },
  { id: 9, name: 'Ultra Ego / MUI', short: 'MUI', xp: 900000 },
  { id: 10, name: 'God of Destruction', short: 'GOD', xp: 2200000 },
  { id: 11, name: 'Angel', short: 'ANGEL', xp: 4200000 },
  { id: 12, name: 'Omni-King', short: 'OMNI', xp: 7500000 },
];

function resolveId(rawId) {
  return linkMap[rawId] || rawId;
}

function getRank(xp) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (xp >= RANKS[i].xp) return RANKS[i];
  }
  return RANKS[0];
}

function findUser(query) {
  const q = query.toLowerCase();
  return Object.values(users).find(u => u.name.toLowerCase() === q || u.id === query);
}

function mergeAccounts(srcId, dstId) {
  const src = users[srcId];
  const dst = users[dstId];
  
  if (!src || !dst) return false;
  
  dst.xp += src.xp;
  dst.comments = (dst.comments || 0) + (src.comments || 0);
  dst.gifts = (dst.gifts || 0) + (src.gifts || 0);
  dst.follows = (dst.follows || 0) + (src.follows || 0);
  dst.likes = (dst.likes || 0) + (src.likes || 0);
  dst.shares = (dst.shares || 0) + (src.shares || 0);
  
  if (!dst.aliases) dst.aliases = [];
  if (src.name && !dst.aliases.includes(src.name)) {
    dst.aliases.push(src.name);
  }
  
  linkMap[srcId] = dstId;
  delete users[srcId];
  
  console.log(`🔗 Merged ${src.name} → ${dst.name}`);
  return true;
}

function saveData() {
  writeFileSync('rankings-save.json', JSON.stringify({ users, linkMap }, null, 2));
}

function loadData() {
  if (existsSync('rankings-save.json')) {
    const data = JSON.parse(readFileSync('rankings-save.json', 'utf8'));
    users = data.users || {};
    linkMap = data.linkMap || {};
  }
}

function generateLinkCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

dclient.once('clientReady', () => {
  console.log(`🤖 Discord: ${dclient.user.tag} — READY`);
});

dclient.on('messageCreate', (msg) => {
  try {
    console.log(`[RECV] Channel: ${msg.channelId} | Author: ${msg.author.username} | Content: "${msg.content}"`);
    
    if (msg.author.bot) {
      console.log(`  ↳ Skipped (bot)`);
      return;
    }
    
    // SPECIAL: Trivia answers (a, b, c) don't need ! prefix
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
        const rewards = { easy: 500, medium: 1000, hard: 1500, insane: 2500 };
        const xp = rewards[triviaActive.d] || 500;
        
        const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
        const uid = resolveId(u.id);
        
        if (!users[uid]) {
          users[uid] = { id: uid, name: u.name, xp: 0, comments: 0, gifts: 0, follows: 0, likes: 0, shares: 0, aliases: [] };
        }
        users[uid].xp += xp;
        saveData();
        
        // SET COOLDOWN AFTER ANSWERING
        triviaCooldowns[msg.author.id] = now;
        
        console.log(`  ✓ CORRECT! Awarded ${xp} XP (cooldown set for 15min)`);
        const corrEmbed = {
          color: 0x00FF00,
          title: '✅ CORRECT!',
          description: `${msg.author.username} earned **${xp} PL**!`,
          fields: [
            { name: 'Difficulty', value: triviaActive.d.toUpperCase(), inline: true },
            { name: 'Your New XP', value: `${users[uid].xp.toLocaleString()}`, inline: true }
          ]
        };
        triviaActive = null;
        return msg.reply({ embeds: [corrEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      } else {
        const penalty = { easy: 250, medium: 500, hard: 750, insane: 1250 };
        const loss = penalty[triviaActive.d] || 250;
        
        const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
        const uid = resolveId(u.id);
        
        if (users[uid]) {
          users[uid].xp = Math.max(0, users[uid].xp - loss);
          saveData();
        }
        
        // SET COOLDOWN AFTER ANSWERING
        triviaCooldowns[msg.author.id] = now;
        
        console.log(`  ✓ WRONG! Penalty: ${loss} XP (cooldown set for 15min)`);
        const wrongEmbed = {
          color: 0xFF5555,
          title: '❌ WRONG!',
          description: `Correct answer: **${triviaActive.a.toUpperCase()}**`,
          fields: [
            { name: 'You answered', value: cmd.toUpperCase(), inline: true },
            { name: 'Penalty', value: `-${loss} PL`, inline: true }
          ]
        };
        triviaActive = null;
        return msg.reply({ embeds: [wrongEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
    }
    
    if (!msg.content.startsWith('!')) {
      console.log(`  ↳ Skipped (no !)`);
      return;
    }

    const input = msg.content.slice(1).trim();
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    console.log(`⚡ COMMAND: !${cmd}`);

    if (cmd === 'profile') {
      let name = msg.author.username;
      if (parts.length > 1) name = parts.slice(1).join(' ');
      
      let u = users[resolveId(msg.author.id)];
      if (!u) u = findUser(name);
      
      if (!u) {
        users[msg.author.id] = {
          id: msg.author.id,
          name: msg.author.username,
          xp: 0,
          comments: 0,
          gifts: 0,
          follows: 0,
          likes: 0,
          shares: 0,
          aliases: []
        };
        saveData();
        u = users[msg.author.id];
      }
      
      const rank = getRank(u.xp);
      console.log(`  ✓ Sending profile for ${u.name}`);
      const profileEmbed = {
        color: 0x00FF50,
        title: `👤 ${u.name}'s Profile`,
        fields: [
          { name: '💪 Rank', value: `${rank.short}\n${rank.name}`, inline: true },
          { name: '⚡ Power Level', value: u.xp.toLocaleString(), inline: true },
          { name: '📊 TikTok Activity', value: `Likes: ${u.likes}\nFollows: ${u.follows}\nComments: ${u.comments}\nGifts: ${u.gifts}\nShares: ${u.shares}`, inline: false }
        ]
      };
      msg.reply({ embeds: [profileEmbed] }).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    if (cmd === 'leaderboard' || cmd === 'lb') {
      const sorted = Object.values(users).sort((a, b) => b.xp - a.xp).slice(0, 10);
      let leaderboardText = '';
      if (sorted.length === 0) {
        leaderboardText = '(no users yet)';
      } else {
        sorted.forEach((u, i) => {
          const rank = getRank(u.xp);
          leaderboardText += `${i + 1}. **${u.name}** - ${u.xp.toLocaleString()} XP (${rank.short})\n`;
        });
      }
      console.log(`  ✓ Sending leaderboard`);
      const lbEmbed = {
        color: 0xFF6B00,
        title: '🏆 TOP 10 FIGHTERS',
        description: leaderboardText,
        timestamp: new Date()
      };
      msg.reply({ embeds: [lbEmbed] }).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    if (cmd === 'link' && parts.length === 1) {
      const linkCode = generateLinkCode();
      linkCodes[linkCode] = { discordId: msg.author.id, expiresAt: Date.now() + 3600000 };
      console.log(`  ✓ Generated link code: ${linkCode}`);
      const linkEmbed = {
        color: 0x0099FF,
        title: '🔗 ACCOUNT LINKING',
        fields: [
          { name: 'Your Linking Code', value: `\`${linkCode}\``, inline: false },
          { name: '📋 How to Link', value: '1. Copy your code above\n2. Go to @gblilmar TikTok video\n3. Comment your code\n4. Bot auto-merges accounts\n5. Your XP syncs!', inline: false },
          { name: '⏰ Code Expires', value: '1 hour from now', inline: false }
        ]
      };
      msg.reply({ embeds: [linkEmbed] }).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    if (cmd === 'trivia') {
      if (triviaActive && !triviaAnswered) {
        console.log(`  ✓ Trivia already running`);
        msg.reply('⏳ Trivia already running').catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
        return;
      }
      
      const t = TRIVIAS[Math.floor(Math.random() * TRIVIAS.length)];
      triviaActive = { question: t.q, answer: t.a, difficulty: t.d, a: t.opts[0], b: t.opts[1], c: t.opts[2], d: t.d };
      triviaAnswered = false;
      
      console.log(`  ✓ Starting ${t.d} trivia`);
      const triviaEmbed = {
        color: 0x9966FF,
        title: `🧠 TRIVIA [${t.d.toUpperCase()}]`,
        description: t.q,
        fields: [
          { name: 'A', value: t.opts[0], inline: true },
          { name: 'B', value: t.opts[1], inline: true },
          { name: 'C', value: t.opts[2], inline: true },
          { name: '⏱️ How to Answer', value: 'Type **a**, **b**, or **c** (no ! prefix)', inline: false }
        ]
      };
      msg.reply({ embeds: [triviaEmbed] }).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    // Trivia answer (a, b, c)


    if (cmd === 'startlive' || cmd === 'start') {
      console.log(`  ✓ Starting TikTok connection`);
      tiktokConnected = true;
      const startEmbed = {
        color: 0xFF0000,
        title: '🔴 LIVE STARTED',
        description: 'Connected to TikTok Live!',
        fields: [
          { name: '⚡ Auto-XP Enabled', value: 'Likes: +100 XP\nFollows: +2,000 XP', inline: false },
          { name: '📊 Status', value: 'Stream listeners will earn XP automatically!', inline: false }
        ]
      };
      msg.reply({ embeds: [startEmbed] }).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      if (tiktok) tiktok.connect().catch(() => {});
      return;
    }

    if (cmd === 'endlive' || cmd === 'stop') {
      console.log(`  ✓ Stopping TikTok connection`);
      tiktokConnected = false;
      const stopEmbed = {
        color: 0x555555,
        title: '⏹️ STREAM ENDED',
        description: 'Disconnected from TikTok Live',
        fields: [
          { name: '⚡ Auto-XP Disabled', value: 'Likes and Follows will no longer award XP', inline: false }
        ]
      };
      msg.reply({ embeds: [stopEmbed] }).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      if (tiktok) tiktok.disconnect();
      msg.reply('⏹️ **STREAM ENDED**').catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    if (cmd === 'help') {
      console.log(`  ✓ Sending detailed help menu`);
      
      // Send multiple embeds for detailed help
      const embed1 = {
        color: 0x00FF50,
        title: '🔥 SCOUTER SYSTEM - OVERVIEW',
        description: 'Automatic Scouter ID creation! Comment on @gblilmar videos → Auto-onboarded.',
        fields: [
          { name: 'Key Features', value: 'Aggregate all platforms • Atomic transactions • NO CORRUPTION', inline: false },
          { name: 'TikTok Users', value: '1. Comment on @gblilmar video\n2. Bot auto-creates Scouter\n3. !link TikTok code\n4. XP syncs across platforms', inline: false }
        ]
      };
      
      const embed2 = {
        color: 0x0099FF,
        title: '⚡ COMMANDS - GAMEPLAY',
        fields: [
          { name: 'Profile & Ranks', value: '!profile - View your full profile\n!leaderboard / !lb - Top 10 fighters', inline: false },
          { name: 'Trivia System', value: '!trivia - Start a trivia question\na / b / c - Answer (no ! prefix)\nCooldown: 15 min after answering', inline: false },
          { name: 'Account Linking', value: '!link - Get your linking code\nComment code on @gblilmar TikTok to merge accounts', inline: false },
          { name: 'Live Streaming', value: '!startlive - Connect TikTok Live\n!endlive - Disconnect from stream', inline: false }
        ]
      };
      
      const embed3 = {
        color: 0xFF6B00,
        title: '💰 XP SOURCES & REWARDS',
        fields: [
          { name: 'TikTok Live Events', value: '❤️ Like: +100 XP\n👥 Follow: +2,000 XP\n(Only while LIVE - use !startlive)', inline: false },
          { name: 'Trivia Rewards', value: '🧠 Easy: +500 XP (wrong: -250)\n🧠 Medium: +1,000 XP (wrong: -500)\n🧠 Hard: +1,500 XP (wrong: -750)\n🧠 Insane: +2,500 XP (wrong: -1,250)', inline: false },
          { name: 'RANK TIERS', value: 'LOW CLASS (0) → ELITE (2.5k) → SSJ (10k) → SSJ2 (26k) → SSJ3 (58k) → SSJ4 (115k) → SSG (205k) → SSBE (335k) → UI SIGN (520k) → MUI (900k) → GOD (2.2M) → ANGEL (4.2M) → OMNI (7.5M)', inline: false }
        ]
      };
      
      msg.reply({ embeds: [embed1] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      msg.channel.send({ embeds: [embed2] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      msg.channel.send({ embeds: [embed3] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      return;
    }

    console.log(`  ✗ Unknown command`);

  } catch (error) {
    console.error('[ERROR]', error.message);
  }
});

const tiktok = new TikTokLive({ uniqueId: USERNAME, apiKey: API_KEY, signServerUrl: 'http://localhost:8084' });

tiktok.on('like', (data) => {
  if (!tiktokConnected) return; // Only award XP while live
  
  const userId = resolveId(data.uniqueId);
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      name: data.uniqueId,
      xp: 100,
      comments: 0,
      gifts: 0,
      follows: 0,
      likes: 1,
      shares: 0,
      aliases: []
    };
  } else {
    users[userId].xp += 100;
    users[userId].likes = (users[userId].likes || 0) + 1;
  }
  saveData();
});

tiktok.on('follow', (data) => {
  if (!tiktokConnected) return; // Only award XP while live
  
  const userId = resolveId(data.uniqueId);
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      name: data.uniqueId,
      xp: 2000,
      comments: 0,
      gifts: 0,
      follows: 1,
      likes: 0,
      shares: 0,
      aliases: []
    };
  } else {
    users[userId].xp += 2000;
    users[userId].follows = (users[userId].follows || 0) + 1;
  }
  saveData();
});

dclient.login(process.env.DISCORD_TOKEN).catch(err => console.error('❌ Discord login failed:', err.message));

console.log('📂 Loading data...');
loadData();
console.log(`✅ Loaded ${Object.keys(users).length} users`);
