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
// 'loop' can be 'none', 'single', or 'all'
const serverQueue = new Map();

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

/**
 * Formats a duration in seconds into a MM:SS or HH:MM:SS string.
 * @param {number} totalSeconds The total number of seconds.
 * @returns {string} The formatted duration string.
 */
function formatDuration(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds === null) return 'N/A';
    totalSeconds = Math.floor(totalSeconds); // Ensure integer

    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) {
        parts.push(String(hours));
    }
    parts.push(String(minutes).padStart(2, '0'));
    parts.push(String(seconds).padStart(2, '0'));

    return parts.join(':');
}


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
            // Step 1: Determine if it's a URL or a search query
            if (query.startsWith('http')) {
                // It's a URL, now check if it's a playlist
                if (query.includes('list=')) {
                    // It's likely a playlist URL
                    isPlaylist = true;
                    message.channel.send('⏳ Fetching playlist, please wait...');
                    const playlist = await ytpl(query, { limit: 50 }); // Fetch up to 50 videos
                    if (playlist.items.length === 0) {
                        message.channel.send('❌ No videos found in this playlist, or the playlist is empty/private.');
                        return;
                    }
                    songsToAdd = playlist.items.map(item => ({
                        title: item.title,
                        url: item.url,
                        duration: item.duration // ytpl provides duration as a string like "MM:SS"
                    }));
                    // Limit to 50 songs as requested
                    if (songsToAdd.length > 50) {
                        songsToAdd = songsToAdd.slice(0, 50);
                        message.channel.send(`⚠️ Playlist contains more than 50 videos. Only the first 50 will be added.`);
                    }
                } else {
                    // It's a single video URL
                    message.channel.send('⏳ Fetching video info, please wait...');
                    const videoInfo = await ytdl.getInfo(query);
                    songsToAdd.push({
                        title: videoInfo.videoDetails.title,
                        url: videoInfo.videoDetails.video_url,
                        duration: formatDuration(videoInfo.videoDetails.lengthSeconds) // Format seconds to MM:SS
                    });
                }
            } else {
                // It's a search query
                message.channel.send('⏳ Searching for video, please wait...');
                const searchResults = await youtubeSearch.search(query);
                const video = searchResults.length ? searchResults[0] : null;

                if (!video) {
                    message.channel.send('❌ No results found for your query.');
                    return;
                }
                // For search results, we need to fetch info via ytdl to get duration
                const videoInfo = await ytdl.getInfo(video.url);
                songsToAdd.push({
                    title: videoInfo.videoDetails.title,
                    url: videoInfo.videoDetails.video_url,
                    duration: formatDuration(videoInfo.videoDetails.lengthSeconds) // Format seconds to MM:SS
                });
            }
        } catch (error) {
            console.error('Error during YouTube search, playlist fetch, or video info retrieval:', error);
            message.channel.send('❌ An error occurred. Please try again or check the URL/search terms. The video might be age-restricted or unavailable.');
            return;
        }

        if (songsToAdd.length === 0) {
            message.channel.send('❌ No valid videos were found to add to the queue.');
            return;
        }

        // Get the queue for the current guild
        let queueConstruct = serverQueue.get(message.guild.id);

        if (!queueConstruct) {
            const player = createAudioPlayer();
            queueConstruct = {
                textChannel: message.channel,
                voiceChannel: voiceChannel,
                connection: null,
                songs: [],
                player: player,
                volume: 0.10, // Default volume
                playing: true, // Keep track of whether a song is actively playing or paused
                loop: 'none' // Initialize loop status to 'none'
            };

            serverQueue.set(message.guild.id, queueConstruct);
            queueConstruct.songs.push(...songsToAdd); // Add all fetched songs

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator
                });
                queueConstruct.connection = connection;
                connection.subscribe(player); // Subscribe the connection to the player

                // Handle player status changes
                player.on(AudioPlayerStatus.Idle, () => {
                    if (queueConstruct.loop === 'single' && queueConstruct.songs.length > 0) {
                        // If looping single, re-add the current song and play it again
                        play(message.guild, queueConstruct.songs[0]);
                        message.channel.send(`🔁 Looping **${queueConstruct.songs[0].title}** (${queueConstruct.songs[0].duration}).`);
                    } else if (queueConstruct.loop === 'all' && queueConstruct.songs.length > 0) {
                        // If looping all, move the finished song to the end of the queue
                        const finishedSong = queueConstruct.songs.shift();
                        queueConstruct.songs.push(finishedSong);
                        play(message.guild, queueConstruct.songs[0]);
                        message.channel.send(`🔁 Looping entire queue. Now playing: **${queueConstruct.songs[0].title}** (${queueConstruct.songs[0].duration}).`);
                    }
                    else {
                        queueConstruct.songs.shift(); // Remove the finished song
                        if (queueConstruct.songs.length > 0) {
                            play(message.guild, queueConstruct.songs[0]);
                        } else {
                            queueConstruct.connection.destroy();
                            serverQueue.delete(message.guild.id);
                            message.channel.send('⏹️ Queue finished. Leaving voice channel.');
                        }
                    }
                });

                player.on('error', error => {
                    console.error(`Error with audio player: ${error.message}`);
                    message.channel.send('❌ Error: Could not play the audio. Skipping to next song if available.');
                    queueConstruct.songs.shift(); // Skip current song on error
                    if (queueConstruct.songs.length > 0) {
                        play(message.guild, queueConstruct.songs[0]);
                    } else {
                        // Check if connection exists before destroying, as it might have already been destroyed
                        if (queueConstruct.connection && !queueConstruct.connection.destroyed) {
                            queueConstruct.connection.destroy();
                        }
                        serverQueue.delete(message.guild.id);
                        message.channel.send('⏹️ Queue finished. Leaving voice channel.');
                    }
                });

                play(message.guild, queueConstruct.songs[0]);
                if (isPlaylist) {
                    message.channel.send(`🎶 Added **${songsToAdd.length}** songs from the playlist to the queue! Now playing: **${queueConstruct.songs[0].title}** (${queueConstruct.songs[0].duration}).`);
                } else {
                    message.channel.send(`🎵 Now playing: **${queueConstruct.songs[0].title}** (${queueConstruct.songs[0].duration}).`);
                }

            } catch (err) {
                console.error(err);
                serverQueue.delete(message.guild.id);
                message.channel.send('❌ Could not join the voice channel!');
            }
        } else {
            queueConstruct.songs.push(...songsToAdd);
            if (isPlaylist) {
                message.channel.send(`🎵 Added **${songsToAdd.length}** songs from the playlist to the queue!`);
            } else {
                message.channel.send(`🎵 **${songsToAdd[0].title}** (${songsToAdd[0].duration}) has been added to the queue!`);
            }
        }
    }
    // Handler for the !skip command
    else if (message.content.startsWith('!skip')) {
        const queueConstruct = serverQueue.get(message.guild.id);
        if (!queueConstruct || !queueConstruct.songs.length) {
            return message.channel.send('❌ There are no songs in the queue to skip!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to skip music!');
        }

        // Only disable looping if it's set to 'single', preserve 'all'
        if (queueConstruct.loop === 'single') {
            queueConstruct.loop = 'none';
            message.channel.send('🔁 Single song looping disabled due to skip.');
        }
        queueConstruct.player.stop(); // This will trigger the 'idle' event, playing the next song
        message.channel.send('⏭️ Skipped the current song.');
    }
    // Handler for the !pause command
    else if (message.content.startsWith('!pause')) {
        const queueConstruct = serverQueue.get(message.guild.id);
        if (!queueConstruct || queueConstruct.songs.length === 0) {
            return message.channel.send('❌ There is no music currently playing to pause!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to pause music!');
        }

        if (queueConstruct.player.state.status === AudioPlayerStatus.Playing) {
            queueConstruct.player.pause();
            message.channel.send('⏸️ Music paused.');
        } else {
            message.channel.send('❌ Music is not currently playing or is already paused.');
        }
    }
    // Handler for the !resume command
    else if (message.content.startsWith('!resume')) {
        const queueConstruct = serverQueue.get(message.guild.id);
        if (!queueConstruct || queueConstruct.songs.length === 0) {
            return message.channel.send('❌ There is no music to resume!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to resume music!');
        }

        if (queueConstruct.player.state.status === AudioPlayerStatus.Paused) {
            queueConstruct.player.unpause();
            message.channel.send('▶️ Music resumed.');
        } else {
            message.channel.send('❌ Music is not paused.');
        }
    }
    // Handler for the !stop command
    else if (message.content.startsWith('!stop')) {
        const queueConstruct = serverQueue.get(message.guild.id);
        if (!queueConstruct) {
            return message.channel.send('❌ I am not in a voice channel.');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to stop music!');
        }

        queueConstruct.songs = []; // Clear the queue
        queueConstruct.player.stop(); // Stop the current song
        queueConstruct.connection.destroy(); // Destroy the connection
        serverQueue.delete(message.guild.id);
        message.channel.send('⏹️ Stopped playback and left the channel.');
    }
    // !loop command handler
    else if (message.content.startsWith('!loop')) {
        const queueConstruct = serverQueue.get(message.guild.id);
        const args = message.content.split(' ');
        const loopCommand = args[0]; // e.g., "!loop"
        const loopType = args[1] ? args[1].toLowerCase() : null; // e.g., "all", "single"

        if (!queueConstruct || !queueConstruct.songs.length) {
            return message.channel.send('❌ There is no song currently playing to loop!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to toggle looping!');
        }

        if (loopType === 'all') {
            queueConstruct.loop = 'all';
            message.channel.send('🔁 Looping: **Entire queue** is now enabled.');
        } else if (loopType === 'single') {
            queueConstruct.loop = 'single';
            message.channel.send('🔁 Looping: **Single song** is now enabled.');
        } else {
            // Toggle logic for !loop with no arguments
            switch (queueConstruct.loop) {
                case 'none':
                    queueConstruct.loop = 'single';
                    message.channel.send('🔁 Looping: **Single song** is now enabled.');
                    break;
                case 'single':
                    queueConstruct.loop = 'all';
                    message.channel.send('🔁 Looping: **Entire queue** is now enabled.');
                    break;
                case 'all':
                    queueConstruct.loop = 'none';
                    message.channel.send('🔁 Looping: **Disabled**.');
                    break;
            }
        }
    }
    // --- New !queue command handler ---
    else if (message.content.startsWith('!queue')) {
        const queueConstruct = serverQueue.get(message.guild.id);

        if (!queueConstruct || queueConstruct.songs.length === 0) {
            return message.channel.send('ℹ️ The queue is currently empty.');
        }

        const MAX_CHARS = 1900; // Keep a buffer below 2000 for safety
        let messagesToSend = [];
        let currentMessage = '🎶 **Current Music Queue:**\n';

        for (let i = 0; i < queueConstruct.songs.length; i++) {
            const song = queueConstruct.songs[i];
            // Adjust index to be 1-based for display for all songs
            const line = `${i === 0 ? '▶️ **(Now Playing)**' : `${i + 1}.`} ${song.title} (${song.duration || 'N/A'})\n`; // Include duration here

            // If adding the next line exceeds MAX_CHARS, push currentMessage and start a new one
            if (currentMessage.length + line.length > MAX_CHARS) {
                messagesToSend.push(currentMessage);
                currentMessage = '🎶 **Current Music Queue (continued):**\n' + line;
            } else {
                currentMessage += line;
            }
        }
        messagesToSend.push(currentMessage); // Add the last accumulated message

        // Determine the loop status string
        let loopStatusString;
        switch (queueConstruct.loop) {
            case 'none':
                loopStatusString = 'Disabled';
                break;
            case 'single':
                loopStatusString = 'Enabled (Single Song)';
                break;
            case 'all':
                loopStatusString = 'Enabled (Full Queue)';
                break;
            default:
                loopStatusString = 'Unknown';
        }

        // Append looping status to the final message
        messagesToSend[messagesToSend.length - 1] += `\n🔁 Looping: **${loopStatusString}**`;

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
    // --- New !shuffle command handler ---
    else if (message.content.startsWith('!shuffle')) {
        const queueConstruct = serverQueue.get(message.guild.id);

        if (!queueConstruct || queueConstruct.songs.length <= 1) {
            return message.channel.send('❌ Not enough songs in the queue to shuffle!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to shuffle music!');
        }

        // Get the currently playing song
        const currentSong = queueConstruct.songs.shift();

        // Shuffle the rest of the queue using Fisher-Yates (Knuth) shuffle algorithm
        let currentIndex = queueConstruct.songs.length;
        let randomIndex;

        while (currentIndex !== 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;

            // And swap it with the current element.
            [queueConstruct.songs[currentIndex], queueConstruct.songs[randomIndex]] = [
                queueConstruct.songs[randomIndex], queueConstruct.songs[currentIndex]];
        }

        // Put the current song back at the beginning
        queueConstruct.songs.unshift(currentSong);

        message.channel.send('🔀 Queue has been shuffled!');
    }
    // --- New !remove command handler ---
    else if (message.content.startsWith('!remove')) {
        const queueConstruct = serverQueue.get(message.guild.id);
        const args = message.content.split(' ').slice(1);
        const indexToRemove = parseInt(args[0]);

        if (!queueConstruct || queueConstruct.songs.length === 0) {
            return message.channel.send('❌ The queue is empty. Nothing to remove!');
        }
        if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
            return message.channel.send('❌ You must be in the same voice channel as the bot to remove music!');
        }

        if (isNaN(indexToRemove) || indexToRemove < 1) {
            return message.channel.send('❌ Please provide a valid song number to remove (e.g., `!remove 2`).');
        }

        if (indexToRemove === 1) {
            // If index is 1, it means skip the current song
            if (queueConstruct.loop === 'single') {
                queueConstruct.loop = 'none';
                message.channel.send('🔁 Single song looping disabled due to skip.');
            }
            queueConstruct.player.stop(); // This will trigger the 'idle' event, playing the next song
            message.channel.send('🗑️ Skipped the current song.');
        } else {
            // Adjust for 0-based array index (user input is 1-based)
            const actualIndex = indexToRemove - 1;

            if (actualIndex >= queueConstruct.songs.length) {
                return message.channel.send('❌ That song number does not exist in the queue.');
            }

            const removedSong = queueConstruct.songs.splice(actualIndex, 1);
            if (removedSong.length > 0) {
                message.channel.send(`🗑️ Removed **${removedSong[0].title}** from the queue.`);
            } else {
                message.channel.send('❌ Could not remove the song. Please try again.');
            }
        }
    }
});

/**
 * Plays the given song for the specified guild.
 * @param {object} guild The guild object.
 * @param {object} song The song object to play.
 */
function play(guild, song) {
    const queueConstruct = serverQueue.get(guild.id);
    if (!song) {
        // If no more songs, disconnect and clean up
        queueConstruct.connection.destroy();
        serverQueue.delete(guild.id);
        return;
    }

    // Increased highWaterMark to 2^26 (64 MB)
    const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 26 });
    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(queueConstruct.volume);

    queueConstruct.player.play(resource);
    // Include song duration in the "Now playing" message
    queueConstruct.textChannel.send(`▶️ Now playing: **${song.title}** (${song.duration || 'N/A'}).`);
}

// Log in to Discord using the token in your .env file
client.login(process.env.DISCORD_TOKEN);
