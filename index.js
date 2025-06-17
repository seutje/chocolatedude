require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const formatDuration = require('./formatDuration');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const serverQueue = new Map();

const playCommand = require('./commands/play');
const skipCommand = require('./commands/skip');
const pauseCommand = require('./commands/pause');
const resumeCommand = require('./commands/resume');
const stopCommand = require('./commands/stop');
const loopCommand = require('./commands/loop');
const queueCommand = require('./commands/queue');
const searchCommand = require('./commands/search');
const shuffleCommand = require('./commands/shuffle');
const removeCommand = require('./commands/remove');
const videoCommand = require('./commands/video');

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    if (message.content.startsWith('!play')) {
        await playCommand(message, serverQueue);
    } else if (message.content.startsWith('!skip')) {
        skipCommand(message, serverQueue);
    } else if (message.content.startsWith('!pause')) {
        pauseCommand(message, serverQueue);
    } else if (message.content.startsWith('!resume')) {
        resumeCommand(message, serverQueue);
    } else if (message.content.startsWith('!stop')) {
        stopCommand(message, serverQueue);
    } else if (message.content.startsWith('!loop')) {
        loopCommand(message, serverQueue);
    } else if (message.content.startsWith('!queue')) {
        await queueCommand(message, serverQueue);
    } else if (message.content.startsWith('!search')) {
        await searchCommand(message);
    } else if (message.content.startsWith('!shuffle')) {
        shuffleCommand(message, serverQueue);
    } else if (message.content.startsWith('!remove')) {
        removeCommand(message, serverQueue);
    } else if (message.content.startsWith('!video')) {
        videoCommand(message, serverQueue);
    }
});

module.exports = { formatDuration };

if (require.main === module) {
    client.login(process.env.DISCORD_TOKEN);
}
