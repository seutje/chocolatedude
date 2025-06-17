const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const youtubeSearch = require('youtube-search-without-api-key');
const ytpl = require('ytpl');
const formatDuration = require('../formatDuration');

function play(guild, song, serverQueue) {
    const queueConstruct = serverQueue.get(guild.id);
    if (!song) {
        queueConstruct.connection.destroy();
        serverQueue.delete(guild.id);
        return;
    }

    const filterType = queueConstruct.streamVideo ? 'audioandvideo' : 'audioonly';
    const stream = ytdl(song.url, { filter: filterType, highWaterMark: 1 << 26 });
    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(queueConstruct.volume);

    queueConstruct.player.play(resource);
    queueConstruct.textChannel.send(`▶️ Now playing: **${song.title}** (${song.duration || 'N/A'}).`);
}

module.exports = async function (message, serverQueue) {
    const args = message.content.split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        message.channel.send('❌ Please provide search terms or a YouTube URL.');
        return;
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        message.channel.send('❌ You need to join a voice channel first!');
        return;
    }

    let songsToAdd = [];
    let isPlaylist = false;

    try {
        if (query.startsWith('http')) {
            if (query.includes('list=')) {
                isPlaylist = true;
                message.channel.send('⏳ Fetching playlist, please wait...');
                const playlist = await ytpl(query, { limit: 50 });
                if (playlist.items.length === 0) {
                    message.channel.send('❌ No videos found in this playlist, or the playlist is empty/private.');
                    return;
                }
                songsToAdd = playlist.items.map(item => ({
                    title: item.title,
                    url: item.url,
                    duration: item.duration
                }));
                if (songsToAdd.length > 50) {
                    songsToAdd = songsToAdd.slice(0, 50);
                    message.channel.send(`⚠️ Playlist contains more than 50 videos. Only the first 50 will be added.`);
                }
            } else {
                message.channel.send('⏳ Fetching video info, please wait...');
                const videoInfo = await ytdl.getInfo(query);
                songsToAdd.push({
                    title: videoInfo.videoDetails.title,
                    url: videoInfo.videoDetails.video_url,
                    duration: formatDuration(videoInfo.videoDetails.lengthSeconds)
                });
            }
        } else {
            message.channel.send('⏳ Searching for video, please wait...');
            const searchResults = await youtubeSearch.search(query);
            const video = searchResults.length ? searchResults[0] : null;

            if (!video) {
                message.channel.send('❌ No results found for your query.');
                return;
            }
            const videoInfo = await ytdl.getInfo(video.url);
            songsToAdd.push({
                title: videoInfo.videoDetails.title,
                url: videoInfo.videoDetails.video_url,
                duration: formatDuration(videoInfo.videoDetails.lengthSeconds)
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

    let queueConstruct = serverQueue.get(message.guild.id);

    if (!queueConstruct) {
        const player = createAudioPlayer();
        queueConstruct = {
            textChannel: message.channel,
            voiceChannel: voiceChannel,
            connection: null,
            songs: [],
            player: player,
            volume: 0.10,
            playing: true,
            loop: 'none',
            streamVideo: false
        };

        serverQueue.set(message.guild.id, queueConstruct);
        queueConstruct.songs.push(...songsToAdd);

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });
            queueConstruct.connection = connection;
            connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, () => {
                if (queueConstruct.loop === 'single' && queueConstruct.songs.length > 0) {
                    play(message.guild, queueConstruct.songs[0], serverQueue);
                    message.channel.send(`🔁 Looping **${queueConstruct.songs[0].title}** (${queueConstruct.songs[0].duration}).`);
                } else if (queueConstruct.loop === 'all' && queueConstruct.songs.length > 0) {
                    const finishedSong = queueConstruct.songs.shift();
                    queueConstruct.songs.push(finishedSong);
                    play(message.guild, queueConstruct.songs[0], serverQueue);
                    message.channel.send(`🔁 Looping entire queue. Now playing: **${queueConstruct.songs[0].title}** (${queueConstruct.songs[0].duration}).`);
                } else {
                    queueConstruct.songs.shift();
                    if (queueConstruct.songs.length > 0) {
                        play(message.guild, queueConstruct.songs[0], serverQueue);
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
                queueConstruct.songs.shift();
                if (queueConstruct.songs.length > 0) {
                    play(message.guild, queueConstruct.songs[0], serverQueue);
                } else {
                    if (queueConstruct.connection && !queueConstruct.connection.destroyed) {
                        queueConstruct.connection.destroy();
                    }
                    serverQueue.delete(message.guild.id);
                    message.channel.send('⏹️ Queue finished. Leaving voice channel.');
                }
            });

            play(message.guild, queueConstruct.songs[0], serverQueue);
            if (isPlaylist) {
                message.channel.send(`🎶 Added **${songsToAdd.length}** songs from the playlist to the queue!`);
            } else {
                message.channel.send(`🎵 **${songsToAdd[0].title}** (${songsToAdd[0].duration}) added to the queue!`);
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
};
