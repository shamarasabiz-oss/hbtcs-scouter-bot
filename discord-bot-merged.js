import 'dotenv/config.js';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RANKINGS_FILE = path.join(__dirname, 'rankings-save.json');

console.log('🔍 Token loaded:', process.env.DISCORD_TOKEN ? '✅ YES' : '❌ NO');

const RANKS = [
  { id:0,  name:'Low-Class Warrior',       short:'LOW CLASS', xp:0,         color:'#FFFFFF', emoji:'💩' },
  { id:1,  name:'Elite Warrior',           short:'ELITE',     xp:2500,      color:'#C0A060', emoji:'⚔️' },
  { id:2,  name:'Super Saiyan',            short:'SSJ',       xp:10000,     color:'#FFD700', emoji:'⚡' },
  { id:3,  name:'Super Saiyan 2',          short:'SSJ2',      xp:26000,     color:'#FFE840', emoji:'⚡⚡' },
  { id:12, name:'Omni-King',               short:'OMNI KING', xp:7500000,   color:'#FFD700', emoji:'👑' },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] });

let users = {};

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

function getRankInfo(rankId) {
  return RANKS.find(r => r.id === rankId) || RANKS[0];
}

function fmtPL(n) {
  if (n >= 1000000) return (n/1000000).toFixed(2)+'M';
  if (n >= 10000) return Math.round(n).toLocaleString();
  return String(Math.round(n));
}

client.on('ready', () => {
  console.log('✅ Discord bot ready as ' + client.user.tag);
  loadUsers();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;

  const args = message.content.slice(1).split(/\s+/);
  const command = args[0].toLowerCase();

  try {
    if (command === 'powerlevel') {
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

    } else if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor('#00FF50')
        .setTitle('📖 SCOUTER COMMANDS')
        .addFields(
          { name: '⚡ !powerlevel', value: 'Check your power level', inline: false },
          { name: '🏆 !leaderboard', value: 'View top 10 users', inline: false },
          { name: '🔗 !link <tiktok>', value: 'Link your TikTok account', inline: false },
          { name: '🎭 !rank', value: 'View rank requirements', inline: false },
          { name: '📊 !stats', value: 'View detailed stats', inline: false },
          { name: '📖 !help', value: 'Show this message', inline: false }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });

    } else if (command === 'link') {
      const tiktokName = args[1];
      if (!tiktokName) {
        return await message.reply('❌ Usage: `!link <tiktok_username>`');
      }

      const userId = message.author.id;
      if (!users[userId]) {
        users[userId] = { id: userId, name: message.author.username, xp: 0, rankId: 0 };
      }
      users[userId].tiktokUsername = tiktokName;
      
      const embed = new EmbedBuilder()
        .setColor('#00FF50')
        .setTitle('🔗 ACCOUNT LINKED')
        .setDescription(`✅ Linked **${message.author.username}** → **${tiktokName}**\n\nYour TikTok stats will now sync with Discord!`)
        .setTimestamp();

      await message.reply({ embeds: [embed] });

    } else if (command === 'rank') {
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 RANK REQUIREMENTS')
        .addFields(
          { name: '💩 Low-Class Warrior', value: '0 XP', inline: true },
          { name: '⚔️ Elite Warrior', value: '2,500 XP', inline: true },
          { name: '⚡ Super Saiyan', value: '10,000 XP', inline: true },
          { name: '⚡⚡ Super Saiyan 2', value: '26,000 XP', inline: true },
          { name: '👑 Omni-King', value: '7,500,000 XP', inline: true },
          { name: '📈 How to Rank Up', value: 'Earn XP by participating in HBTC streams!', inline: false }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });

    } else if (command === 'stats') {
      const userId = message.author.id;
      const user = users[userId] || { id: userId, name: message.author.username, xp: 0, rankId: 0, wins: 0, losses: 0, streak: 0 };
      const rankInfo = getRankInfo(user.rankId);

      const embed = new EmbedBuilder()
        .setColor('#00FF80')
        .setTitle(`📊 ${user.name}'s DETAILED STATS`)
        .addFields(
          { name: '⚡ Power Level', value: `${fmtPL(user.xp || 0)}`, inline: true },
          { name: '🏆 Current Rank', value: rankInfo.short, inline: true },
          { name: '🎭 Rank Title', value: rankInfo.name, inline: true },
          { name: '⚔️ Wins', value: `${user.wins || 0}`, inline: true },
          { name: '💔 Losses', value: `${user.losses || 0}`, inline: true },
          { name: '🔥 Current Streak', value: `${user.streak || 0}`, inline: true },
          { name: '💬 Comments', value: `${user.comments || 0}`, inline: true },
          { name: '🎁 Gifts', value: `${user.gifts || 0}`, inline: true },
          { name: '❤️ Likes', value: `${user.likes || 0}`, inline: true }
        )
        .setFooter({ text: 'HBTC Scouter System' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Error:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);
