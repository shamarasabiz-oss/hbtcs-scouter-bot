import 'dotenv/config.js';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { TikTokLive } from '@tiktool/live';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

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
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['King', 'Emperor', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Kakarot', 'Monkey King', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['7', '6', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['King Kai', 'Kami', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Tri-Beam', 'Kamehameha'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What form did Goku achieve against Frieza?', a: 'c', d: 'easy', opts: ['SSJ2', 'Super Saiyan', 'Ultra Instinct'] },
  { q: 'How many forms does Frieza have?', a: 'b', d: 'easy', opts: ['5', '4', '3'] },
  { q: 'Who is Trunks\' father?', a: 'a', d: 'easy', opts: ['Goku', 'Vegeta', 'Gohan'] },
  { q: 'What is the name of the fusion technique?', a: 'c', d: 'easy', opts: ['Metamoran', 'Fusion Dance', 'Dance Fusion'] },
  { q: 'How long was Goku dead after Cell saga?', a: 'c', d: 'easy', opts: ['10 years', '1 year', '7 years'] },
  { q: 'Who killed King Kai?', a: 'b', d: 'easy', opts: ['Nappa', 'Vegeta', 'Frieza'] },
  { q: 'What is Android 17\'s real name?', a: 'c', d: 'easy', opts: ['Lapis', 'Lazuli', 'Seventeen'] },
  { q: 'What is the Saiyan race weakness?', a: 'b', d: 'easy', opts: ['Water', 'Electricity', 'Moonlight'] },
  { q: 'Who is the God of Destruction for Universe 7?', a: 'a', d: 'easy', opts: ['Champa', 'Toppo', 'Beerus'] },
  { q: 'What technique does Goku learn from King Kai?', a: 'a', d: 'easy', opts: ['Both', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is the exact name of Goku\'s final form?', a: 'a', d: 'easy', opts: ['Ultra Instinct', 'Mastered Ultra Instinct', 'Perfected Blue'] },
  { q: 'How many universes are there in Super?', a: 'c', d: 'easy', opts: ['12', '18', '10'] },
  { q: 'What color is Ultra Instinct aura?', a: 'b', d: 'easy', opts: ['White/Silver', 'Blue', 'Red'] },
  { q: 'Who created the Potara earrings?', a: 'c', d: 'easy', opts: ['Supreme Kai', 'Old Kaioshin', 'Beerus'] },
  { q: 'What is the exact number of Tournament of Power warriors?', a: 'a', d: 'easy', opts: ['10', '11', '12'] },
  { q: 'What is Goku\'s exact power level during Ultra Instinct vs Jiren?', a: 'b', d: 'easy', opts: ['15 billion', 'Over 18 trillion', 'Unmeasurable'] },
  { q: 'How many times did Goku train with King Kai?', a: 'b', d: 'easy', opts: ['Once', 'Twice', 'Three times'] },
  { q: 'Who created the Red Star Dragon Balls?', a: 'a', d: 'easy', opts: ['Super 17', 'Old Namek', 'Kami'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Namek', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Spirit Bomb', 'Kaioken', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Scientist', 'Martial Arts Master', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Grandpa Gohan', 'Master Roshi', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Teacher', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Old man Gohan', 'Kami', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Blue', 'Red', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['King', 'Emperor', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Gohan', 'Vegeta', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['7', '6', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Red', 'Yellow', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Human', 'Demon', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Emperor', 'King', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Vegeta Jr', 'Gohan', 'Goten'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Scientist', 'Warrior', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Prince', 'King', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Monkey King', 'Son Goku', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Vegeta', 'Gohan', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Planet Vegeta', 'Namek', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'King', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Krillin', 'Master Roshi', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kaioken', 'Kamehameha', 'Spirit Bomb'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['8', '6', '7'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Old man Gohan', 'Kami', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['King', 'Emperor', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Kakarot', 'Monkey King', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['King Kai', 'Kami', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Chi-Chi', 'Android 18', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Scientist', 'King', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Vegeta', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Blue', 'Yellow', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Scientist', 'King', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Demon', 'Human'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Gohan', 'Vegeta', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['7', '8', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'Kami', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Earth', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kamehameha', 'Kaioken', 'Spirit Bomb'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '6', '7'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Namek', 'Earth', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['King', 'Emperor', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Red', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['King Kai', 'Kami', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Spirit Bomb', 'Kaioken', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Red', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Vegeta', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '6', '7'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Scientist', 'King', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Human', 'Demon', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Gohan', 'Vegeta Jr', 'Goten'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Tri-Beam', 'Kamehameha'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Scientist', 'Warrior', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Chi-Chi', 'Android 18', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Planet Vegeta', 'Earth', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'King', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Gohan', 'Vegeta', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['King Kai', 'Kami', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Android 18', 'Chi-Chi'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['7', '6', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['King Kai', 'Old man Gohan', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Earth', 'Namek', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Red', 'Yellow', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Tri-Beam', 'Kamehameha'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Scientist', 'Martial Arts Master', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Kakarot', 'Monkey King', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Grandpa Gohan', 'Master Roshi', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Prince', 'King', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Scientist', 'Warrior', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Human', 'Demon', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Kakarot', 'Monkey King', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Planet Vegeta', 'Namek', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Monkey King', 'Son Goku', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Gohan', 'Vegeta', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Planet Vegeta', 'Namek', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Blue', 'Yellow', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Kakarot', 'Monkey King', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Krillin', 'Gohan', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['7', '6', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Scientist', 'Teacher', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['King Kai', 'Kami', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Red', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Scientist', 'Martial Arts Master', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Red', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Android 18', 'Chi-Chi'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kamehameha', 'Kaioken', 'Spirit Bomb'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'King', 'Scientist'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['7', '6', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Earth', 'Namek', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Red', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'King', 'Scientist'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Monkey King', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['7', '8', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Planet Vegeta', 'Earth', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Blue', 'Red', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Android 18', 'Bulma', 'Chi-Chi'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kaioken', 'Kamehameha', 'Spirit Bomb'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Human', 'Demon', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Prince', 'King', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Gohan', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Kami', 'Old man Gohan', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Namek', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Chi-Chi', 'Android 18', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kaioken', 'Kamehameha', 'Spirit Bomb'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Scientist', 'Martial Arts Master', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['King Kai', 'Kami', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Prince', 'King', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Gohan', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Teacher', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Tri-Beam', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Monkey King', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['7', '6', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['King Kai', 'Kami', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Planet Vegeta', 'Earth', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Tri-Beam', 'Destructo Disc', 'Kamehameha'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Chi-Chi', 'Android 18', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Spirit Bomb', 'Kaioken', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Planet Vegeta', 'Namek', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Red', 'Yellow', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Grandpa Gohan', 'Master Roshi', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Emperor', 'King', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['7', '6', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['King Kai', 'Kami', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Blue', 'Red', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Bulma', 'Chi-Chi'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Martial Arts Master', 'Scientist'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['King', 'Martial Arts Master', 'Scientist'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Demon', 'Namekian', 'Human'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Old man Gohan', 'Kami', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Planet Vegeta', 'Earth', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Gohan', 'Goten'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Vegeta', 'Gohan', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Tri-Beam', 'Destructo Disc', 'Kamehameha'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Martial Arts Master', 'Scientist'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Tri-Beam', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Demon', 'Namekian', 'Human'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Son Goku', 'Monkey King', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Krillin', 'Gohan', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Blue', 'Red', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Krillin', 'Master Roshi', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Human', 'Demon', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Prince', 'King', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Monkey King', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Scientist', 'Teacher', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Earth', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Blue', 'Red', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Spirit Bomb', 'Kaioken', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Son Goku', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Earth', 'Namek', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Tri-Beam', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Goten', 'Vegeta Jr', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Kakarot', 'Monkey King', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['8', '6', '7'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Warrior', 'Teacher', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'Old man Gohan', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Krillin', 'Master Roshi', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Scientist', 'Martial Arts Master', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Demon', 'Namekian', 'Human'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['King', 'Emperor', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Son Goku', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['7', '6', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Tri-Beam', 'Destructo Disc', 'Kamehameha'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Android 18', 'Chi-Chi'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['King', 'Martial Arts Master', 'Scientist'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Prince', 'King', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Vegeta', 'Gohan', 'Krillin'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Earth', 'Planet Vegeta'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Scientist', 'Martial Arts Master', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Scientist', 'Warrior', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Planet Vegeta', 'Namek', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Red', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Master Roshi', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Spirit Bomb', 'Kaioken', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['8', '6', '7'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Kaioken', 'Spirit Bomb'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Scientist', 'Martial Arts Master', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Gohan', 'Vegeta Jr', 'Goten'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '8', '7'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Red', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Grandpa Gohan', 'Krillin', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Spirit Bomb', 'Kaioken', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Goten', 'Vegeta Jr', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Monkey King', 'Son Goku', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['King Kai', 'Old man Gohan', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Spirit Bomb', 'Kaioken', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'King', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Monkey King', 'Son Goku', 'Kakarot'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Demon', 'Human', 'Namekian'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Scientist', 'Teacher', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['King Kai', 'Old man Gohan', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'c', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '6', '7'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'Kami', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'b', d: 'easy', opts: ['Planet Vegeta', 'Namek', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Blue', 'Yellow', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'a', d: 'easy', opts: ['Master Roshi', 'Krillin', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'a', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Scientist', 'King', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Demon', 'Human'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Goten', 'Vegeta Jr', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Krillin', 'Gohan', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'Old man Gohan', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Blue', 'Red', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['King', 'Scientist', 'Martial Arts Master'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Prince', 'King', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Goten', 'Gohan', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Teacher', 'Warrior', 'Scientist'] },
  { q: 'Who created the Dragon Balls?', a: 'c', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Earth', 'Planet Vegeta', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Grandpa Gohan', 'Master Roshi', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Android 18', 'Bulma', 'Chi-Chi'] },
  { q: 'What is Goku\'s signature move?', a: 'a', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Human', 'Namekian', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'b', d: 'easy', opts: ['Goten', 'Vegeta Jr', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'a', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Scientist', 'Teacher', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Kami', 'Old man Gohan', 'King Kai'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Red', 'Yellow', 'Blue'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'b', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Spirit Bomb', 'Kaioken', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'King', 'Scientist'] },
  { q: 'What race is Piccolo?', a: 'a', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'a', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Kakarot', 'Son Goku', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Scientist', 'Warrior', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Destructo Disc', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Android 18', 'Chi-Chi', 'Bulma'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Kaioken', 'Kamehameha', 'Spirit Bomb'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'Prince', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'b', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['6', '7', '8'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Namek', 'Planet Vegeta', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'b', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Krillin', 'Master Roshi', 'Grandpa Gohan'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Chi-Chi', 'Bulma', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kamehameha', 'Spirit Bomb', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Demon', 'Human'] },
  { q: 'What is Vegeta\'s royal title?', a: 'a', d: 'easy', opts: ['King', 'Prince', 'Emperor'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'a', d: 'easy', opts: ['Krillin', 'Vegeta', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['8', '7', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'a', d: 'easy', opts: ['Teacher', 'Scientist', 'Warrior'] },
  { q: 'Who created the Dragon Balls?', a: 'b', d: 'easy', opts: ['Old man Gohan', 'King Kai', 'Kami'] },
  { q: 'What planet is Vegeta from?', a: 'a', d: 'easy', opts: ['Planet Vegeta', 'Earth', 'Namek'] },
  { q: 'What color is Super Saiyan hair?', a: 'c', d: 'easy', opts: ['Red', 'Blue', 'Yellow'] },
  { q: 'Who trained Goku as a child?', a: 'c', d: 'easy', opts: ['Krillin', 'Grandpa Gohan', 'Master Roshi'] },
  { q: 'What is Krillin\'s signature move?', a: 'b', d: 'easy', opts: ['Destructo Disc', 'Kamehameha', 'Tri-Beam'] },
  { q: 'Who is Gohan\'s mother?', a: 'c', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'b', d: 'easy', opts: ['Kaioken', 'Spirit Bomb', 'Kamehameha'] },
  { q: 'What is Master Roshi\'s job?', a: 'a', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'b', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'c', d: 'easy', opts: ['Prince', 'Emperor', 'King'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Vegeta Jr', 'Goten', 'Gohan'] },
  { q: 'What is Goku\'s real name?', a: 'c', d: 'easy', opts: ['Son Goku', 'Kakarot', 'Monkey King'] },
  { q: 'Who is Goku\'s best friend?', a: 'c', d: 'easy', opts: ['Vegeta', 'Krillin', 'Gohan'] },
  { q: 'How many Dragon Balls are there?', a: 'c', d: 'easy', opts: ['6', '8', '7'] },
  { q: 'What is Bulma\'s profession?', a: 'c', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
  { q: 'Who created the Dragon Balls?', a: 'a', d: 'easy', opts: ['Kami', 'King Kai', 'Old man Gohan'] },
  { q: 'What planet is Vegeta from?', a: 'c', d: 'easy', opts: ['Planet Vegeta', 'Namek', 'Earth'] },
  { q: 'What color is Super Saiyan hair?', a: 'a', d: 'easy', opts: ['Yellow', 'Blue', 'Red'] },
  { q: 'Who trained Goku as a child?', a: 'b', d: 'easy', opts: ['Master Roshi', 'Grandpa Gohan', 'Krillin'] },
  { q: 'What is Krillin\'s signature move?', a: 'c', d: 'easy', opts: ['Tri-Beam', 'Kamehameha', 'Destructo Disc'] },
  { q: 'Who is Gohan\'s mother?', a: 'a', d: 'easy', opts: ['Bulma', 'Chi-Chi', 'Android 18'] },
  { q: 'What is Goku\'s signature move?', a: 'c', d: 'easy', opts: ['Spirit Bomb', 'Kamehameha', 'Kaioken'] },
  { q: 'What is Master Roshi\'s job?', a: 'b', d: 'easy', opts: ['Martial Arts Master', 'Scientist', 'King'] },
  { q: 'What race is Piccolo?', a: 'c', d: 'easy', opts: ['Namekian', 'Human', 'Demon'] },
  { q: 'What is Vegeta\'s royal title?', a: 'b', d: 'easy', opts: ['Emperor', 'King', 'Prince'] },
  { q: 'Who is Goku\'s first son?', a: 'c', d: 'easy', opts: ['Gohan', 'Goten', 'Vegeta Jr'] },
  { q: 'What is Goku\'s real name?', a: 'a', d: 'easy', opts: ['Monkey King', 'Kakarot', 'Son Goku'] },
  { q: 'Who is Goku\'s best friend?', a: 'b', d: 'easy', opts: ['Gohan', 'Krillin', 'Vegeta'] },
  { q: 'How many Dragon Balls are there?', a: 'b', d: 'easy', opts: ['7', '8', '6'] },
  { q: 'What is Bulma\'s profession?', a: 'b', d: 'easy', opts: ['Warrior', 'Scientist', 'Teacher'] },
];;

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
      
      const t = TRIVIAS[Math.floor(Math.random() * TRIVIAS.length)];
      triviaActive = { question: t.q, answer: t.a, difficulty: t.d, a: t.opts[0], b: t.opts[1], c: t.opts[2], d: t.d };
      triviaAnswered = false;
      
      console.log(`  ✓ Starting ${t.d} trivia`);
      const triviaEmbed = {
        color: 0x9966FF,
        title: `🧠 TRIVIA [${t.d.toUpperCase()}]`,
        description: t.q,
        fields: [
          { name: 'A', value: t.opts[0], inline: true },
          { name: 'B', value: t.opts[1], inline: true },
          { name: 'C', value: t.opts[2], inline: true },
          { name: '⏱️ How to Answer', value: 'Type **a**, **b**, or **c** (no ! prefix)', inline: false }
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
  if (!tiktokConnected) return;
  
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
  if (global.broadcastToOverlay) {
    global.broadcastToOverlay({
      type: 'activity',
      action: 'like',
      userId,
      name: users[userId].name,
      xp: 100,
      entry: {
        id: users[userId].id,
        name: users[userId].name,
        xp: users[userId].xp,
        rankId: 0,
        rankName: 'N/A',
        position: null
      }
    });
  }
});

tiktok.on('follow', (data) => {
  if (!tiktokConnected) return;
  
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
  if (global.broadcastToOverlay) {
    global.broadcastToOverlay({
      type: 'activity',
      action: 'follow',
      userId,
      name: users[userId].name,
      xp: 2000,
      entry: {
        id: users[userId].id,
        name: users[userId].name,
        xp: users[userId].xp,
        rankId: 0,
        rankName: 'N/A',
        position: null
      }
    });
  }
});

tiktok.on('gift', (data) => {
  if (!tiktokConnected) return;
  
  const userId = resolveId(data.uniqueId);
  const giftValue = data.giftValue || 1;
  const xpAwarded = giftValue * 10;
  
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      name: data.uniqueId,
      xp: xpAwarded,
      comments: 0,
      gifts: 1,
      follows: 0,
      likes: 0,
      shares: 0,
      aliases: [],
      donated: giftValue
    };
  } else {
    users[userId].xp += xpAwarded;
    users[userId].gifts = (users[userId].gifts || 0) + 1;
    users[userId].donated = (users[userId].donated || 0) + giftValue;
  }
  saveData();
  console.log(`🎁 Gift from ${data.uniqueId}: ${giftValue} coins, +${xpAwarded} XP`);
  if (global.broadcastToOverlay) {
    global.broadcastToOverlay({
      type: 'activity',
      action: 'gift',
      userId,
      name: users[userId].name,
      xp: xpAwarded,
      coins: giftValue,
      entry: {
        id: users[userId].id,
        name: users[userId].name,
        xp: users[userId].xp,
        rankId: 0,
        rankName: 'N/A',
        position: null
      }
    });
  }
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
    if (global.broadcastToOverlay) {
      global.broadcastToOverlay({
        type: 'activity',
        action: 'comment',
        userId: tiktokId,
        name: users[tiktokId].name,
        xp: commentXp,
        entry: {
          id: users[tiktokId].id,
          name: users[tiktokId].name,
          xp: users[tiktokId].xp,
          rankId: 0,
          rankName: 'N/A',
          position: null
        }
      });
    }
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

// ═══════════════════════════════════════════════════════════
// WEBSOCKET SERVER FOR OVERLAY
// ═══════════════════════════════════════════════════════════
const PORT = process.env.PORT || 8080;
const wsApp = express();
const wsServer = createServer(wsApp);
let wss = new WebSocketServer({ server: wsServer });

wsApp.use(express.static('.'));
wsApp.get('/', (req, res) => res.sendFile('leaderboard-overlay.html', { root: '.' }));

wss.on('connection', (ws) => {
  console.log('📊 Overlay connected');
});

wsServer.listen(PORT, () => console.log(`🌐 Scouter → http://localhost:${PORT}`));

// Broadcast function
global.broadcastToOverlay = function(data) {
  if (!wss || !wss.clients) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    try { if (client.readyState === 1) client.send(msg); } catch (e) {}
  });
};
