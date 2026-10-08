import 'dotenv/config.js';
import { Client, GatewayIntentBits, EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RANKINGS_FILE = path.join(__dirname, 'rankings-save.json');

// PayPal config - CHANGE THIS TO YOUR PAYPAL.ME USERNAME
const PAYPAL_ME_USERNAME = process.env.PAYPAL_ME_USERNAME || 'gblilmar';

// XP rates
const XP_RATES = {
  CHAT: 100,
  PAYPAL_MULTIPLIER: 1.5,
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

let users = {};
let activityChannelId = null;
let lastMessageXP = {};

console.log('🔍 Token loaded:', process.env.DISCORD_TOKEN ? '✅ YES' : '❌ NO');
console.log('💳 PayPal.me:', `https://paypal.me/${PAYPAL_ME_USERNAME}`);

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

        const paypalUrl = `https://paypal.me/${PAYPAL_ME_USERNAME}`;

        const embed = new EmbedBuilder()
          .setColor('#003087')
          .setTitle('💳 SUPPORT HBTC SCOUTER')
          .setDescription(`Help us grow! Click below to donate.`)
          .addFields(
            { name: '💰 Donate Any Amount', value: '1.5x XP multiplier on your donation!', inline: false },
            { name: '⚡ How It Works', value: '1. Click link → Donate on PayPal\n2. Come back & tell us amount\n3. Admin verifies & awards XP instantly', inline: false },
            { name: '📝 Note', value: 'After donating, use: `!donate-verify @user <amount>`', inline: false }
          )
          .setTimestamp();

        const row = {
          type: 1,
          components: [
            {
              type: 2,
              label: '💳 Donate on PayPal.me',
              style: 5,
              url: paypalUrl
            }
          ]
        };

        await message.reply({ embeds: [embed], components: [row] });

      } else if (command === 'donate-verify') {
        // Admin only - verify and award XP
        if (!message.member.permissions.has('ManageGuild')) {
          return await message.reply('❌ Need manage server permission');
        }

        const targetUser = message.mentions.users.first();
        const amount = parseFloat(args[2]);

        if (!targetUser) return await message.reply('❌ Usage: `!donate-verify @user <$amount>`');
        if (!amount || isNaN(amount) || amount <= 0) return await message.reply('❌ Invalid amount');

        // Calculate XP: $1 = 100 coins, apply tiers
        const coins = Math.round(amount * 100);
        let xpPerDiamond = 5;
        if (coins >= 5000) xpPerDiamond = 300;
        else if (coins >= 1000) xpPerDiamond = 150;
        else if (coins >= 200) xpPerDiamond = 80;
        else if (coins >= 50) xpPerDiamond = 40;
        else if (coins >= 10) xpPerDiamond = 20;
        else if (coins >= 2) xpPerDiamond = 10;

        const baseXP = Math.round(coins * xpPerDiamond);
        const xpAwarded = Math.round(baseXP * XP_RATES.PAYPAL_MULTIPLIER);

        const channel = message.guild.channels.cache.get(activityChannelId);
        await awardXP(targetUser.id, targetUser.username, xpAwarded, `PayPal donation $${amount} (1.5x)`, channel);

        const embed = new EmbedBuilder()
          .setColor('#003087')
          .setTitle('💳 DONATION VERIFIED')
          .addFields(
            { name: '👤 Donator', value: targetUser.username, inline: true },
            { name: '💰 Amount', value: `$${amount}`, inline: true },
            { name: '⚡ XP Awarded', value: `${xpAwarded} (1.5x multiplier)`, inline: false },
            { name: '🏆 Rank', value: getRankInfo(users[targetUser.id].rankId).short, inline: true }
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

      } else if (command === 'help') {
        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('📖 SCOUTER COMMANDS')
          .addFields(
            { name: '⚡ !powerlevel', value: 'Check your power level' },
            { name: '🏆 !leaderboard', value: 'Top 10 users' },
            { name: '💬 Chat XP', value: '100 XP per message (30s cooldown)' },
            { name: '💳 !donate', value: 'Get PayPal.me donation link (1.5x XP)' },
            { name: '✅ !donate-verify @user <$amount>', value: '[ADMIN] Verify & award donation XP' },
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

client.login(process.env.DISCORD_TOKEN);
