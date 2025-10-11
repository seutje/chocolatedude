const { fetch: undiciFetch } = require('undici');

if (typeof global.fetch !== 'function') {
    global.fetch = undiciFetch;
}

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, demuxProbe, VoiceConnectionStatus } = require('@discordjs/voice');
const ytpl = require('ytpl');
const { getTracks } = require('spotify-url-info')(global.fetch);
const formatDuration = require('../formatDuration');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const YTDLP_SCRIPT = `
import yt_dlp, json, sys

url = sys.argv[1]

ydl_opts = {
    'format': 'bestaudio/best',
    'skip_download': True,
    'quiet': True,
    'no_warnings': True,
    'ignoreerrors': False,
    'geo_bypass': True,
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    if info is None:
        print(json.dumps({'error': 'no_info'}))
        sys.exit(1)

    if 'entries' in info:
        entries = (entry for entry in info['entries'] if entry)
        info = next(entries, None)
        if info is None:
            print(json.dumps({'error': 'no_entry'}))
            sys.exit(1)

    result = {
        'id': info.get('id'),
        'title': info.get('title'),
        'duration': info.get('duration'),
        'webpage_url': info.get('webpage_url') or url,
        'stream_url': info.get('url'),
    }

    print(json.dumps(result))
`;

async function runYtDlp(url) {
    return new Promise((resolve, reject) => {
        const process = spawn('python3', ['-', url]);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', chunk => {
            stdout += chunk.toString();
        });

        process.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });

        process.once('error', reject);

        process.once('close', code => {
            if (code !== 0) {
                return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                if (parsed.error) {
                    return reject(new Error(`yt-dlp error: ${parsed.error}`));
                }
                resolve(parsed);
            } catch (err) {
                reject(new Error(`Failed to parse yt-dlp output: ${err.message}`));
            }
        });

        process.stdin.end(YTDLP_SCRIPT);
    });
}

function parseDurationString(raw) {
    if (!raw || typeof raw !== 'string') return NaN;
    const parts = raw.split(':').map(part => Number(part.trim()));
    if (parts.some(Number.isNaN)) return NaN;
    return parts.reduce((total, value) => total * 60 + value, 0);
}

function destroyConnection(connection) {
    if (!connection) return;
    if (connection.state?.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
    }
}

const helpers = {};

async function fetchSunoSong(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch Suno share page: HTTP ${response.status}`);
    }

    const html = await response.text();
    const decodeEntities = text => text.replace(/&(#\d+|#x[\da-fA-F]+|quot|apos|amp|lt|gt);/g, entity => {
        if (entity === '&quot;') return '"';
        if (entity === '&apos;') return '\'';
        if (entity === '&amp;') return '&';
        if (entity === '&lt;') return '<';
        if (entity === '&gt;') return '>';
        if (entity.startsWith('&#x')) {
            return String.fromCodePoint(parseInt(entity.slice(3, -1), 16));
        }
        if (entity.startsWith('&#')) {
            return String.fromCodePoint(parseInt(entity.slice(2, -1), 10));
        }
        return entity;
    });

    const extractNextData = () => {
        const scriptMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        if (scriptMatch) {
            return scriptMatch[1];
        }

        const windowMatch = html.match(/window\.__NEXT_DATA__\s*=\s*([\s\S]*?)<\/script>/i);
        if (windowMatch) {
            let snippet = windowMatch[1].trim();
            if (snippet.endsWith(';')) {
                snippet = snippet.slice(0, -1).trim();
            }
            if (snippet.startsWith('JSON.parse(')) {
                snippet = snippet.slice('JSON.parse('.length).trim();
                if (snippet.endsWith(')')) {
                    snippet = snippet.slice(0, -1).trim();
                }
            }
            return snippet;
        }

        return null;
    };

    let rawJson = extractNextData();

    if (!rawJson) {
        throw new Error('Unable to locate Suno song metadata.');
    }

    rawJson = decodeEntities(rawJson.trim());
    if (!rawJson) {
        throw new Error('Unable to locate Suno song metadata.');
    }

    if (rawJson.startsWith('JSON.parse(')) {
        rawJson = rawJson.slice('JSON.parse('.length).trim();
        if (rawJson.endsWith(')')) {
            rawJson = rawJson.slice(0, -1).trim();
        }
    }

    const unwrapStringLiteral = value => {
        if (value.length < 2) return value;
        const firstChar = value[0];
        const lastChar = value[value.length - 1];
        if ((firstChar === '"' && lastChar === '"') || (firstChar === '\'' && lastChar === '\'') || (firstChar === '`' && lastChar === '`')) {
            const inner = value.slice(1, -1);
            if (firstChar === '"') {
                try {
                    return JSON.parse(value);
                } catch (err) {
                    return inner.replace(/\\"/g, '"');
                }
            }
            if (firstChar === '\'') {
                return inner.replace(/\\'/g, '\'').replace(/\\"/g, '"');
            }
            return inner.replace(/\\`/g, '`');
        }
        return value;
    };

    rawJson = unwrapStringLiteral(rawJson.trim());

    let parsedJson;
    try {
        parsedJson = JSON.parse(rawJson);
    } catch (err) {
        throw new Error(`Unable to parse Suno metadata JSON: ${err.message}`);
    }

    const findSongData = value => {
        if (!value || typeof value !== 'object') return null;

        if ('audio_url' in value || 'audioUrl' in value) {
            return value;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const found = findSongData(item);
                if (found) return found;
            }
        } else {
            for (const key of Object.keys(value)) {
                const found = findSongData(value[key]);
                if (found) return found;
            }
        }

        return null;
    };

    const songData = findSongData(parsedJson);

    if (!songData) {
        throw new Error('Unable to extract Suno song information from metadata.');
    }

    const audioUrl = songData.audio_url || songData.audioUrl;
    if (!audioUrl) {
        throw new Error('Suno song metadata does not include an audio URL.');
    }

    let rawDuration = songData.audio_length_seconds ?? songData.duration_seconds ?? songData.duration ?? null;
    if (typeof rawDuration === 'string') {
        const parsed = Number(rawDuration);
        rawDuration = Number.isFinite(parsed) ? parsed : null;
    }

    const durationSeconds = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : null;

    const title = songData.title || songData.name || songData.display_name || 'Unknown Title';

    return {
        title,
        durationSeconds,
        audioUrl
    };
}

