jest.mock('@discordjs/voice', () => {
    const { EventEmitter } = require('events');

    const joinVoiceChannel = jest.fn(() => ({
        subscribe: jest.fn(),
        destroy: jest.fn(),
        state: { status: 'connected' }
    }));

    const createAudioPlayer = jest.fn(() => {
        const emitter = new EventEmitter();
        emitter.play = jest.fn();
        emitter.on = emitter.on.bind(emitter);
        emitter.once = emitter.once.bind(emitter);
        return emitter;
    });

    const createAudioResource = jest.fn(() => ({
        volume: { setVolume: jest.fn() }
    }));

    const demuxProbe = jest.fn(async stream => ({
        stream,
        type: 'mp3'
    }));

    return {
        joinVoiceChannel,
        createAudioPlayer,
        createAudioResource,
        AudioPlayerStatus: { Idle: 'idle' },
        demuxProbe,
        VoiceConnectionStatus: { Destroyed: 'destroyed' }
    };
});

const { PassThrough } = require('stream');
const voice = require('@discordjs/voice');

const originalFetch = global.fetch;

const playCommand = require('../commands/play');

describe('play command Suno integration', () => {
    afterEach(() => {
        global.fetch = originalFetch;
        jest.clearAllMocks();
    });

    const createBaseMessage = () => ({
        content: '!play https://suno.com/s/test',
        channel: { send: jest.fn().mockResolvedValue(null) },
        member: {
            voice: {
                channel: { id: 'voice-channel-id' }
            }
        },
        guild: {
            id: 'guild-id',
            voiceAdapterCreator: jest.fn()
        }
    });

    const runPlayCommand = async () => {
        const message = createBaseMessage();
        const serverQueue = new Map();
        await playCommand(message, serverQueue);
        await new Promise(resolve => setImmediate(resolve));
        return { message, serverQueue };
    };

    test('enqueues Suno share link with resolved stream URL', async () => {
        const html = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: {
                pageProps: {
                    shareSong: {
                        title: 'Test Song',
                        audio_length_seconds: 125,
                        audio_url: 'https://cdn.suno.com/audio/test.mp3'
                    }
                }
            }
        })}</script></head><body></body></html>`;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => html
        });

        const openStreamSpy = jest.spyOn(playCommand.helpers, 'openStreamFromUrl').mockImplementation(async url => {
            const stream = new PassThrough();
            stream.end();
            return stream;
        });

        const { serverQueue } = await runPlayCommand();

        expect(global.fetch).toHaveBeenCalledWith('https://suno.com/s/test', expect.any(Object));
        expect(voice.joinVoiceChannel).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'voice-channel-id', guildId: 'guild-id' }));

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs).toHaveLength(1);
        expect(queue.songs[0].streamUrl).toBe('https://cdn.suno.com/audio/test.mp3');
        expect(queue.songs[0].title).toBe('Test Song');
        expect(queue.songs[0].duration).toBe('02:05');

        expect(openStreamSpy).toHaveBeenCalledWith('https://cdn.suno.com/audio/test.mp3');
        expect(queue.player.play).toHaveBeenCalled();

        openStreamSpy.mockRestore();
    });

    test('parses Suno metadata when JSON is HTML-escaped and assigned to window.__NEXT_DATA__', async () => {
        const payload = {
            props: {
                pageProps: {
                    shareSong: {
                        title: 'Escaped Song & more',
                        duration_seconds: '215',
                        audio_url: 'https://cdn.suno.com/audio/escaped.mp3'
                    }
                }
            }
        };

        const escapedJson = JSON.stringify(payload).replace(/"/g, '&quot;');
        const html = `<html><head><script>window.__NEXT_DATA__ = ${escapedJson};</script></head><body></body></html>`;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => html
        });

        const openStreamSpy = jest.spyOn(playCommand.helpers, 'openStreamFromUrl').mockImplementation(async () => {
            const stream = new PassThrough();
            stream.end();
            return stream;
        });

        const { serverQueue } = await runPlayCommand();

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs[0].streamUrl).toBe('https://cdn.suno.com/audio/escaped.mp3');
        expect(queue.songs[0].title).toBe('Escaped Song & more');
        expect(queue.songs[0].duration).toBe('03:35');

        openStreamSpy.mockRestore();
    });

    test('parses Suno metadata when wrapped in JSON.parse(decodeURIComponent()) with trailing script content', async () => {
        const payload = {
            props: {
                pageProps: {
                    shareSong: {
                        title: 'Percent Encoded Song',
                        duration: 142,
                        audio_url: 'https://cdn.suno.com/audio/percent.mp3'
                    }
                }
            }
        };

        const encoded = encodeURIComponent(JSON.stringify(payload));
        const html = `<html><head><script>window.__NEXT_DATA__ = JSON.parse(decodeURIComponent('${encoded}'));window.__NEXT_P = [];</script></head><body></body></html>`;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => html
        });

        const openStreamSpy = jest.spyOn(playCommand.helpers, 'openStreamFromUrl').mockImplementation(async () => {
            const stream = new PassThrough();
            stream.end();
            return stream;
        });

        const { serverQueue } = await runPlayCommand();

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs[0].streamUrl).toBe('https://cdn.suno.com/audio/percent.mp3');
        expect(queue.songs[0].title).toBe('Percent Encoded Song');
        expect(queue.songs[0].duration).toBe('02:22');

        openStreamSpy.mockRestore();
    });
});
