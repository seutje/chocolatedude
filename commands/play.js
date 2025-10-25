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
const { PassThrough } = require('stream');

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36';

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
        'http_headers': info.get('http_headers', {}),
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

    const extractBalancedSegment = (text, openChar, closeChar) => {
        if (!text || text[0] !== openChar) return null;

        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let index = 0; index < text.length; index++) {
            const char = text[index];

            if (inString) {
                if (char === '\\') {
                    index += 1;
                    continue;
                }
                if (char === stringChar) {
                    inString = false;
                }
                continue;
            }

            if (char === '"' || char === '\'' || char === '`') {
                inString = true;
                stringChar = char;
                continue;
            }

            if (char === openChar) {
                depth += 1;
            } else if (char === closeChar) {
                depth -= 1;
                if (depth === 0) {
                    const content = text.slice(1, index);
                    const rest = text.slice(index + 1);
                    return { content, rest, endIndex: index };
                }
            }
        }

        return null;
    };

    const readJsExpression = (source, startIndex) => {
        const length = source.length;
        let index = startIndex;

        while (index < length && /\s/.test(source[index])) {
            index += 1;
        }

        if (index >= length) return null;

        const startChar = source[index];
        const start = index;

        if (startChar === '{' || startChar === '[') {
            const closing = extractBalancedSegment(source.slice(index), startChar, startChar === '{' ? '}' : ']');
            if (closing) {
                const consumedLength = closing.endIndex + 1;
                return source.slice(start, start + consumedLength);
            }
        }

        if (startChar === '"' || startChar === '\'' || startChar === '`') {
            let inEscape = false;
            for (let i = index + 1; i < length; i++) {
                const char = source[i];
                if (inEscape) {
                    inEscape = false;
                    continue;
                }
                if (char === '\\') {
                    inEscape = true;
                    continue;
                }
                if (char === startChar) {
                    return source.slice(start, i + 1);
                }
            }
            return null;
        }

        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = index; i < length; i++) {
            const char = source[i];

            if (inString) {
                if (char === '\\') {
                    i += 1;
                    continue;
                }
                if (char === stringChar) {
                    inString = false;
                }
                continue;
            }

            if (char === '"' || char === '\'' || char === '`') {
                inString = true;
                stringChar = char;
                continue;
            }

            if (char === '(') {
                depth += 1;
                continue;
            }

            if (char === ')') {
                if (depth > 0) {
                    depth -= 1;
                    continue;
                }
            }

            if (char === ';' && depth === 0) {
                return source.slice(start, i);
            }

            if (char === '<' && source.slice(i, i + 8).toLowerCase() === '</script') {
                return source.slice(start, i);
            }
        }

        return source.slice(start);
    };

    const extractAssignmentValue = () => {
        const assignmentPatterns = [
            /(?:window\.|globalThis\.|self\.)?__NEXT_DATA__\s*=\s*/i,
            /(?:window|globalThis|self)?\["__NEXT_DATA__"\]\s*=\s*/i
        ];

        for (const pattern of assignmentPatterns) {
            const match = pattern.exec(html);
            if (!match) continue;

            const expression = readJsExpression(html, match.index + match[0].length);
            if (expression) {
                return expression;
            }
        }

        return null;
    };

    const extractNextData = () => {
        const scriptMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        if (scriptMatch) {
            return scriptMatch[1];
        }

        const assignmentValue = extractAssignmentValue();
        if (assignmentValue) {
            return assignmentValue;
        }

        return null;
    };

    const decodeAndUnescape = raw => {
        if (typeof raw !== 'string') return raw;
        const entityDecoded = decodeEntities(raw);
        try {
            return JSON.parse(`"${entityDecoded.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
        } catch (error) {
            return entityDecoded;
        }
    };

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

    const stripTrailingSemicolons = text => text.replace(/;\s*$/g, '').trim();

    const tryUnwrapFunction = (expression, names, transform) => {
        const trimmed = expression.trim();
        const candidates = [];
        for (const name of names) {
            candidates.push(name);
            candidates.push(`window.${name}`);
            candidates.push(`globalThis.${name}`);
            candidates.push(`self.${name}`);
        }

        for (const candidate of candidates) {
            if (!trimmed.startsWith(`${candidate}(`)) continue;

            const segment = extractBalancedSegment(trimmed.slice(candidate.length), '(', ')');
            if (!segment) continue;

            const inner = segment.content.trim();
            let transformed = transform(inner);
            if (transformed == null) {
                transformed = inner;
            }
            return transformed;
        }

        return null;
    };

    const unwrapExpression = initial => {
        let current = stripTrailingSemicolons(initial);
        let iterations = 0;

        while (iterations < 10) {
            iterations += 1;
            const withoutJsonParse = tryUnwrapFunction(current, ['JSON.parse'], inner => inner);
            if (withoutJsonParse) {
                current = withoutJsonParse;
                continue;
            }

            const withoutDecode = tryUnwrapFunction(current, ['decodeURIComponent', 'decodeURI'], inner => {
                const literal = unwrapStringLiteral(inner.trim());
                try {
                    return decodeURIComponent(literal);
                } catch (err) {
                    return literal;
                }
            });
            if (withoutDecode) {
                current = withoutDecode;
                continue;
            }

            const withoutAtob = tryUnwrapFunction(current, ['atob'], inner => {
                const literal = unwrapStringLiteral(inner.trim());
                try {
                    return Buffer.from(literal, 'base64').toString('utf8');
                } catch (err) {
                    return literal;
                }
            });
            if (withoutAtob) {
                current = withoutAtob;
                continue;
            }

            break;
        }

        return current.trim();
    };

    const extractFromDocumentFallback = () => {
        const sanitized = html.replace(/<script[^>]*>\s*?\/\*[\s\S]*?\*\/\s*?<\/script>/gi, '');
        const searchSources = [sanitized, sanitized.replace(/\\+["']/g, match => match.slice(-1))];

        const audioRegexes = [
            /["']audio[_-]?url["']\s*:\s*["']([^"']+)["']/i,
            /<meta[^>]+property=["']og:audio(?::url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
            /<audio[^>]+src=["']([^"']+)["'][^>]*>/i
        ];

        let audioMatch = null;
        let titleMatch = null;
        let durationMatch = null;

        for (const source of searchSources) {
            for (const regex of audioRegexes) {
                const match = source.match(regex);
                if (match) {
                    audioMatch = match;
                    break;
                }
            }
            if (audioMatch) {
                titleMatch = source.match(/["']title["']\s*:\s*["']([^"']+)["']/i);
                durationMatch = source.match(/["'](?:audio_length_seconds|duration_seconds|duration)["']\s*:\s*["']?([\d.]+)["']?/i);
                break;
            }
        }

        if (!audioMatch) {
            return null;
        }

        const metaTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);

        return {
            title: titleMatch ? decodeAndUnescape(titleMatch[1]) : metaTitleMatch ? decodeAndUnescape(metaTitleMatch[1]) : undefined,
            audio_url: decodeAndUnescape(audioMatch[1]),
            audio_length_seconds: durationMatch ? Number(durationMatch[1]) : undefined
        };
    };

    let rawJson = extractNextData();
    let parsedJson;

    if (rawJson) {
        rawJson = decodeEntities(rawJson.trim());
        if (!rawJson) {
            rawJson = null;
        }
    }

    if (rawJson) {
        rawJson = unwrapExpression(rawJson);
        rawJson = unwrapStringLiteral(rawJson.trim());

        try {
            parsedJson = JSON.parse(rawJson);
        } catch (err) {
            const fallbackData = extractFromDocumentFallback();
            if (!fallbackData) {
                throw new Error(`Unable to parse Suno metadata JSON: ${err.message}`);
            }
            parsedJson = fallbackData;
        }
    } else {
        const fallbackData = extractFromDocumentFallback();
        if (fallbackData) {
            parsedJson = fallbackData;
        }
    }

    if (!parsedJson) {
        throw new Error('Unable to locate Suno song metadata.');
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

function sanitizeHeaders(headers) {
    if (!headers || typeof headers !== 'object') {
        return {};
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) continue;
        sanitized[key] = typeof value === 'string' ? value : String(value);
    }
    return sanitized;
}

function applyDefaultHeaders(headers) {
    const sanitizedHeaders = sanitizeHeaders(headers);
    const lowerCaseKeys = new Set(Object.keys(sanitizedHeaders).map(key => key.toLowerCase()));

    const ensureHeader = (name, value) => {
        if (!lowerCaseKeys.has(name.toLowerCase())) {
            sanitizedHeaders[name] = value;
            lowerCaseKeys.add(name.toLowerCase());
        }
    };

    ensureHeader('User-Agent', DEFAULT_USER_AGENT);
    ensureHeader('Accept', '*/*');
    ensureHeader('Accept-Encoding', 'identity');
    ensureHeader('Connection', 'keep-alive');

    return sanitizedHeaders;
}

helpers.openStreamFromUrl = async function openStreamFromUrl(streamUrl, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(streamUrl);
        } catch (err) {
            reject(err);
            return;
        }

        const requestFn = parsedUrl.protocol === 'http:' ? http.get : https.get;
        const sanitizedHeaders = applyDefaultHeaders(extraHeaders);

        const request = requestFn(streamUrl, {
            headers: sanitizedHeaders
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

helpers.openStreamViaYtDlp = async function openStreamViaYtDlp(url, extraHeaders = {}) {
    const sanitizedHeaders = applyDefaultHeaders(extraHeaders);
    const headerEntries = Object.entries(sanitizedHeaders);
    let userAgent = DEFAULT_USER_AGENT;

    for (const [key, value] of headerEntries) {
        if (key.toLowerCase() === 'user-agent') {
            userAgent = value;
            break;
        }
    }

    return new Promise((resolve, reject) => {
        const args = [
            '-f',
            'bestaudio/best',
            '--quiet',
            '--no-warnings',
            '--no-progress',
            '--user-agent',
            userAgent,
            '-o',
            '-',
        ];

        for (const [key, value] of headerEntries) {
            if (key.toLowerCase() === 'user-agent') continue;
            args.push('--add-header', `${key}:${value}`);
        }

        args.push(url);

        const ytProcess = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const passThrough = new PassThrough();
        let stderr = '';
        let resolved = false;
        let receivedData = false;

        const fail = error => {
            if (!resolved) {
                resolved = true;
                passThrough.destroy(error);
                reject(error);
            } else {
                passThrough.destroy(error);
            }
        };

        ytProcess.once('error', fail);
        ytProcess.stderr?.on('data', chunk => {
            stderr += chunk.toString();
        });

        if (ytProcess.stdout) {
            ytProcess.stdout.on('error', fail);
            ytProcess.stdout.pipe(passThrough);
        } else {
            fail(new Error('yt-dlp did not provide a stdout stream'));
            return;
        }

        passThrough.once('data', () => {
            receivedData = true;
            if (!resolved) {
                resolved = true;
                resolve(passThrough);
            }
        });

        ytProcess.once('close', code => {
            if (code !== 0) {
                fail(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
            } else if (!receivedData) {
                fail(new Error('yt-dlp produced no audio data'));
            } else if (!resolved) {
                resolved = true;
                resolve(passThrough);
            }
        });

        passThrough.once('close', () => {
            if (ytProcess.exitCode === null && ytProcess.signalCode === null) {
                ytProcess.kill('SIGKILL');
            }
        });
    });
};

helpers.createAudioResourceForSong = async function createAudioResourceForSong(song) {
    let metadata = {};
    let stream;
    let requestHeaders = {};

    if (song.streamUrl) {
        if (song.streamHeaders && typeof song.streamHeaders === 'object') {
            requestHeaders = song.streamHeaders;
        }
        try {
            stream = await helpers.openStreamFromUrl(song.streamUrl, requestHeaders);
        } catch (error) {
            if (/HTTP 40[13]/.test(error.message) && song.url) {
                stream = await helpers.openStreamViaYtDlp(song.url, requestHeaders);
                metadata.stream_source = 'yt-dlp-cli';
            } else {
                throw error;
            }
        }
        metadata = {
            title: song.title,
            duration: song.durationSeconds ?? null,
            stream_url: song.streamUrl
        };
        if (requestHeaders && Object.keys(requestHeaders).length > 0) {
            metadata.stream_headers = requestHeaders;
        }
    } else {
        metadata = await runYtDlp(song.url);
        if (metadata.http_headers && typeof metadata.http_headers === 'object') {
            requestHeaders = metadata.http_headers;
        } else {
            requestHeaders = {};
        }
        if (!metadata.stream_url) {
            throw new Error('No stream URL retrieved from yt-dlp');
        }
        try {
            stream = await helpers.openStreamFromUrl(metadata.stream_url, requestHeaders);
        } catch (error) {
            if (/HTTP 40[13]/.test(error.message)) {
                const fallbackUrl = metadata.webpage_url || song.url;
                stream = await helpers.openStreamViaYtDlp(fallbackUrl, requestHeaders);
                metadata.stream_source = 'yt-dlp-cli';
            } else {
                throw error;
            }
        }
        if (requestHeaders && Object.keys(requestHeaders).length > 0) {
            metadata.stream_headers = requestHeaders;
        }
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