helpers.openStreamFromUrl = async function openStreamFromUrl(streamUrl) {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(streamUrl);
        } catch (err) {
            reject(err);
            return;
        }

        const requestFn = parsedUrl.protocol === 'http:' ? http.get : https.get;
        const request = requestFn(streamUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive'
            }
        }, response => {
            if (response.statusCode && response.statusCode >= 400) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode} while fetching audio stream`));
                return;
            }
            resolve(response);
        });

        request.once('error', reject);
    });
};

helpers.createAudioResourceForSong = async function createAudioResourceForSong(song) {
    let metadata = {};
    let stream;

    if (song.streamUrl) {
        stream = await helpers.openStreamFromUrl(song.streamUrl);
        metadata = {
            title: song.title,
            duration: song.durationSeconds ?? null,
            stream_url: song.streamUrl
        };
    } else {
        metadata = await runYtDlp(song.url);
        if (!metadata.stream_url) {
            throw new Error('No stream URL retrieved from yt-dlp');
        }
        stream = await helpers.openStreamFromUrl(metadata.stream_url);
    }

    const probe = await demuxProbe(stream);
    const resource = createAudioResource(probe.stream, { inputType: probe.type, inlineVolume: true });

    return { resource, metadata };
};

let youtubeSearchModulePromise;
async function searchYouTube(query) {
    if (!youtubeSearchModulePromise) {
        youtubeSearchModulePromise = import('youtube-search-without-api-key');
    }
    const mod = await youtubeSearchModulePromise;
    return mod.search(query);
}

helpers.playSong = async function playSong(guild, song, serverQueue) {
    const queueConstruct = serverQueue.get(guild.id);
    if (!queueConstruct) return;

    if (!song) {
        destroyConnection(queueConstruct.connection);
        serverQueue.delete(guild.id);
        return;
    }

    try {
        const { resource, metadata } = await helpers.createAudioResourceForSong(song);

        if (!song.title && metadata.title) {
            song.title = metadata.title;
        }
        if ((song.duration === undefined || song.duration === null || song.duration === 'N/A') && metadata.duration != null) {
            song.duration = formatDuration(metadata.duration);
        }

        resource.volume.setVolume(queueConstruct.volume);
        queueConstruct.player.play(resource);

        queueConstruct.textChannel.send(`▶️ Now playing: **${song.title || 'Unknown Title'}** (${song.duration || 'N/A'}).`).catch(() => {});
    } catch (error) {
        console.error('Error during playback:', error);
        queueConstruct.textChannel.send('❌ Error: Could not play the audio. Skipping to next song if available.').catch(() => {});

        queueConstruct.songs.shift();
        if (queueConstruct.songs.length > 0) {
            await helpers.playSong(guild, queueConstruct.songs[0], serverQueue);
        } else {
            destroyConnection(queueConstruct.connection);
            serverQueue.delete(guild.id);
            queueConstruct.textChannel.send('⏹️ Queue finished. Leaving voice channel.').catch(() => {});
        }
    }
};

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
    let remainingSpotifyTracks = [];
    let playlistOverflow = false;

    try {
        if (query.startsWith('http')) {
            if (query.includes('spotify.com/playlist')) {
                isPlaylist = true;
                message.channel.send('⏳ Fetching Spotify playlist, please wait...');
                const tracks = await getTracks(query);
                if (!tracks || tracks.length === 0) {
                    message.channel.send('❌ No tracks found in this Spotify playlist.');
                    return;
                }
                const limitedTracks = tracks.slice(0, 100);
                playlistOverflow = tracks.length > 100;

                if (!serverQueue.get(message.guild.id)) {
                    const first = limitedTracks.shift();
                    const searchTerm = `${first.artist} - ${first.name}`;
                    const searchResults = await searchYouTube(searchTerm);
                    const video = searchResults.length ? searchResults[0] : null;
                    if (video) {
                        const durationSeconds = parseDurationString(video.duration_raw);
                        songsToAdd.push({
                            title: video.title,
                            url: video.url,
                            duration: formatDuration(durationSeconds)
                        });
                    }
                    remainingSpotifyTracks = limitedTracks;
                } else {
                    for (const track of limitedTracks) {
                        const searchTerm = `${track.artist} - ${track.name}`;
                        const searchResults = await searchYouTube(searchTerm);
                        const video = searchResults.length ? searchResults[0] : null;
                        if (video) {
                            const durationSeconds = parseDurationString(video.duration_raw);
                            songsToAdd.push({
                                title: video.title,
                                url: video.url,
                                duration: formatDuration(durationSeconds)
                            });
                        }
                    }
                }
                if (playlistOverflow) {
                    message.channel.send('⚠️ Playlist contains more than 100 tracks. Only the first 100 will be added.');
                }
            } else if (query.includes('list=')) {
                isPlaylist = true;
                message.channel.send('⏳ Fetching playlist, please wait...');
                let playlist;
                try {
                    playlist = await ytpl(query, { limit: 100 });
                } catch (playlistError) {
                    console.error('Playlist fetch failed, falling back to single video:', playlistError);
                }

                if (playlist && playlist.items.length > 0) {
                    songsToAdd = playlist.items.map(item => ({
                        title: item.title,
                        url: item.url,
                        duration: formatDuration(parseDurationString(item.duration))
                    }));
                    if (songsToAdd.length > 100) {
                        songsToAdd = songsToAdd.slice(0, 100);
                        message.channel.send(`⚠️ Playlist contains more than 100 videos. Only the first 100 will be added.`);
                    }
                } else {
                    let fallbackUrl = query;
                    try {
                        const urlObj = new URL(query);
                        urlObj.searchParams.delete('list');
                        urlObj.searchParams.delete('index');
                        urlObj.searchParams.delete('start_radio');
                        fallbackUrl = urlObj.toString();
                    } catch (err) {
                        console.error('Failed to parse playlist URL for fallback:', err);
                    }

                    try {
                        const metadata = await runYtDlp(fallbackUrl);
                        songsToAdd.push({
                            title: metadata.title || fallbackUrl,
                            url: metadata.webpage_url || fallbackUrl,
                            duration: formatDuration(metadata.duration)
                        });
                        isPlaylist = false;
                        message.channel.send('⚠️ Playlist could not be loaded. Falling back to the linked video.').catch(() => {});
                    } catch (err) {
                        throw err;
                    }
                }
            } else if (/https?:\/\/(?:www\.)?suno\.com\/s\//i.test(query)) {
                const sunoMetadata = await fetchSunoSong(query);
                songsToAdd.push({
                    title: sunoMetadata.title || query,
                    url: query,
                    duration: formatDuration(sunoMetadata.durationSeconds),
                    streamUrl: sunoMetadata.audioUrl,
                    durationSeconds: sunoMetadata.durationSeconds ?? undefined
                });
            } else {
                const metadata = await runYtDlp(query);
                songsToAdd.push({
                    title: metadata.title || query,
                    url: metadata.webpage_url || query,
                    duration: formatDuration(metadata.duration)
                });
            }
        } else {
            const searchResults = await searchYouTube(query);
            const video = searchResults.length ? searchResults[0] : null;

            if (!video) {
                message.channel.send('❌ No results found for your query.');
                return;
            }
            const durationSeconds = parseDurationString(video.duration_raw);
            songsToAdd.push({
                title: video.title,
                url: video.url,
                duration: formatDuration(durationSeconds)
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
            loop: 'none'
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
                (async () => {
                    if (queueConstruct.loop === 'single' && queueConstruct.songs.length > 0) {
                        await helpers.playSong(message.guild, queueConstruct.songs[0], serverQueue);
                        message.channel.send(`🔁 Looping **${queueConstruct.songs[0].title}** (${queueConstruct.songs[0].duration}).`).catch(() => {});
                    } else if (queueConstruct.loop === 'all' && queueConstruct.songs.length > 0) {
                        const finishedSong = queueConstruct.songs.shift();
                        queueConstruct.songs.push(finishedSong);
                        await helpers.playSong(message.guild, queueConstruct.songs[0], serverQueue);
                        message.channel.send(`🔁 Looping entire queue. Now playing: **${queueConstruct.songs[0].title}** (${queueConstruct.songs[0].duration}).`).catch(() => {});
                    } else {
                        queueConstruct.songs.shift();
                        if (queueConstruct.songs.length > 0) {
                            await helpers.playSong(message.guild, queueConstruct.songs[0], serverQueue);
                        } else {
                            destroyConnection(queueConstruct.connection);
                            serverQueue.delete(message.guild.id);
                            message.channel.send('⏹️ Queue finished. Leaving voice channel.').catch(() => {});
                        }
                    }
                })().catch(err => {
                    console.error('Error while handling idle state:', err);
                });
            });

            player.on('error', error => {
                console.error(`Error with audio player: ${error.message}`);
                message.channel.send('❌ Error: Could not play the audio. Skipping to next song if available.').catch(() => {});
                queueConstruct.songs.shift();
                if (queueConstruct.songs.length > 0) {
                    helpers.playSong(message.guild, queueConstruct.songs[0], serverQueue).catch(err => console.error('Playback retry failed:', err));
                } else {
                    destroyConnection(queueConstruct.connection);
                    serverQueue.delete(message.guild.id);
                    message.channel.send('⏹️ Queue finished. Leaving voice channel.').catch(() => {});
                }
            });

            helpers.playSong(message.guild, queueConstruct.songs[0], serverQueue).catch(err => {
                console.error('Initial playback failed:', err);
            });
            if (isPlaylist && remainingSpotifyTracks.length > 0) {
                message.channel.send(`🎶 Starting playlist playback. Loading ${remainingSpotifyTracks.length} more songs...`);
            } else if (isPlaylist) {
                message.channel.send(`🎶 Added **${songsToAdd.length}** songs from the playlist to the queue!`);
            } else {
                message.channel.send(`🎵 **${songsToAdd[0].title}** (${songsToAdd[0].duration}) added to the queue!`);
            }

            if (remainingSpotifyTracks.length > 0) {
                (async () => {
                    let added = 0;
                    for (const track of remainingSpotifyTracks) {
                        try {
                            const term = `${track.artist} - ${track.name}`;
                            const results = await searchYouTube(term);
                            const vid = results.length ? results[0] : null;
                            if (vid) {
                                const durationSeconds = parseDurationString(vid.duration_raw);
                                const song = {
                                    title: vid.title,
                                    url: vid.url,
                                    duration: formatDuration(durationSeconds)
                                };
                                const queue = serverQueue.get(message.guild.id);
                                if (queue) {
                                    queue.songs.push(song);
                                    added++;
                                } else {
                                    break;
                                }
                            }
                        } catch (e) {
                            console.error('Error processing playlist track:', e);
                        }
                    }
                    if (added > 0) {
                        message.channel.send(`🎶 Added **${added}** more songs from the playlist to the queue!`);
                    }
                })();
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
        } else if (queueConstruct.songs.length > 1) {
            message.channel.send(`🎵 **${songsToAdd[0].title}** (${songsToAdd[0].duration}) has been added to the queue!`);
        }
    }
};

module.exports.fetchSunoSong = fetchSunoSong;
module.exports.helpers = helpers;
module.exports.runYtDlp = runYtDlp;
