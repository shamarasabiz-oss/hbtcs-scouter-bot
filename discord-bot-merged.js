import 'dotenv/config.js';
import { Client, GatewayIntentBits, EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer } from 'http';
import Stripe from 'stripe';
import axios from 'axios';

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

const PORT = process.env.PORT || 3000;
const server = createServer(app);

let users = {};
let activityChannelId = null;
let lastMessageXP = {};
let trackingCache = { tiktok: {}, youtube: {} };

console.log('🔍 Discord Token:', process.env.DISCORD_TOKEN ? '✅ YES' : '❌ NO');
console.log('💳 Stripe Key:', process.env.STRIPE_SECRET_KEY ? '✅ LOADED' : '❌ NO');
console.log('🎬 TikTok:', TIKTOK_USERNAME);
console.log('📺 YouTube:', YOUTUBE_CHANNEL);

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

// ===== TIKTOK TRACKING =====
async function checkTikTokActivity() {
  try {
    console.log('🎬 Checking TikTok activity...');
    
    const options = {
      method: 'GET',
      url: 'https://tiktok-scraper7.p.rapidapi.com/user/info',
      params: { username: TIKTOK_USERNAME },
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'tiktok-scraper7.p.rapidapi.com'
      }
    };

    const response = await axios.request(options);
    console.log('✅ TikTok data fetched');
  } catch (error) {
    console.error('❌ TikTok error:', error.message);
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

    // Get channel info
    const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: YOUTUBE_CHANNEL,
        type: 'channel',
        key: YOUTUBE_API_KEY
      }
    });

    if (channelResponse.data.items.length === 0) {
      console.warn('⚠️ YouTube channel not found');
      return;
    }

    const channelId = channelResponse.data.items[0].id.channelId;
    console.log('✅ YouTube channel found:', channelId);

  } catch (error) {
    console.error('❌ YouTube error:', error.message);
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

// ===== DISCORD CLIENT =====
client.on('ready', () => {
  console.log('✅ Discord bot ready as ' + client.user.tag);
  loadUsers();
  loadCache();
  
  // Run checks immediately on startup
  checkTikTokActivity();
  checkYouTubeActivity();
  
  // Start periodic tracking
  setInterval(checkTikTokActivity, 600000); // 10 minutes
  setInterval(checkYouTubeActivity, 600000); // 10 minutes
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
          .setTitle('🏆 TOP 10')
          .setDescription(text)
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'donate') {
        const userId = message.author.id;
        if (!users[userId]) {
          users[userId] = { id: userId, name: message.author.username, xp: 0, rankId: 0 };
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

      } else if (command === 'checkactivity') {
        await message.reply('Checking TikTok and YouTube activity...');
        await checkTikTokActivity();
        await checkYouTubeActivity();
        await message.reply('Activity check complete!');

      } else if (command === 'help') {
        const helpText = `
**SCOUTER COMMANDS:**

!powerlevel - Check your power level
!leaderboard - Top 10 users
!donate - Get Stripe donation link
!battle <vs> <result> - Battle result
!checkactivity - Check TikTok & YouTube activity
!scouter-setup - Create scouter-activity channel

**XP RATES:**
Discord: 100 XP per message
TikTok: Dragon emoji 500, Comment 1000, Share 2500
YouTube: Like 500, Comment 1000, Share 2500
Stripe: 1.5x multiplier on all donations
        `;

        await message.reply(helpText);
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

server.listen(PORT, () => {
  console.log(`✅ Stripe webhook listening on port ${PORT}`);
  console.log(`📍 Webhook: /stripe-webhook`);
  console.log(`🎬 TikTok: ${TIKTOK_USERNAME}`);
  console.log(`📺 YouTube: ${YOUTUBE_CHANNEL}`);
});

client.login(process.env.DISCORD_TOKEN);
