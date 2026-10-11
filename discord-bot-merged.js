import 'dotenv/config.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { TikTokLive } from '@tiktool/live';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';

const dclient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] });

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

dclient.on('ready', () => {
  console.log(`🤖 Discord: ${dclient.user.tag}`);
});

dclient.on('messageCreate', (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.content.startsWith('!')) return;

    const input = msg.content.slice(1);
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    console.log(`[CMD] ${msg.author.username}: ${cmd}`);

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
      msg.reply(`👤 **${u.name}**\n💪 ${rank.short} (${rank.name})\n⚡ ${u.xp.toLocaleString()} XP`);
      return;
    }

    if (cmd === 'link' && parts.length === 1) {
      const code = generateLinkCode();
      linkCodes[code] = { discordId: msg.author.id, expiresAt: Date.now() + 3600000 };
      
      msg.reply(`🔗 **LINK CODE:** \`${code}\`\nComment this code on @gblilmar TikTok to link your account!`);
      return;
    }

    if (cmd === 'link' && parts.length === 2) {
      const code = parts[1].toUpperCase();
      const linkInfo = linkCodes[code];
      
      if (!linkInfo) {
        msg.reply('❌ Invalid or expired code');
        return;
      }
      if (linkInfo.expiresAt < Date.now()) {
        msg.reply('❌ Code expired');
        return;
      }
      
      const discordId = linkInfo.discordId;
      const tiktokId = msg.author.id;
      
      mergeAccounts(discordId, tiktokId);
      saveData();
      
      delete linkCodes[code];
      msg.reply('✅ **ACCOUNTS LINKED!** Your XP and activity are now merged!');
      return;
    }

    if (cmd === 'startlive' || cmd === 'start') {
      msg.reply('🔴 **STARTING LIVE** — Connecting to TikTok...').catch(() => {});
      if (tiktok) tiktok.connect().catch(() => {});
      return;
    }

    if (cmd === 'endlive' || cmd === 'stop') {
      if (tiktok) tiktok.disconnect();
      msg.reply('⏹️ **STREAM ENDED**').catch(() => {});
      return;
    }

    if (cmd === 'leaderboard' || cmd === 'lb') {
      const sorted = Object.values(users).sort((a, b) => b.xp - a.xp).slice(0, 10);
      let text = '🏁 **TOP 10 FIGHTERS**\n\n';
      sorted.forEach((u, i) => {
        const rank = getRank(u.xp);
        text += `${i + 1}. **${u.name}** - ${u.xp.toLocaleString()} XP (${rank.short})\n`;
      });
      msg.reply(text);
      return;
    }

    if (/^[abc]$/i.test(cmd)) {
      const now = Date.now();
      const lastAnswer = triviaCooldowns[msg.author.id] || 0;
      const cooldownRemaining = TRIVIA_COOLDOWN_MS - (now - lastAnswer);
      
      if (cooldownRemaining > 0) {
        const mins = Math.ceil(cooldownRemaining / 60000);
        msg.reply(`⏳ Trivia cooldown: ${mins}m remaining`);
        return;
      }
      
      if (!triviaActive) {
        msg.reply('❌ No trivia active');
        return;
      }
      if (triviaAnswered) {
        msg.reply('⏳ Already answered');
        return;
      }
      
      const selected = cmd.toLowerCase();
      
      if (selected === triviaActive.a) {
        const rewards = { easy: 500, medium: 1000, hard: 1500, insane: 2500 };
        const xp = rewards[triviaActive.d] || 500;
        
        triviaCooldowns[msg.author.id] = now;
        
        const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
        const uid = resolveId(u.id);
        
        if (!users[uid]) users[uid] = { id: uid, name: u.name, xp: 0, comments: 0, gifts: 0, follows: 0, likes: 0, shares: 0, aliases: [] };
        users[uid].xp += xp;
        saveData();
        
        msg.reply(`✅ **CORRECT!** ${msg.author.username} earned **${xp} PL**!`);
        triviaActive = null;
        triviaAnswered = true;
      } else {
        const penalty = { easy: 250, medium: 500, hard: 750, insane: 1250 };
        const loss = penalty[triviaActive.d] || 250;
        
        triviaCooldowns[msg.author.id] = now;
        
        const u = findUser(msg.author.username) || { id: msg.author.id, name: msg.author.username };
        const uid = resolveId(u.id);
        
        if (users[uid]) {
          users[uid].xp = Math.max(0, users[uid].xp - loss);
          saveData();
        }
        
        msg.reply(`❌ **WRONG!** Answer was **${triviaActive.a.toUpperCase()}** • **−${loss} PL penalty**`);
        triviaActive = null;
        triviaAnswered = true;
      }
      return;
    }

    if (cmd === 'trivia') {
      if (triviaActive && !triviaAnswered) {
        msg.reply('⏳ Trivia already running');
        return;
      }
      
      const t = TRIVIAS[Math.floor(Math.random() * TRIVIAS.length)];
      triviaActive = { question: t.q, answer: t.a, difficulty: t.d };
      triviaAnswered = false;
      
      const opts = `a) ${t.opts[0]}\nb) ${t.opts[1]}\nc) ${t.opts[2]}`;
      msg.reply(`🧠 **TRIVIA [${t.d.toUpperCase()}]**\n\n${t.q}\n\n${opts}\n\nType **a**, **b**, or **c** to answer!`);
      return;
    }

    if (cmd === 'help') {
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
\`!endlive\` - Disconnect from TikTok`);
      return;
    }

  } catch (error) {
    console.error('[ERROR]', error);
    msg.reply('❌ Command error').catch(() => {});
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
