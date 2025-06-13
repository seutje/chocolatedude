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

// A Map to store queues for different guilds.
// Key: guildId, Value: { textChannel, voiceChannel, connection, songs: [], player, volume, playing }
const serverQueue = new Map();

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

        // Check user is in a voice channel
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            message.channel.send('❌ You need to join a voice channel first!');
            return;
        }

        // Search YouTube for the query
        const searchResult = await ytSearch(query);
        const video = searchResult.videos.length ? searchResult.videos[0] : null;

        if (!video) {
            message.channel.send('❌ No results found.');
            return;
        }

        // Get the queue for the current guild
        let queueContruct = serverQueue.get(message.guild.id);

        const song = {
            title: video.title,
            url: video.url,
            duration: video.duration.timestamp // Add duration for potential future use
        };

        if (!queueContruct) {
            const player = createAudioPlayer();
            queueContruct = {
                textChannel: message.channel,
                voiceChannel: voiceChannel,
                connection: null,
                songs: [],
                player: player,
                volume: 0.10, // Default volume
                playing: true // Keep track of whether a song is actively playing or paused
            };

            serverQueue.set(message.guild.id, queueContruct);
            queueContruct.songs.push(song);

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator
                });
                queueContruct.connection = connection;
                connection.subscribe(player); // Subscribe the connection to the player

                // Handle player status changes
                player.on(AudioPlayerStatus.Idle, () => {
                    queueContruct.songs.shift(); // Remove the finished song
                    if (queueContruct.songs.length > 0) {
                        play(message.guild, queueContruct.songs[0]);
                    } else {
                        queueContruct.connection.destroy();
                        serverQueue.delete(message.guild.id);
                        message.channel.send('⏹️ Queue finished. Leaving voice channel.');
                    }
                });

                player.on('error', error => {
                    console.error(`Error with audio player: ${error.message}`);
                    message.channel.send('❌ Error: Could not play the audio. Skipping to next song if available.');
                    queueContruct.songs.shift(); // Skip current song on error
                    if (queueContruct.songs.length > 0) {
                        play(message.guild, queueContruct.songs[0]);
                    } else {
                        queueContruct.connection.destroy();
                        serverQueue.delete(message.guild.id);
                        message.channel.send('⏹️ Queue finished. Leaving voice channel.');
                    }
                });

                play(message.guild, queueContruct.songs[0]);
            } catch (err) {
                console.error(err);
                serverQueue.delete(message.guild.id);
                message.channel.send('❌ Could not join the voice channel!');
            }
        } else {
            queueContruct.songs.push(song);
            message.channel.send(`🎵 **${song.title}** has been added to the queue!`);
        }
    }
    // Handler for the !skip command
    else if (message.content.startsWith('!skip')) {
        const queueContruct = serverQueue.get(message.guild.id);
        if (!queueContruct || !queueContruct.songs.length) {
            return message.channel.send('❌ There are no songs in the queue to skip!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueContruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to skip music!');
        }

        queueContruct.player.stop(); // This will trigger the 'idle' event, playing the next song
        message.channel.send('⏭️ Skipped the current song.');
    }
    // Handler for the !pause command
    else if (message.content.startsWith('!pause')) {
        const queueContruct = serverQueue.get(message.guild.id);
        if (!queueContruct || queueContruct.songs.length === 0) {
            return message.channel.send('❌ There is no music currently playing to pause!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueContruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to pause music!');
        }

        if (queueContruct.player.state.status === AudioPlayerStatus.Playing) {
            queueContruct.player.pause();
            message.channel.send('⏸️ Music paused.');
        } else {
            message.channel.send('❌ Music is not currently playing or is already paused.');
        }
    }
    // Handler for the !resume command
    else if (message.content.startsWith('!resume')) {
        const queueContruct = serverQueue.get(message.guild.id);
        if (!queueContruct || queueContruct.songs.length === 0) {
            return message.channel.send('❌ There is no music to resume!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueContruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to resume music!');
        }

        if (queueContruct.player.state.status === AudioPlayerStatus.Paused) {
            queueContruct.player.unpause();
            message.channel.send('▶️ Music resumed.');
        } else {
            message.channel.send('❌ Music is not paused.');
        }
    }
    // Handler for the !stop command
    else if (message.content.startsWith('!stop')) {
        const queueContruct = serverQueue.get(message.guild.id);
        if (!queueContruct) {
            return message.channel.send('❌ I am not in a voice channel.');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueContruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to stop music!');
        }

        queueContruct.songs = []; // Clear the queue
        queueContruct.player.stop(); // Stop the current song
        queueContruct.connection.destroy(); // Destroy the connection
        serverQueue.delete(message.guild.id);
        message.channel.send('⏹️ Stopped playback and left the channel.');
    }
});

/**
 * Plays the given song for the specified guild.
 * @param {object} guild The guild object.
 * @param {object} song The song object to play.
 */
function play(guild, song) {
    const queueContruct = serverQueue.get(guild.id);
    if (!song) {
        // If no more songs, disconnect and clean up
        queueContruct.connection.destroy();
        serverQueue.delete(guild.id);
        return;
    }

    const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(queueContruct.volume);

    queueContruct.player.play(resource);
    queueContruct.textChannel.send(`▶️ Now playing: **${song.title}**`);
}

// Log in to Discord using the token in your .env file
client.login(process.env.DISCORD_TOKEN);