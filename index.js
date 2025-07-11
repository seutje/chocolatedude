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
const listenCommand = require('./commands/listen');
const helpCommand = require('./commands/help');
const askCommand = require('./commands/ask');
const thinkCommand = require('./commands/think');
const imageCommand = require('./commands/image');
const chatCommand = require('./commands/chat');
const musicCommand = require('./commands/music');
const waitCommand = require('./commands/wait');
const gameCommand = require('./commands/game');

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
    } else if (message.content.startsWith('!listen')) {
        await listenCommand(message, serverQueue);
    } else if (message.content.startsWith('!think')) {
        await thinkCommand(message);
    } else if (message.content.startsWith('!chat')) {
        await chatCommand(message);
    } else if (message.content.startsWith('!ask')) {
        await askCommand(message);
    } else if (message.content.startsWith('!image')) {
        await imageCommand(message);
    } else if (message.content.startsWith('!music')) {
        await musicCommand(message);
    } else if (message.content.startsWith('!wait')) {
        waitCommand(message);
    } else if (message.content.startsWith('!game')) {
        gameCommand(message);
    } else if (message.content.startsWith('!help')) {
        helpCommand(message);
    }
});

module.exports = { formatDuration };

if (require.main === module) {
    client.login(process.env.DISCORD_TOKEN);
}
