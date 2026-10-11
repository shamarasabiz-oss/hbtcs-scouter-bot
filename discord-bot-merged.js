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
      msg.reply(`👤 **${u.name}**\n💪 ${rank.short} (${rank.name})\n⚡ ${u.xp.toLocaleString()} XP`).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    if (cmd === 'leaderboard' || cmd === 'lb') {
      const sorted = Object.values(users).sort((a, b) => b.xp - a.xp).slice(0, 10);
      let text = '🏁 **TOP 10 FIGHTERS**\n\n';
      if (sorted.length === 0) text += '(no users yet)';
      else sorted.forEach((u, i) => {
        const rank = getRank(u.xp);
        text += `${i + 1}. **${u.name}** - ${u.xp.toLocaleString()} XP (${rank.short})\n`;
      });
      console.log(`  ✓ Sending leaderboard`);
      msg.reply(text).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    if (cmd === 'link' && parts.length === 1) {
      const code = generateLinkCode();
      linkCodes[code] = { discordId: msg.author.id, expiresAt: Date.now() + 3600000 };
      console.log(`  ✓ Generated link code: ${code}`);
      msg.reply(`🔗 **LINK CODE:** \`${code}\`\nComment this code on @gblilmar TikTok to link your account!`).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    if (cmd === 'trivia') {
      if (triviaActive && !triviaAnswered) {
        console.log(`  ✓ Trivia already running`);
        msg.reply('⏳ Trivia already running').catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
        return;
      }
      
      const t = TRIVIAS[Math.floor(Math.random() * TRIVIAS.length)];
      triviaActive = { question: t.q, answer: t.a, difficulty: t.d };
      triviaAnswered = false;
      
      const opts = `a) ${t.opts[0]}\nb) ${t.opts[1]}\nc) ${t.opts[2]}`;
      console.log(`  ✓ Starting ${t.d} trivia`);
      msg.reply(`🧠 **TRIVIA [${t.d.toUpperCase()}]**\n\n${t.q}\n\n${opts}\n\nType **a**, **b**, or **c** to answer!`).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    // Trivia answer (a, b, c)
    if (cmd === 'a' || cmd === 'b' || cmd === 'c') {
      console.log(`  [TRIVIA-ANSWER] ${cmd}`);
      
      const now = Date.now();
      const cooldown = triviaCooldowns[msg.author.id] || 0;
      if (now - cooldown < TRIVIA_COOLDOWN_MS) {
        const mins = Math.ceil((TRIVIA_COOLDOWN_MS - (now - cooldown)) / 60000);
        console.log(`  ✓ Cooldown: ${mins}m`);
        return msg.reply(`⏳ Cooldown: ${mins}m remaining`).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      if (!triviaActive) {
        console.log(`  ✓ No trivia`);
        return msg.reply('❌ No trivia active').catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      if (triviaAnswered) {
        console.log(`  ✓ Already answered`);
        return msg.reply('⏳ Already answered').catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      triviaCooldowns[msg.author.id] = now;
      triviaAnswered = true;
      
      const isCorrect = cmd === triviaActive.answer;
      
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
        
        console.log(`  ✓ CORRECT +${xp}`);
        msg.reply({ embeds: [{ color: 0x00ff00, title: '✅ CORRECT!', description: `${msg.author.username} earned **${xp} PL**!`, fields: [{ name: 'Difficulty', value: triviaActive.d.toUpperCase(), inline: true }] }] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      } else {
        const penalty = { easy: 250, medium: 500, hard: 750, insane: 1250 };
        const loss = penalty[triviaActive.d] || 250;
        
        const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
        const uid = resolveId(u.id);
        
        if (users[uid]) {
          users[uid].xp = Math.max(0, users[uid].xp - loss);
          saveData();
        }
        
        console.log(`  ✓ WRONG -${loss}`);
        msg.reply({ embeds: [{ color: 0xff0000, title: '❌ WRONG!', description: `Correct answer: **${triviaActive.a.toUpperCase()}**`, fields: [{ name: 'Penalty', value: `-${loss} PL`, inline: true }] }] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      triviaActive = null;
      return;
    }

    if (cmd === 'startlive' || cmd === 'start') {
      console.log(`  ✓ Starting TikTok connection`);
      msg.reply('🔴 **STARTING LIVE** — Connecting to TikTok...').catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      if (tiktok) tiktok.connect().catch(() => {});
      return;
    }

    if (cmd === 'endlive' || cmd === 'stop') {
      console.log(`  ✓ Stopping TikTok connection`);
      if (tiktok) tiktok.disconnect();
      msg.reply('⏹️ **STREAM ENDED**').catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    if (cmd === 'help') {
      console.log(`  ✓ Sending help menu`);
      msg.reply(`📖 **SCOUTER BOT COMMANDS**

**Profile:**
\`!profile\` - Your profile
\`!leaderboard\` - Top 10 fighters

**Trivia:**
\`!trivia\` - Start trivia
\`a/b/c\` - Answer (15min cooldown)

**Account Linking:**
\`!link\` - Get link code
(Comment code on TikTok to merge accounts)

**Stream Control:**
\`!startlive\` - Connect to TikTok
\`!endlive\` - Disconnect from TikTok`).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      return;
    }

    console.log(`  ✗ Unknown command`);

  } catch (error) {
    console.error('[ERROR]', error.message);
  }
});

const tiktok = new TikTokLive({ uniqueId: USERNAME, apiKey: API_KEY, signServerUrl: 'http://localhost:8084' });

tiktok.on('like', (data) => {
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
