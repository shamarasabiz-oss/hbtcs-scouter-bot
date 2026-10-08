import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SERVER_ID = process.env.DISCORD_SERVER_ID;
const SCOUTER_SERVER_URL = process.env.SCOUTER_SERVER_URL || 'http://localhost:8080';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Load user data (shared with main server)
let users = {};
const USERS_FILE = join(__dirname, 'rankings-save.json');

function loadUsers() {
  try {
    const data = readFileSync(USERS_FILE, 'utf8');
    users = JSON.parse(data);
  } catch (e) {
    users = {};
  }
}

function saveUsers() {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUser(name) {
  const lowerName = name.toLowerCase();
  return Object.values(users).find(u => u.name.toLowerCase() === lowerName);
}

// ── RANK SYSTEM ────────────────────────────────────────────────────────
const RANKS = [
  { id: 0, name: 'Low-Class Warrior', short: 'LOW CLASS', xp: 0, emoji: '💩' },
  { id: 1, name: 'Elite Warrior', short: 'ELITE', xp: 2500, emoji: '⚔️' },
  { id: 2, name: 'Super Saiyan', short: 'SSJ', xp: 10000, emoji: '⚡' },
  { id: 3, name: 'Super Saiyan 2', short: 'SSJ2', xp: 26000, emoji: '⚡⚡' },
  { id: 4, name: 'Super Saiyan 3', short: 'SSJ3', xp: 58000, emoji: '💥' },
  { id: 5, name: 'Super Saiyan 4', short: 'SSJ4', xp: 115000, emoji: '🔴' },
  { id: 6, name: 'Super Saiyan God', short: 'SS GOD', xp: 205000, emoji: '🔥' },
  { id: 7, name: 'Super Saiyan Blue', short: 'SS BLUE', xp: 335000, emoji: '💠' },
  { id: 8, name: 'SSBE/UI Sign', short: 'FORK', xp: 520000, emoji: '⚡' },
  { id: 9, name: 'Ultra Ego/MUI', short: 'AWAKENED', xp: 900000, emoji: '🔱' },
  { id: 10, name: 'God of Destruction', short: 'DESTROYER', xp: 2200000, emoji: '💜' },
  { id: 11, name: 'Angel', short: 'ANGEL', xp: 4200000, emoji: '😇' },
  { id: 12, name: 'Omni-King', short: 'OMNI KING', xp: 7500000, emoji: '👑' },
];

function getRankForXP(xp) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (r.xp <= xp) rank = r;
  }
  return rank;
}

