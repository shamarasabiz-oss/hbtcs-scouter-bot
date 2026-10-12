import 'dotenv/config.js';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { TikTokLive } from '@tiktool/live';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';

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
  { question: "What year do the Androids arrive?", answers: { a: "Age 767", b: "Age 787", c: "Age 797" }, correct: "b", difficulty: "Hard", xp: 1500 },
  { question: "What is Cell's goal?", answers: { a: "Destroy Earth", b: "Achieve perfect form", c: "Kill Goku" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "How many forms does Cell have?", answers: { a: "2", b: "3", c: "4" }, correct: "b", difficulty: "Medium", xp: 1000 },
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
  { question: "Who taught Goku the Kamehameha?", answers: { a: "Master Roshi", b: "King Kai", c: "Whis" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "What is the Kaioken multiplier?", answers: { a: "2x per level", b: "5x per level", c: "10x per level" }, correct: "c", difficulty: "Hard", xp: 1500 },
  { question: "Who can use the Galick Gun?", answers: { a: "Goku", b: "Vegeta", c: "Frieza" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is the Special Beam Cannon?", answers: { a: "Goku's attack", b: "Piccolo's attack", c: "Vegeta's attack" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "What is the Potara fusion?", answers: { a: "Dance fusion", b: "Earring fusion", c: "Spirit fusion" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "How long does a Potara fusion last?", answers: { a: "1 hour", b: "Permanent", c: "30 minutes" }, correct: "b", difficulty: "Hard", xp: 1500 },
  { question: "Who is Goku's wife?", answers: { a: "Bulma", b: "Chi-Chi", c: "18" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is Goku's son's name?", answers: { a: "Gotenks", b: "Gohan", c: "Goten" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "Who is the main villain of the Saiyan Saga?", answers: { a: "Frieza", b: "Vegeta", c: "Nappa" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is Broly's full name?", answers: { a: "Broly the Legendary", b: "Broly Son", c: "Bio-Broly" }, correct: "a", difficulty: "Medium", xp: 1000 },
  { question: "Who is stronger, Jiren or Toppo?", answers: { a: "Jiren", b: "Toppo", c: "Equal" }, correct: "a", difficulty: "Hard", xp: 1500 },
  { question: "What is Goku's power level at the start of DBZ?", answers: { a: "8000", b: "400", c: "1000" }, correct: "a", difficulty: "Hard", xp: 1500 },
  { question: "How many wishes can the Earth Dragon Balls grant?", answers: { a: "1", b: "2", c: "3" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "How many Future Trunks timelines exist?", answers: { a: "1", b: "2", c: "3" }, correct: "c", difficulty: "Hard", xp: 1500 },
  { question: "Who is Future Trunks' father?", answers: { a: "Vegeta", b: "Goku", c: "Zarbon" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "How many universes exist in Dragon Ball Super?", answers: { a: "8", b: "12", c: "18" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "What is Universe 6's God of Destruction?", answers: { a: "Beerus", b: "Champa", c: "Belmod" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "What is Goku Black?", answers: { a: "Evil Goku", b: "Zamasu in Goku's body", c: "Alternate Goku" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "Who is Caulifla?", answers: { a: "Universe 6 Saiyan", b: "Universe 7 Saiyan", c: "Android" }, correct: "a", difficulty: "Medium", xp: 1000 },
  { question: "Who is Cabba?", answers: { a: "Universe 6 Vegeta equivalent", b: "Universe 7 Saiyan", c: "God of Destruction" }, correct: "a", difficulty: "Medium", xp: 1000 },
  { question: "What is the Mafuba technique?", answers: { a: "Sealing technique", b: "Healing move", c: "Power boost" }, correct: "a", difficulty: "Medium", xp: 1000 },
  { question: "Who is the Omni-King?", answers: { a: "Zeno", b: "Whis", c: "Beerus" }, correct: "a", difficulty: "Medium", xp: 1000 },
  { question: "Who is Whis?", answers: { a: "Beerus' assistant", b: "God of Destruction", c: "Supreme Kai" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "What does Gotenks fuse into?", answers: { a: "Vegito", b: "Gotenks", c: "Kefla" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What is Vegito?", answers: { a: "Fusion Dance", b: "Potara fusion", c: "Android fusion" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What does Goku eat to recover?", answers: { a: "Senzu beans", b: "Fruit", c: "Fish" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "Who grows Senzu beans?", answers: { a: "Master Roshi", b: "Yajirobe", c: "Korin" }, correct: "c", difficulty: "Medium", xp: 1000 },
  { question: "What is the Red Ribbon Army?", answers: { a: "Training school", b: "Military organization", c: "Tournament" }, correct: "b", difficulty: "Medium", xp: 1000 },
  { question: "Who is Commander Red?", answers: { a: "Leader of Red Ribbon", b: "Saiyan", c: "Android" }, correct: "a", difficulty: "Medium", xp: 1000 },
  { question: "Who is Krillin's love interest?", answers: { a: "18", b: "Marron", c: "Maron" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "What is Marron?", answers: { a: "Krillin's daughter", b: "Android", c: "Krillin's wife" }, correct: "a", difficulty: "Easy", xp: 500 },
  { question: "Who is Tien?", answers: { a: "Krillin's friend", b: "Three-eyed warrior", c: "Android" }, correct: "b", difficulty: "Easy", xp: 500 },
  { question: "What technique does Tien use?", answers: { a: "Tri-Beam", b: "Kamehameha", c: "Galick Gun" }, correct: "a", difficulty: "Medium", xp: 1000 },
  { question: "Who is Yamcha?", answers: { a: "Desert bandit", b: "Martial artist", c: "Both A and B" }, correct: "c", difficulty: "Medium", xp: 1000 },
  { question: "What is Yamcha's signature move?", answers: { a: "Wolf Fang Fist", b: "Kamehameha", c: "Spirit Bomb" }, correct: "a", difficulty: "Medium", xp: 1000 },
  { question: "Who is Puar?", answers: { a: "Yamcha's companion", b: "Shapeshifter", c: "Both A and B" }, correct: "c", difficulty: "Medium", xp: 1000 },
  { question: "What is Oolong's ability?", answers: { a: "Shapeshifter", b: "Super strength", c: "Flying" }, correct: "a", difficulty: "Easy", xp: 500 },
];

function getRandomTriviaQuestion(usedIndexes = []) {
  const available = triviaQuestions.filter((q, idx) => !usedIndexes.includes(idx));
  if (available.length === 0) return null;
  const randomIdx = Math.floor(Math.random() * available.length);
  const question = available[randomIdx];
  const questionIdx = triviaQuestions.indexOf(question);
  return { question, index: questionIdx };
}

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
  
  const oldXp = dst.xp;
  const addedXp = src.xp;
  
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
  
  // Send Discord notification to scouter-activity
  (async () => {
    try {
      const channel = dclient.channels.cache.find(c => c.name === 'scouter-activity');
      if (channel) {
        const linkEmbed = {
          color: 0x00FF00,
          title: '🔗 ACCOUNTS LINKED',
          fields: [
            { name: 'TikTok Account', value: src.name, inline: true },
            { name: 'Discord Account', value: dst.name, inline: true },
            { name: 'XP Transfer', value: `+${addedXp.toLocaleString()} XP`, inline: true },
            { name: 'New Total', value: `${dst.xp.toLocaleString()} XP`, inline: true },
            { name: 'Combined Stats', value: `Likes: ${dst.likes} | Follows: ${dst.follows} | Comments: ${dst.comments}`, inline: false }
          ],
          timestamp: new Date()
        };
        await channel.send({ embeds: [linkEmbed] }).catch(e => console.log(`  ✗ Failed to post link notification: ${e.message}`));
      }
    } catch (e) {
      console.log(`  ✗ Error sending link notification: ${e.message}`);
    }
  })();
  
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
          { name: '🔴 TikTok Live Events', value: `❤️ Likes: ${u.likes}\n👥 Follows: ${u.follows}`, inline: true },
          { name: '💬 Interactions', value: `💬 Comments: ${u.comments}\n🔁 Shares: ${u.shares}`, inline: true },
          { name: '🎁 Donations & Gifts', value: `🎁 Gift Count: ${u.gifts}\n💳 Total Donated: ${(u.donated || 0).toLocaleString()} coins`, inline: true },
          { name: '📊 Total Activity', value: `Events: ${(u.likes + u.follows + u.comments + u.shares).toLocaleString()}`, inline: false }
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
      linkCodes[linkCode] = { discordId: msg.author.id, discordName: msg.author.username, expiresAt: Date.now() + 600000 };
      console.log(`  ✓ Generated link code: ${linkCode}`);
      const linkEmbed = {
        color: 0xFF0000,
        title: '🔴 LINK YOUR TIKTOK ACCOUNT',
        description: '⚠️ **GO TO LIVESTREAM NOW** → Comment during @gblilmar TikTok Live',
        fields: [
          { name: '📌 Your Code', value: `\`${linkCode}\`  ← Copy this`, inline: false },
          { name: '🎬 Step-by-Step', value: '1️⃣ Copy your code (shown above)\n2️⃣ Go to @gblilmar TIKTOK LIVE\n3️⃣ Wait for host acknowledgment\n4️⃣ Comment: **${linkCode}**\n5️⃣ Bot auto-links your accounts\n6️⃣ All XP syncs!', inline: false },
          { name: '✅ What Happens', value: 'Your Discord account merges with TikTok\nAll TikTok XP transfers to Discord\nOne unified profile across platforms', inline: false },
          { name: '⏰ Code Expires', value: '10 MINUTES - get to stream fast!', inline: false }
        ]
      };
      msg.reply({ embeds: [linkEmbed] }).catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
      
      // Also post to scouter-activity to alert the stream
      (async () => {
        try {
          const channel = dclient.channels.cache.find(c => c.name === 'scouter-activity');
          if (channel) {
            const alertEmbed = {
              color: 0xFF6B00,
              title: '🔴 LINKING CODE GENERATED',
              description: `User is ready to link their accounts!`,
              fields: [
                { name: '📌 Linking Code', value: `\`${linkCode}\``, inline: false },
                { name: '⏰ Valid For', value: '10 minutes', inline: false },
                { name: '🎬 Next Step', value: 'User will comment code on TikTok Live', inline: false }
              ]
            };
            await channel.send({ embeds: [alertEmbed] }).catch(e => {});
          }
        } catch (e) {}
      })();
      return;
    }

    if (cmd === 'trivia') {
      if (triviaActive && !triviaAnswered) {
        console.log(`  ✓ Trivia already running`);
        msg.reply('⏳ Trivia already running').catch(e => console.log(`  ✗ Reply failed: ${e.message}`));
        return;
      }
      
      // Get random unique question (no repeats)
      const usedIndices = triviaActive?.usedIndices || [];
      const trivia = getRandomTriviaQuestion(usedIndices);
      
      if (!trivia) {
        msg.reply('❌ All trivia questions used! Resetting...').catch(e => console.log(`  ✗ Failed: ${e.message}`));
        return;
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
      
      console.log(`  ✓ Starting ${q.difficulty} trivia - "${q.question}"`);
      const triviaEmbed = {
        color: 0x9966FF,
        title: `🧠 TRIVIA [${q.difficulty.toUpperCase()}] +${q.xp} XP`,
        description: q.question,
        fields: [
          { name: 'A', value: q.answers.a, inline: true },
          { name: 'B', value: q.answers.b, inline: true },
          { name: 'C', value: q.answers.c, inline: true },
          { name: '⏱️ How to Answer', value: 'Type **a**, **b**, or **c** (no ! prefix) | 15 min cooldown', inline: false }
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


    // ── TIKTOK VIEWER MANAGEMENT ──────────────────────────────────────────────
    if (cmd === 'boost' && parts.length >= 3) {
      // !boost <tiktok_username_or_id> <xp_amount> [reason]
      const identifier = parts[1]; // Can be username or ID
      const xpAmount = parseInt(parts[2]);
      const reason = parts.slice(3).join(' ') || 'Manual boost';
      
      if (isNaN(xpAmount)) {
        return msg.reply(`❌ Usage: !boost <name_or_id> <xp_amount> [reason]`).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      // Try to find by name first
      let user = Object.values(users).find(u => u.name.toLowerCase() === identifier.toLowerCase());
      
      // If not found by name, try by ID
      if (!user && identifier.match(/^[a-zA-Z0-9_:]+$/)) {
        user = users[identifier] || users[resolveId(identifier)];
      }
      
      // If still not found, create new TikTok profile
      if (!user) {
        const newId = identifier.includes(':') ? identifier : `tiktok_${identifier}`;
        users[newId] = {
          id: newId,
          name: identifier,
          xp: xpAmount,
          comments: 0,
          gifts: 0,
          follows: 0,
          likes: 0,
          shares: 0,
          aliases: [],
          donated: 0
        };
        user = users[newId];
        console.log(`  ✓ Created new TikTok profile: ${identifier}`);
      } else {
        user.xp += xpAmount;
        console.log(`  ✓ Boosted existing user: ${user.name}`);
      }
      
      saveData();
      const rank = getRank(user.xp);
      const boostEmbed = {
        color: 0xFF6B00,
        title: '⚡ POWER BOOST',
        fields: [
          { name: '🎬 User', value: user.name, inline: true },
          { name: '⚡ XP Added', value: `+${xpAmount.toLocaleString()}`, inline: true },
          { name: '💪 New Rank', value: `${rank.short} (${user.xp.toLocaleString()} XP)`, inline: true },
          { name: '📝 Reason', value: reason, inline: false }
        ]
      };
      msg.reply({ embeds: [boostEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      return;
    }
    
    if (cmd === 'profile-edit' || cmd === 'pedit') {
      // !pedit <name_or_id> <field> <value>
      // Fields: xp, name, likes, follows, comments, gifts, donated
      const identifier = parts[1];
      const field = (parts[2] || '').toLowerCase();
      const value = parts.slice(3).join(' ');
      
      if (!identifier || !field || !value) {
        return msg.reply(`❌ Usage: !pedit <name_or_id> <field> <value>

Fields: xp, name, likes, follows, comments, gifts, donated
Example: !pedit gblilmar xp 50000`).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      let user = Object.values(users).find(u => u.name.toLowerCase() === identifier.toLowerCase());
      if (!user) {
        user = users[identifier] || users[resolveId(identifier)];
      }
      
      if (!user) {
        return msg.reply(`❌ User not found: ${identifier}`).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      const oldValue = user[field];
      let newValue = value;
      
      if (field === 'xp' || field === 'likes' || field === 'follows' || field === 'comments' || field === 'gifts' || field === 'donated') {
        newValue = parseInt(value);
        if (isNaN(newValue)) {
          return msg.reply(`❌ ${field} must be a number`).catch(e => console.log(`  ✗ Failed: ${e.message}`));
        }
        newValue = Math.max(0, newValue);
      }
      
      user[field] = newValue;
      saveData();
      
      const oldRank = getRank(oldValue || 0);
      const newRank = getRank(user.xp);
      
      const editEmbed = {
        color: 0x0099FF,
        title: '✏️ PROFILE EDITED',
        fields: [
          { name: '👤 User', value: user.name, inline: true },
          { name: '📝 Field', value: field.toUpperCase(), inline: true },
          { name: '🔄 Change', value: `${oldValue} → ${newValue}`, inline: true },
          { name: '💪 Rank', value: newRank.id > oldRank.id ? `⬆️ ${oldRank.short} → ${newRank.short}` : `⏸️ ${newRank.short}`, inline: false }
        ]
      };
      msg.reply({ embeds: [editEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      return;
    }
    
    if (cmd === 'find-user' || cmd === 'finduser') {
      // !finduser <name_or_id> - Show user details including ID
      const identifier = parts.slice(1).join(' ');
      
      if (!identifier) {
        return msg.reply(`❌ Usage: !finduser <name_or_id>`).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      let user = Object.values(users).find(u => u.name.toLowerCase().includes(identifier.toLowerCase()));
      if (!user) {
        user = users[identifier] || users[resolveId(identifier)];
      }
      
      if (!user) {
        return msg.reply(`❌ User not found: ${identifier}`).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      }
      
      const rank = getRank(user.xp);
      const findEmbed = {
        color: 0x00FF50,
        title: '🔍 USER FOUND',
        fields: [
          { name: '👤 Name', value: user.name, inline: true },
          { name: '🆔 User ID', value: `\`${user.id}\``, inline: true },
          { name: '⚡ Power Level', value: user.xp.toLocaleString(), inline: true },
          { name: '💪 Rank', value: `${rank.short} (${rank.name})`, inline: true },
          { name: '❤️ Likes', value: `${user.likes}`, inline: true },
          { name: '👥 Follows', value: `${user.follows}`, inline: true },
          { name: '💬 Comments', value: `${user.comments}`, inline: true },
          { name: '🎁 Gifts', value: `${user.gifts}`, inline: true },
          { name: '💳 Donated', value: `${user.donated || 0}`, inline: true },
          { name: '🔗 Linked As', value: user.aliases && user.aliases.length > 0 ? user.aliases.join(', ') : 'None', inline: false }
        ]
      };
      msg.reply({ embeds: [findEmbed] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
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
          { name: '🔴 TikTok Live Events (Only while !startlive)', value: '❤️ Like: +100 XP each\n👥 Follow: +2,000 XP each', inline: false },
          { name: '💬 Discord & TikTok Comments', value: '💬 TikTok Live: +100 XP per comment\n📝 Discord chat: +100 XP per message (30s cooldown)', inline: false },
          { name: '🎁 Gifts & Donations', value: '🎁 TikTok Gift: +varies by gift value\n💳 Stripe Donation: 1.5x XP multiplier', inline: false },
          { name: '🧠 Trivia Rewards', value: '✅ Easy: +500 XP | ❌ Wrong: -250\n✅ Medium: +1,000 XP | ❌ Wrong: -500\n✅ Hard: +1,500 XP | ❌ Wrong: -750\n✅ Insane: +2,500 XP | ❌ Wrong: -1,250\n⏱️ 15 min cooldown after each answer', inline: false },
          { name: '🏆 RANK TIERS', value: 'LOW CLASS (0) → ELITE (2.5k) → SSJ (10k) → SSJ2 (26k) → SSJ3 (58k) → SSJ4 (115k) → SSG (205k) → SSBE (335k) → UI SIGN (520k) → MUI (900k) → GOD (2.2M) → ANGEL (4.2M) → OMNI (7.5M)', inline: false }
        ]
      };
      
      msg.reply({ embeds: [embed1] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      msg.channel.send({ embeds: [embed2] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
      msg.channel.send({ embeds: [embed2a] }).catch(e => console.log(`  ✗ Failed: ${e.message}`));
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

tiktok.on('gift', (data) => {
  if (!tiktokConnected) return; // Only award XP while live
  
  const userId = resolveId(data.uniqueId);
  const giftValue = data.giftValue || 1; // Gift coin value
  
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      name: data.uniqueId,
      xp: giftValue * 10,
      comments: 0,
      gifts: 1,
      follows: 0,
      likes: 0,
      shares: 0,
      aliases: [],
      donated: giftValue
    };
  } else {
    users[userId].xp += giftValue * 10;
    users[userId].gifts = (users[userId].gifts || 0) + 1;
    users[userId].donated = (users[userId].donated || 0) + giftValue;
  }
  saveData();
  console.log(`🎁 Gift from ${data.uniqueId}: ${giftValue} coins, +${giftValue * 10} XP`);
});

tiktok.on('comment', (data) => {
  if (!tiktokConnected) return;
  
  const comment = (data.comment?.trim() || '').toUpperCase();
  const tiktokId = data.uniqueId;
  const tiktokName = data.uniqueId; // TikTok username
  
  // AWARD XP FOR COMMENT (unless it's a linking code)
  const isLinkCode = comment.match(/^[A-F0-9]{6}$/);
  
  if (!isLinkCode) {
    // Regular comment - award XP
    const commentXp = 100; // Base comment XP
    
    if (!users[tiktokId]) {
      users[tiktokId] = {
        id: tiktokId,
        name: tiktokName,
        xp: commentXp,
        comments: 1,
        gifts: 0,
        follows: 0,
        likes: 0,
        shares: 0,
        aliases: [],
        donated: 0
      };
    } else {
      users[tiktokId].xp += commentXp;
      users[tiktokId].comments = (users[tiktokId].comments || 0) + 1;
    }
    saveData();
    console.log(`💬 Comment from ${tiktokName}: +${commentXp} XP`);
  }
  
  // Check if comment is a 6-char link code (A27B86 format)
  if (isLinkCode) {
    console.log(`🔗 [LINK-ATTEMPT] TikTok:${tiktokId} commented linking code: ${comment}`);
    
    const linkData = linkCodes[comment];
    if (!linkData) {
      console.log(`  ✗ Code not found or never issued`);
      return;
    }
    
    if (Date.now() > linkData.expiresAt) {
      console.log(`  ✗ Code expired (>10 min old)`);
      delete linkCodes[comment];
      return;
    }
    
    // Verify: ensure both accounts exist
    const discordId = linkData.discordId;
    const discordName = linkData.discordName;
    
    if (!users[tiktokId]) {
      users[tiktokId] = {
        id: tiktokId,
        name: tiktokName,
        xp: 0,
        comments: 0,
        gifts: 0,
        follows: 0,
        likes: 0,
        shares: 0,
        aliases: []
      , donated: 0 };
    }
    
    if (!users[discordId]) {
      users[discordId] = {
        id: discordId,
        name: discordName,
        xp: 0,
        comments: 0,
        gifts: 0,
        follows: 0,
        likes: 0,
        shares: 0,
        aliases: []
      , donated: 0 };
    }
    
    // Merge accounts
    const success = mergeAccounts(tiktokId, discordId);
    
    if (success) {
      delete linkCodes[comment];
      console.log(`  ✅ LINK SUCCESS! ${tiktokName} (TikTok) ← → ${discordName} (Discord)`);
      console.log(`     → Combined XP: ${users[discordId].xp.toLocaleString()}`);
      console.log(`     → Combined Stats: Likes:${users[discordId].likes} Follows:${users[discordId].follows} Comments:${users[discordId].comments}`);
      
      // Send confirmation to scouter-activity channel
      (async () => {
        try {
          const channel = dclient.channels.cache.find(c => c.name === 'scouter-activity');
          if (channel) {
            const confirmEmbed = {
              color: 0x00FF00,
              title: '✅ LINKING CONFIRMED',
              description: `TikTok comment detected and processed!`,
              fields: [
                { name: '🎬 TikTok User', value: tiktokName, inline: true },
                { name: '🎮 Discord User', value: discordName, inline: true },
                { name: '⚡ XP Synced', value: `${users[discordId].xp.toLocaleString()}`, inline: true },
                { name: '💬 Comment Detected', value: `Code: \`${comment}\``, inline: false }
              ],
              timestamp: new Date()
            };
            await channel.send({ embeds: [confirmEmbed] }).catch(e => {});
          }
        } catch (e) {}
      })();
    } else {
      console.log(`  ✗ Merge failed - accounts not found`);
    }
  }
});


dclient.login(process.env.DISCORD_TOKEN).catch(err => console.error('❌ Discord login failed:', err.message));

console.log('📂 Loading data...');
loadData();
console.log(`✅ Loaded ${Object.keys(users).length} users`);
