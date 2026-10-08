import 'dotenv/config.js';
import { Client, GatewayIntentBits, EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer } from 'http';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RANKINGS_FILE = path.join(__dirname, 'rankings-save.json');

// Stripe config
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// XP rates
const XP_RATES = {
  CHAT: 100,
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

console.log('🔍 Discord Token:', process.env.DISCORD_TOKEN ? '✅ YES' : '❌ NO');
console.log('💳 Stripe Key:', process.env.STRIPE_SECRET_KEY ? '✅ LOADED' : '❌ NO');

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

      // Get customer details
      const amount = session.amount_total / 100; // Convert cents to dollars
      const customerName = session.customer_details?.name || 'Unknown';
      const customerEmail = session.customer_details?.email || 'unknown@email.com';
      
      // Get custom fields (Discord username)
      let discordUsername = null;
      if (session.custom_fields && session.custom_fields.length > 0) {
        discordUsername = session.custom_fields[0].text?.value;
      }

      console.log(`💰 Donation: ${customerName} (${customerEmail}) - $${amount} - Discord: ${discordUsername}`);

      // Try to find user by Discord username
      let targetUser = null;
      if (discordUsername) {
        // Clean up Discord username (remove # and everything after if it exists)
        const cleanUsername = discordUsername.split('#')[0];
        targetUser = Object.values(users).find(u => u.name.toLowerCase() === cleanUsername.toLowerCase());
      }

      if (targetUser) {
        // Calculate XP: $1 = 100 coins, apply tiers
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
            { name: '⚡ XP Awarded', value: `${xpAwarded} (1.5x multiplier)`, inline: false },
            { name: '🏆 Rank', value: getRankInfo(targetUser.rankId).short, inline: true }
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
        console.warn(`⚠️ Could not find Discord user: ${discordUsername}`);
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Stripe webhook error:', error.message);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: client.user ? 'online' : 'offline' });
});

// ===== DISCORD CLIENT =====
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

      } else if (command === 'help') {
        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('📖 SCOUTER COMMANDS')
          .addFields(
            { name: '⚡ !powerlevel', value: 'Check your power level' },
            { name: '🏆 !leaderboard', value: 'Top 10 users' },
            { name: '💬 Chat XP', value: '100 XP per message (30s cooldown)' },
            { name: '💳 !donate', value: 'Get Stripe donation link (auto-tracked 1.5x XP)' },
            { name: '⚔️ !battle <vs> <win|lose>', value: 'Battle result' },
            { name: '🔧 !scouter-setup', value: '[ADMIN] Setup activity channel' }
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

// Start servers
server.listen(PORT, () => {
  console.log(`✅ Stripe webhook listening on port ${PORT}`);
  console.log(`📍 Webhook: /stripe-webhook`);
});

client.login(process.env.DISCORD_TOKEN);
