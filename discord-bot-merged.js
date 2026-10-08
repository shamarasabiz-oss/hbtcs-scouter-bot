import 'dotenv/config.js';
import { Client, GatewayIntentBits, EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RANKINGS_FILE = path.join(__dirname, 'rankings-save.json');
const COMMENT_CACHE_FILE = path.join(__dirname, 'comment-cache.json');

// TikTok API config
const RAPIDAPI_KEY = '06fcc1d26fmsh098fdf48c374fdbp147ec6jsnd31c22793bf3';
const RAPIDAPI_HOST = 'tiktok-scraper7.p.rapidapi.com';
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'gblilmar';

// XP rates
const XP_RATES = {
  CHAT: 100,
  DRAGON_COMMENT: 500,
  TEXT_COMMENT: 1000,
  PAYPAL_MULTIPLIER: 1.5,
  MESSAGE_COOLDOWN: 30000
};

const GIFT_XP_TIERS = [
  { diamonds: 5000, xp: 300 },
  { diamonds: 1000, xp: 150 },
  { diamonds: 200, xp: 80 },
  { diamonds: 50, xp: 40 },
  { diamonds: 10, xp: 20 },
  { diamonds: 2, xp: 10 },
  { diamonds: 0, xp: 5 }
];

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

let users = {};
let activityChannelId = null;
let lastMessageXP = {};
let commentCache = { videos: {} };

console.log('🔍 Token loaded:', process.env.DISCORD_TOKEN ? '✅ YES' : '❌ NO');
console.log('🎬 TikTok Username:', TIKTOK_USERNAME);
console.log('🔑 RapidAPI Key loaded:', RAPIDAPI_KEY ? '✅ YES' : '❌ NO');

// Load/save functions
function loadUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(RANKINGS_FILE, 'utf8'));
    users = data.users || {};
    console.log(`✅ Loaded ${Object.keys(users).length} users`);
  } catch (e) {
    console.error('❌ Error loading users:', e.message);
    users = {};
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(RANKINGS_FILE, JSON.stringify({ users }, null, 2));
  } catch (e) {
    console.error('❌ Error saving users:', e.message);
  }
}

