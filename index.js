// Discord YouTube Audio Bot

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { 
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection
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

// Store the audio player globally to be accessible for the stop command
const player = createAudioPlayer();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  // Handler for the !play command
  if (message.content.startsWith('!play')) {
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
    
    // Set the volume to 25%
    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(0.25); 

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
  } 
  // Handler for the !stop command
  else if (message.content.startsWith('!stop')) {
    // Get the current voice connection
    const connection = getVoiceConnection(message.guild.id);

    if (connection) {
      // Stop the player and destroy the connection
      player.stop();
      connection.destroy();
      message.channel.send('⏹️ Stopped playback and left the channel.');
    } else {
      message.channel.send('❌ I am not in a voice channel.');
    }
  }
});

// Log in to Discord using the token in your .env file
client.login(process.env.DISCORD_TOKEN);