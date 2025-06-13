// Discord YouTube Audio Bot

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { 
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Only respond to !play commands and ignore bots
  if (!message.content.startsWith('!play') || message.author.bot) return;

  const args = message.content.split(' ').slice(1);
  const query = args.join(' ');

  if (!query) {
    message.channel.send('❌ Please provide search terms.');
    return;
  }

  // Search YouTube for the query
  const searchResult = await ytSearch(query);
  const video = searchResult.videos.length ? searchResult.videos[0] : null;

  if (!video) {
    message.channel.send('❌ No results found.');
    return;
  }

  // Check user is in a voice channel
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    message.channel.send('❌ You need to join a voice channel first!');
    return;
  }

  // Join the voice channel
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator
  });

  // Stream audio from YouTube
  const stream = ytdl(video.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
  const resource = createAudioResource(stream);
  const player = createAudioPlayer();

  // Play the resource
  player.play(resource);
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Playing, () => {
    message.channel.send(`▶️ Now playing: **${video.title}**`);
  });

  player.on('error', (error) => {
    console.error(error);
    message.channel.send('❌ Error: Could not play the audio.');
  });
});

// Log in to Discord using the token in your .env file
client.login(process.env.DISCORD_TOKEN);

/*
.env file contents:
DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
*/
