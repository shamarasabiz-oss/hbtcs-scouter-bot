import 'dotenv/config.js';
import { Client, GatewayIntentBits, EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RANKINGS_FILE = path.join(__dirname, 'rankings-save.json');
const ACTIVITY_LOG_FILE = path.join(__dirname, 'activity-log.json');

// XP rates from original system
const XP_RATES = {
  CHAT: 100,
  LIKE: 1,
  FOLLOW: 2000,
  SHARE: 50,
  MEMBER: 50,
  PAYPAL_MULTIPLIER: 1.5
};

// Gift XP tiers from original system
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

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions] });

let users = {};
let activityLog = [];
let activityChannelId = null;

console.log('🔍 Token loaded:', process.env.DISCORD_TOKEN ? '✅ YES' : '❌ NO');

// Load users
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

// Save users
function saveUsers() {
  try {
    fs.writeFileSync(RANKINGS_FILE, JSON.stringify({ users }, null, 2));
  } catch (e) {
    console.error('❌ Error saving users:', e.message);
  }
}

// Calculate gift XP
function calcGiftXP(diamondCount) {
  for (const tier of GIFT_XP_TIERS) {
    if (diamondCount >= tier.diamonds) {
      return Math.round(diamondCount * tier.xp);
    }
  }
  return diamondCount * 5;
}

// Get rank info
function getRankInfo(rankId) {
  return RANKS.find(r => r.id === rankId) || RANKS[0];
}

// Format power level
function fmtPL(n) {
  if (n >= 1000000) return (n/1000000).toFixed(2)+'M';
  if (n >= 10000) return Math.round(n).toLocaleString();
  return String(Math.round(n));
}

// Award XP and post to activity channel
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
        { name: '📝 Reason', value: reason, inline: false },
        { name: '📊 Total XP', value: fmtPL(users[userId].xp), inline: true },
        { name: '🏆 Rank', value: newRank.short, inline: true }
      )
      .setTimestamp();

    if (rankChanged) {
      embed.setColor('#FFD700')
        .setTitle('🏆 RANK UP!')
        .addField('🎉 New Rank', `${oldRank.short} → ${newRank.short}`, false);
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

  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).split(/\s+/);
    const command = args[0].toLowerCase();

    try {
      if (command === 'scouter-setup') {
        // Admin command to set activity channel
        if (!message.member.permissions.has('ManageGuild')) {
          return await message.reply('❌ Need manage server permission');
        }

        // Find or create #scouter-activity channel
        let channel = message.guild.channels.cache.find(c => c.name === 'scouter-activity');
        if (!channel) {
          channel = await message.guild.channels.create({
            name: 'scouter-activity',
            type: ChannelType.GuildText,
            topic: '🔭 HBTC Scouter Activity Log - XP Gains, Rank Ups, Battles & Donations'
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
        // Award PayPal donation XP (manual for now)
        const amount = parseFloat(args[1]);
        if (!amount || isNaN(amount)) return await message.reply('❌ Usage: `!donation <amount>`');

        const baseXP = calcGiftXP(Math.round(amount * 100)); // Convert to cents
        const xpAwarded = Math.round(baseXP * XP_RATES.PAYPAL_MULTIPLIER);

        const channel = message.guild.channels.cache.get(activityChannelId);
        await awardXP(message.author.id, message.author.username, xpAwarded, `PayPal donation $${amount} (1.5x multiplier)`, channel);

        const embed = new EmbedBuilder()
          .setColor('#003087')
          .setTitle('💳 PAYPAL DONATION')
          .addFields(
            { name: '💰 Amount', value: `$${amount}`, inline: true },
            { name: '⚡ XP Awarded', value: `${xpAwarded} (1.5x)`, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'gift') {
        // Award TikTok gift XP
        const coins = parseInt(args[1]);
        if (!coins || isNaN(coins)) return await message.reply('❌ Usage: `!gift <coins>`');

        const dollars = coins / 100;
        const xpAwarded = calcGiftXP(coins);

        const channel = message.guild.channels.cache.get(activityChannelId);
        await awardXP(message.author.id, message.author.username, xpAwarded, `TikTok gift ${coins} coins ($${dollars})`, channel);

        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🎁 TIKTOK GIFT RECEIVED')
          .addFields(
            { name: '🪙 Coins', value: `${coins}`, inline: true },
            { name: '💵 Value', value: `$${dollars}`, inline: true },
            { name: '⚡ XP Awarded', value: `${xpAwarded}`, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'battle') {
        // Battle notification
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
            { name: '👥 Opponent', value: opponent, inline: true },
            { name: '⚡ XP Change', value: `${xpChange > 0 ? '+' : ''}${xpChange}`, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });

      } else if (command === 'help') {
        const embed = new EmbedBuilder()
          .setColor('#00FF50')
          .setTitle('📖 SCOUTER COMMANDS')
          .addFields(
            { name: '⚡ !powerlevel', value: 'Check your power level' },
            { name: '🏆 !leaderboard', value: 'View top 10 users' },
            { name: '💳 !donation <$>', value: 'Award PayPal donation XP (1.5x)' },
            { name: '🎁 !gift <coins>', value: 'Award TikTok gift XP' },
            { name: '⚔️ !battle <opponent> <win|lose>', value: 'Record battle result' },
            { name: '🔧 !scouter-setup', value: '[ADMIN] Set up activity channel' }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