// ── DISCORD MESSAGE HANDLER ────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const userId = message.author.id;
  const userName = message.author.username;

  // ── AUTO-TRACK CHAT MESSAGE ────────────────────────────────────────
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      discordName: userName,
      name: userName,
      xp: 0,
      monthlyXP: 0,
      pathChoice: null,
      source: 'discord',
      createdAt: new Date().toISOString(),
    };
  }

  const user = users[userId];
  user.xp += 100;
  user.monthlyXP = (user.monthlyXP || 0) + 100;
  user.lastActive = Date.now();
  user.lastActivityType = 'discord_chat';
  saveUsers();

  // Broadcast to scouter server
  try {
    fetch(`${SCOUTER_SERVER_URL}/api/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        name: userName,
        xp: 100,
        action: 'chat',
        platform: 'discord',
      }),
    }).catch(e => console.log('Scouter update failed:', e.message));
  } catch (e) {
    // Fail silently
  }

  // ── COMMANDS ────────────────────────────────────────────────────────
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).split(/ +/);
  const cmd = args[0].toLowerCase();

  // !powerlevel
  if (cmd === 'powerlevel') {
    const user = users[userId];
    if (!user) return message.reply('No data for you yet. Keep chatting!');

    const rank = getRankForXP(user.xp);
    const embed = new EmbedBuilder()
      .setColor('#00FF50')
      .setTitle(`⚡ ${user.name}'s Power Level`)
      .addFields(
        { name: 'Current XP (This Month)', value: `${(user.monthlyXP || 0).toLocaleString()}`, inline: true },
        { name: 'All-Time XP', value: `${user.xp.toLocaleString()}`, inline: true },
        { name: 'Rank', value: `${rank.emoji} ${rank.name}`, inline: true }
      )
      .setFooter({ text: 'HBTC Scouter System' });

    message.reply({ embeds: [embed] });
  }

  // !leaderboard
  if (cmd === 'leaderboard') {
    const sorted = Object.values(users)
      .filter(u => (u.monthlyXP || 0) > 0)
      .sort((a, b) => b.monthlyXP - a.monthlyXP)
      .slice(0, 10);

    let text = '```\n🏆 MONTHLY LEADERBOARD (TOP 10)\n\n';
    sorted.forEach((u, i) => {
      const rank = getRankForXP(u.xp);
      text += `${i + 1}. ${rank.emoji} ${u.name} - ${(u.monthlyXP || 0).toLocaleString()} XP\n`;
    });
    text += '```';

    message.reply(text);
  }

  // !alltimeleaderboard
  if (cmd === 'alltimeleaderboard') {
    const sorted = Object.values(users)
      .filter(u => u.xp > 0)
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);

    let text = '```\n👑 ALL-TIME LEADERBOARD (TOP 10)\n\n';
    sorted.forEach((u, i) => {
      const rank = getRankForXP(u.xp);
      text += `${i + 1}. ${rank.emoji} ${u.name} - ${u.xp.toLocaleString()} XP\n`;
    });
    text += '```';

    message.reply(text);
  }

  // !profile @user
  if (cmd === 'profile') {
    if (!args[1]) return message.reply('Usage: !profile @username');

    const mentioned = message.mentions.users.first() || findUser(args.slice(1).join(' '));
    if (!mentioned) return message.reply('User not found.');

    const targetId = mentioned.id || mentioned;
    const targetUser = users[targetId];

    if (!targetUser) return message.reply('No data for this user yet.');

    const rank = getRankForXP(targetUser.xp);
    const embed = new EmbedBuilder()
      .setColor('#00FF50')
      .setTitle(`📊 ${targetUser.name}'s Profile`)
      .addFields(
        { name: 'Monthly XP', value: `${(targetUser.monthlyXP || 0).toLocaleString()}`, inline: true },
        { name: 'All-Time XP', value: `${targetUser.xp.toLocaleString()}`, inline: true },
        { name: 'Rank', value: `${rank.emoji} ${rank.name}`, inline: true },
        { name: 'Last Active', value: targetUser.lastActive ? new Date(targetUser.lastActive).toLocaleString() : 'Never', inline: true }
      )
      .setFooter({ text: 'HBTC Scouter System' });

    message.reply({ embeds: [embed] });
  }

  // !challenge @user (during stream only)
  if (cmd === 'challenge') {
    if (!args[1]) return message.reply('Usage: !challenge @username');

    const opponent = message.mentions.users.first();
    if (!opponent) return message.reply('User not found. Use !challenge @username');

    const challenger = users[userId];
    const defenderId = opponent.id;
    const defender = users[defenderId];

    if (!challenger || !defender) {
      return message.reply('Both players need data. Keep chatting!');
    }

    try {
      const response = await fetch(`${SCOUTER_SERVER_URL}/api/battle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengerId: userId,
          challengerName: challenger.name,
          defenderId: defenderId,
          defenderName: defender.name,
          source: 'discord',
        }),
      });

      const battleData = await response.json();

      const embed = new EmbedBuilder()
        .setColor('#FF6B35')
        .setTitle('⚔️ BATTLE INITIATED!')
        .addFields(
          { name: 'Challenger', value: `${challenger.name} (${(challenger.xp || 0).toLocaleString()} XP)`, inline: true },
          { name: 'Defender', value: `${defender.name} (${(defender.xp || 0).toLocaleString()} XP)`, inline: true },
          { name: 'Goal', value: '+1500 XP to win', inline: false },
          { name: 'Prize', value: 'Winner: +1650 XP | Loser: -10% XP', inline: false }
        )
        .setFooter({ text: 'HBTC Battle System' });

      message.reply({ embeds: [embed] });
    } catch (e) {
      console.error('Battle creation failed:', e);
      message.reply('Battle system unavailable. Try again later.');
    }
  }
});

client.on('ready', () => {
  console.log(`✅ Discord bot ready as ${client.user.tag}`);
  loadUsers();
});

client.login(DISCORD_TOKEN);