function loadCommentCache() {
  try {
    if (fs.existsSync(COMMENT_CACHE_FILE)) {
      commentCache = JSON.parse(fs.readFileSync(COMMENT_CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    commentCache = { videos: {} };
  }
}

function saveCommentCache() {
  try {
    fs.writeFileSync(COMMENT_CACHE_FILE, JSON.stringify(commentCache, null, 2));
  } catch (e) {
    console.error('❌ Error saving comment cache:', e.message);
  }
}

function calcGiftXP(diamondCount) {
  for (const tier of GIFT_XP_TIERS) {
    if (diamondCount >= tier.diamonds) {
      return Math.round(diamondCount * tier.xp);
    }
  }
  return diamondCount * 5;
}

function getRankInfo(rankId) {
  return RANKS.find(r => r.id === rankId) || RANKS[0];
}

function fmtPL(n) {
  if (n >= 1000000) return (n/1000000).toFixed(2)+'M';
  if (n >= 10000) return Math.round(n).toLocaleString();
  return String(Math.round(n));
}

async function awardXP(userId, username, xpAmount, reason, channel) {
  if (!users[userId]) {
    users[userId] = { id: userId, name: username, xp: 0, rankId: 0 };
  }

  const oldRank = getRankInfo(users[userId].rankId);
  users[userId].xp = (users[userId].xp || 0) + xpAmount;
  const newRank = RANKS.filter(r => r.xp <= users[userId].xp).pop();
  const rankChanged = oldRank.id !== newRank.id;
  users[userId].rankId = newRank.id;

  saveUsers();
  console.log(`💰 ${username} earned ${xpAmount} XP (${reason})`);

  if (channel) {
    const embed = new EmbedBuilder()
      .setColor('#00FF50')
      .setTitle('💰 XP EARNED')
      .addFields(
        { name: '👤 User', value: username, inline: true },
        { name: '⚡ XP', value: `+${xpAmount}`, inline: true },
        { name: '📝 Reason', value: reason, inline: false }
      )
      .setTimestamp();

    if (rankChanged) {
      embed.setColor('#FFD700').setTitle('🏆 RANK UP!').addField('🎉 New Rank', `${oldRank.short} → ${newRank.short}`, false);
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('❌ Failed to post XP update:', e.message);
    }
  }
}

// Check TikTok comments via RapidAPI
async function checkTikTokComments(videoId) {
  try {
    console.log(`🔍 Checking comments for video ${videoId}...`);

    const options = {
      method: 'GET',
      url: `https://${RAPIDAPI_HOST}/video/comments`,
      params: { 
        video_id: videoId,
        count: '100'
      },
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      }
    };

    const response = await axios.request(options);
    const comments = response.data?.comments || [];

    console.log(`📨 Found ${comments.length} comments on video ${videoId}`);

    if (!commentCache.videos[videoId]) {
      commentCache.videos[videoId] = [];
    }

    let commentCount = 0;
    for (const comment of comments) {
      if (commentCount >= 5) break;

      const commenterUsername = comment.user?.unique_id || comment.user?.nickname || 'unknown';
      const commentText = comment.text || '';
      const commentId = comment.cid || comment.id;

      // Check if already processed
      if (commentCache.videos[videoId].includes(commentId)) {
        continue;
      }

      // Detect dragon emoji
      if (commentText.includes('🐉')) {
        console.log(`🐉 Dragon comment from ${commenterUsername}`);
        // Award XP (would need Discord user mapping here)
        // For now, just log it
        commentCache.videos[videoId].push(commentId);
        commentCount++;
      } else if (commentText.trim().length > 0) {
        console.log(`💬 Text comment from ${commenterUsername}`);
        commentCache.videos[videoId].push(commentId);
        commentCount++;
      }
    }

    saveCommentCache();
    return comments;
  } catch (e) {
    console.error('❌ Error checking comments:', e.message);
    return [];
  }
}

// Run comment checks every 10 minutes
setInterval(() => {
  console.log('🔄 Checking TikTok comments...');
  checkTikTokComments('default');
}, 10 * 60 * 1000);

client.on('ready', () => {
  console.log('✅ Discord bot ready as ' + client.user.tag);
  loadUsers();
  loadCommentCache();
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
            topic: '🔭 HBTC Scouter Activity - Auto-tracking TikTok comments & engagement'
          });
        }

        activityChannelId = channel.id;
        await message.reply(`✅ Scouter activity channel set to <#${channel.id}>`);

      } else if (command === 'powerlevel') {
        const userId = message.author.id;
        const user = users[userId] || { id: userId, name: message.author.username, xp: 0, rankId: 0 };
        const rankInfo = getRankInfo(user.rankId);

        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle(`🔭 ${user.name}'s POWER LEVEL`)
          .addFields(
            { name: '⚡ XP', value: `${fmtPL(user.xp || 0)}`, inline: true },
            { name: '🏆 RANK', value: rankInfo.short, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'leaderboard') {
        const sorted = Object.values(users)
          .sort((a, b) => (b.xp || 0) - (a.xp || 0))
          .slice(0, 10);

        let text = sorted.map((u, i) => `**${i+1}.** ${u.name} - ${fmtPL(u.xp || 0)}`).join('\n') || 'No data!';

        const embed = new EmbedBuilder()
          .setColor('#00FF80')
          .setTitle('🏆 TOP 10 POWER LEVELS')
          .setDescription(text)
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'donation') {
        const amount = parseFloat(args[1]);
        if (!amount || isNaN(amount)) return await message.reply('❌ Usage: `!donation <amount>`');

        const baseXP = calcGiftXP(Math.round(amount * 100));
        const xpAwarded = Math.round(baseXP * XP_RATES.PAYPAL_MULTIPLIER);

        const channel = message.guild.channels.cache.get(activityChannelId);
        await awardXP(message.author.id, message.author.username, xpAwarded, `PayPal donation $${amount} (1.5x)`, channel);

        const embed = new EmbedBuilder()
          .setColor('#003087')
          .setTitle('💳 PAYPAL DONATION')
          .addFields(
            { name: '💰 Amount', value: `$${amount}`, inline: true },
            { name: '⚡ XP', value: `${xpAwarded} (1.5x)`, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'gift') {
        const coins = parseInt(args[1]);
        if (!coins || isNaN(coins)) return await message.reply('❌ Usage: `!gift <coins>`');

        const xpAwarded = calcGiftXP(coins);
        const channel = message.guild.channels.cache.get(activityChannelId);
        await awardXP(message.author.id, message.author.username, xpAwarded, `TikTok gift ${coins} coins`, channel);

        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🎁 TIKTOK GIFT')
          .addFields(
            { name: '🪙 Coins', value: `${coins}`, inline: true },
            { name: '⚡ XP', value: `${xpAwarded}`, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });

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

      } else if (command === 'checkcomments') {
        const videoId = args[1];
        if (!videoId) return await message.reply('❌ Usage: `!checkcomments <video_id>`');
        
        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🔍 Checking TikTok comments...')
          .setDescription('Please wait...')
          .setTimestamp();

        const msg = await message.reply({ embeds: [embed] });

        const comments = await checkTikTokComments(videoId);
        const resultEmbed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle(`✅ Found ${comments.length} comments`)
          .setDescription(`Video: ${videoId}`)
          .setTimestamp();

        await msg.edit({ embeds: [resultEmbed] });

      } else if (command === 'help') {
        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('📖 SCOUTER COMMANDS')
          .addFields(
            { name: '⚡ !powerlevel', value: 'Check power level' },
            { name: '🏆 !leaderboard', value: 'Top 10 users' },
            { name: '💬 Chat XP', value: '100 XP per message (30s cooldown)' },
            { name: '💳 !donation <$>', value: 'PayPal donation (1.5x)' },
            { name: '🎁 !gift <coins>', value: 'TikTok gift XP' },
            { name: '⚔️ !battle <vs> <win>', value: 'Battle result' },
            { name: '🔍 !checkcomments <id>', value: 'Check video comments' },
            { name: '🔧 !scouter-setup', value: 'Setup activity channel' }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Error:', error);
    }
  } else {
    // Regular message XP
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

client.login(process.env.DISCORD_TOKEN);
