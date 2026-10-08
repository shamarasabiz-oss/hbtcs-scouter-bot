import 'dotenv/config.js';
import { Client, GatewayIntentBits, EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import express from 'express';
import { createServer } from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RANKINGS_FILE = path.join(__dirname, 'rankings-save.json');
const COMMENT_CACHE_FILE = path.join(__dirname, 'comment-cache.json');

// TikTok API config
const RAPIDAPI_KEY = '06fcc1d26fmsh098fdf48c374fdbp147ec6jsnd31c22793bf3';
const RAPIDAPI_HOST = 'tiktok-scraper7.p.rapidapi.com';
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'gblilmar';
const PAYPAL_EMAIL = process.env.PAYPAL_EMAIL || 'gblilmar@gmail.com';

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

// Express server for PayPal webhooks
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let users = {};
let activityChannelId = null;
let lastMessageXP = {};
let commentCache = { videos: {} };

console.log('🔍 Token loaded:', process.env.DISCORD_TOKEN ? '✅ YES' : '❌ NO');
console.log('🎬 TikTok Username:', TIKTOK_USERNAME);
console.log('💳 PayPal Email:', PAYPAL_EMAIL);

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

// PayPal IPN webhook
app.post('/paypal-webhook', async (req, res) => {
  console.log('💳 PayPal IPN received');

  try {
    const payment = req.body;

    // Verify it's a completed payment TO you
    if (payment.payment_status !== 'Completed' || payment.receiver_email !== PAYPAL_EMAIL) {
      console.log('⚠️ Skipping non-completed or wrong recipient payment');
      return res.sendStatus(200);
    }

    const donorName = payment.first_name + ' ' + payment.last_name;
    const amount = parseFloat(payment.mc_gross);
    const discordUserId = payment.custom; // User ID from donation link

    console.log(`✅ PayPal Donation: ${donorName} donated $${amount} (Discord ID: ${discordUserId})`);

    if (discordUserId && users[discordUserId]) {
      const baseXP = calcGiftXP(Math.round(amount * 100));
      const xpAwarded = Math.round(baseXP * XP_RATES.PAYPAL_MULTIPLIER);

      const channel = client.channels.cache.get(activityChannelId);
      await awardXP(discordUserId, users[discordUserId].name, xpAwarded, `PayPal donation $${amount} (1.5x)`, channel);

      const embed = new EmbedBuilder()
        .setColor('#003087')
        .setTitle('💳 PAYPAL DONATION RECEIVED')
        .addFields(
          { name: '👤 Donator', value: donorName, inline: true },
          { name: '💰 Amount', value: `$${amount}`, inline: true },
          { name: '⚡ XP Awarded', value: `${xpAwarded} (1.5x multiplier)`, inline: false },
          { name: '🏆 Rank', value: getRankInfo(users[discordUserId].rankId).short, inline: true }
        )
        .setTimestamp();

      if (channel) {
        try {
          await channel.send({ embeds: [embed] });
        } catch (e) {
          console.error('❌ Failed to post donation:', e.message);
        }
      }
    } else {
      console.warn('⚠️ Could not find Discord user for ID:', discordUserId);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error('❌ PayPal webhook error:', e.message);
    res.sendStatus(500);
  }
});

client.on('ready', () => {
  console.log('✅ Discord bot ready as ' + client.user.tag);
  loadUsers();
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

        // PayPal URL with Discord user ID embedded
        const paypalUrl = `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${PAYPAL_EMAIL}&item_name=HBTC+Scouter+Support&currency_code=USD&custom=${userId}&return=https://discord.com`;

        const embed = new EmbedBuilder()
          .setColor('#003087')
          .setTitle('💳 SUPPORT HBTC SCOUTER')
          .setDescription(`Click the button below to donate and earn XP!`)
          .addFields(
            { name: '💰 Your Donation', value: 'Any amount helps! (1.5x XP multiplier)', inline: false },
            { name: '⚡ How It Works', value: '1. Click link → Pay on PayPal\n2. We track your donation\n3. Instant XP awarded + posted to #scouter-activity', inline: false }
          )
          .setTimestamp();

        // Create button (if Discord version supports components)
        const row = {
          type: 1,
          components: [
            {
              type: 2,
              label: '💳 Donate on PayPal',
              style: 5,
              url: paypalUrl
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

      } else if (command === 'help') {
        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('📖 SCOUTER COMMANDS')
          .addFields(
            { name: '⚡ !powerlevel', value: 'Check power level' },
            { name: '🏆 !leaderboard', value: 'Top 10 users' },
            { name: '💬 Chat XP', value: '100 XP per message (30s cooldown)' },
            { name: '💳 !donate', value: 'Get PayPal donation link (1.5x XP)' },
            { name: '⚔️ !battle <vs> <win|lose>', value: 'Battle result' },
            { name: '🔧 !scouter-setup', value: 'Setup activity channel' }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });
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

// Start HTTP server for PayPal webhooks
server.listen(PORT, () => {
  console.log(`✅ PayPal webhook server running on port ${PORT}`);
  console.log(`📍 Webhook endpoint: /paypal-webhook`);
});

client.login(process.env.DISCORD_TOKEN);
