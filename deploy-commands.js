'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const chessCommand = require('./commands/chess');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ تأكد من ضبط DISCORD_TOKEN و CLIENT_ID في ملف .env');
  process.exit(1);
}

const commands = [chessCommand.data.toJSON()];
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      // Guild-scoped commands update instantly — best for development.
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log(`✅ تم تسجيل الأوامر على السيرفر ${GUILD_ID} (فوري).`);
    } else {
      // Global commands can take up to ~1 hour to propagate.
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('✅ تم تسجيل الأوامر عالميًا (قد تستغرق حتى ساعة للظهور).');
    }
  } catch (err) {
    console.error('❌ فشل تسجيل الأوامر:', err);
    process.exit(1);
  }
})();
