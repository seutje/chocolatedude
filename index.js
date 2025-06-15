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
// Import the new package instead of yt-search
const youtubeSearch = require('youtube-search-without-api-key');
// Import ytpl for playlist support
const ytpl = require('ytpl');

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
// Key: guildId, Value: { textChannel, voiceChannel, connection, songs: [], player, volume, playing, loop }
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
            message.channel.send('❌ Please provide search terms or a YouTube URL.');
            return;
        }

        // Check user is in a voice channel
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            message.channel.send('❌ You need to join a voice channel first!');
            return;
        }

        let songsToAdd = []; // Array to hold songs fetched from either single video or playlist
        let isPlaylist = false;

        try {
            // Check if the query is a YouTube playlist URL or ID
            const playlistId = await ytpl.getPlaylistID(query); // Tries to extract ID from URL or directly validates ID
            if (playlistId) {
                isPlaylist = true;
                message.channel.send('⏳ Fetching playlist, please wait...');
                const playlist = await ytpl(playlistId, { limit: 50 }); // Fetch up to 50 videos
                if (playlist.items.length === 0) {
                    message.channel.send('❌ No videos found in this playlist, or the playlist is empty/private.');
                    return;
                }
                songsToAdd = playlist.items.map(item => ({
                    title: item.title,
                    url: item.url,
                }));
                // Limit to 50 songs as requested
                if (songsToAdd.length > 50) {
                    songsToAdd = songsToAdd.slice(0, 50);
                    message.channel.send(`⚠️ Playlist contains more than 50 videos. Only the first 50 will be added.`);
                }
            } else {
                // If not a playlist, search for a single video
                const searchResults = await youtubeSearch.search(query);
                const video = searchResults.length ? searchResults[0] : null;

                if (!video) {
                    message.channel.send('❌ No results found for your query.');
                    return;
                }
                songsToAdd.push({
                    title: video.title,
                    url: video.url,
                });
            }
        } catch (error) {
            console.error('Error during YouTube search or playlist fetch:', error);
            message.channel.send('❌ An error occurred during the search or playlist fetch. Please try again or check the URL.');
            return;
        }

        if (songsToAdd.length === 0) {
            message.channel.send('❌ No valid videos were found to add to the queue.');
            return;
        }

        // Get the queue for the current guild
        let queueContruct = serverQueue.get(message.guild.id);

        if (!queueContruct) {
            const player = createAudioPlayer();
            queueContruct = {
                textChannel: message.channel,
                voiceChannel: voiceChannel,
                connection: null,
                songs: [],
                player: player,
                volume: 0.10, // Default volume
                playing: true, // Keep track of whether a song is actively playing or paused
                loop: false // Add loop property, default to false
            };

            serverQueue.set(message.guild.id, queueContruct);
            queueContruct.songs.push(...songsToAdd); // Add all fetched songs

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
                    if (queueContruct.loop && queueContruct.songs.length > 0) {
                        // If loop is true, re-add the current song to the front of the queue
                        // and play it again without shifting it out.
                        play(message.guild, queueContruct.songs[0]);
                        message.channel.send(`🔁 Looping **${queueContruct.songs[0].title}**.`);
                    } else {
                        queueContruct.songs.shift(); // Remove the finished song
                        if (queueContruct.songs.length > 0) {
                            play(message.guild, queueContruct.songs[0]);
                        } else {
                            queueContruct.connection.destroy();
                            serverQueue.delete(message.guild.id);
                            message.channel.send('⏹️ Queue finished. Leaving voice channel.');
                        }
                    }
                });

                player.on('error', error => {
                    console.error(`Error with audio player: ${error.message}`);
                    message.channel.send('❌ Error: Could not play the audio. Skipping to next song if available.');
                    queueContruct.songs.shift(); // Skip current song on error
                    if (queueContruct.songs.length > 0) {
                        play(message.guild, queueContruct.songs[0]);
                    } else {
                        // Check if connection exists before destroying, as it might have already been destroyed
                        if (queueContruct.connection && !queueContruct.connection.destroyed) {
                            queueContruct.connection.destroy();
                        }
                        serverQueue.delete(message.guild.id);
                        message.channel.send('⏹️ Queue finished. Leaving voice channel.');
                    }
                });

                play(message.guild, queueContruct.songs[0]);
                if (isPlaylist) {
                    message.channel.send(`🎶 Added **${songsToAdd.length}** songs from the playlist to the queue! Now playing: **${queueContruct.songs[0].title}**`);
                } else {
                    message.channel.send(`🎵 Now playing: **${queueContruct.songs[0].title}**`);
                }

            } catch (err) {
                console.error(err);
                serverQueue.delete(message.guild.id);
                message.channel.send('❌ Could not join the voice channel!');
            }
        } else {
            queueContruct.songs.push(...songsToAdd);
            if (isPlaylist) {
                message.channel.send(`🎵 Added **${songsToAdd.length}** songs from the playlist to the queue!`);
            } else {
                message.channel.send(`🎵 **${songsToAdd[0].title}** has been added to the queue!`);
            }
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

        // If looping, disable it before skipping to prevent looping the skipped song
        if (queueContruct.loop) {
            queueContruct.loop = false;
            message.channel.send('🔁 Loop disabled due to skip.');
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
    // !loop command handler
    else if (message.content.startsWith('!loop')) {
        const queueContruct = serverQueue.get(message.guild.id);

        if (!queueContruct || !queueContruct.songs.length) {
            return message.channel.send('❌ There is no song currently playing to loop!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueContruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to toggle looping!');
        }

        queueContruct.loop = !queueContruct.loop; // Toggle the loop state
        message.channel.send(`🔁 Looping is now **${queueContruct.loop ? 'enabled' : 'disabled'}**.`);
    }
    // --- New !queue command handler ---
    else if (message.content.startsWith('!queue')) {
        const queueContruct = serverQueue.get(message.guild.id);

        if (!queueContruct || queueContruct.songs.length === 0) {
            return message.channel.send('ℹ️ The queue is currently empty.');
        }

        const MAX_CHARS = 1900; // Keep a buffer below 2000 for safety
        let messagesToSend = [];
        let currentMessage = '🎶 **Current Music Queue:**\n';

        for (let i = 0; i < queueContruct.songs.length; i++) {
            const song = queueContruct.songs[i];
            const line = `${i === 0 ? '▶️ **(Now Playing)**' : `${i + 1}.`} ${song.title}\n`;

            if (currentMessage.length + line.length > MAX_CHARS) {
                messagesToSend.push(currentMessage);
                currentMessage = '🎶 **Current Music Queue (continued):**\n' + line;
            } else {
                currentMessage += line;
            }
        }
        messagesToSend.push(currentMessage); // Add the last accumulated message

        // Append looping status to the final message
        messagesToSend[messagesToSend.length - 1] += `\n🔁 Looping: **${queueContruct.loop ? 'Enabled' : 'Disabled'}**`;

        // Send all messages
        for (const msg of messagesToSend) {
            await message.channel.send(msg);
        }
    }
    // --- New !search command handler ---
    else if (message.content.startsWith('!search')) {
        const args = message.content.split(' ').slice(1);
        const query = args.join(' ');

        if (!query) {
            return message.channel.send('❌ Please provide search terms for the search command.');
        }

        try {
            const searchResults = await youtubeSearch.search(query);

            if (!searchResults.length) {
                return message.channel.send('❌ No search results found for your query.');
            }

            let responseMessage = '🔍 **Top 10 YouTube Search Results:**\n';
            searchResults.slice(0, 10).forEach((result, index) => {
                responseMessage += `${index + 1}. **${result.title}**\n   URL: <${result.url}>\n`;
            });

            message.channel.send(responseMessage);
        } catch (error) {
            console.error('Error during YouTube search for !search command:', error);
            message.channel.send('❌ An error occurred while performing the search. Please try again.');
        }
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

    // Increased highWaterMark to 2^26 (64 MB)
    const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 26 });
    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(queueContruct.volume);

    queueContruct.player.play(resource);
    queueContruct.textChannel.send(`▶️ Now playing: **${song.title}**`);
}

// Log in to Discord using the token in your .env file
client.login(process.env.DISCORD_TOKEN);
