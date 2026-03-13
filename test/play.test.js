jest.mock('@discordjs/voice', () => {
    const { EventEmitter } = require('events');

    const joinVoiceChannel = jest.fn(() => ({
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
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

    const entersState = jest.fn(async target => target);

    return {
        joinVoiceChannel,
        getVoiceConnection: jest.fn(() => null),
        createAudioPlayer,
        createAudioResource,
        AudioPlayerStatus: { Idle: 'idle' },
        entersState,
        StreamType: { Raw: 'raw' },
        NoSubscriberBehavior: { Play: 'play' },
        VoiceConnectionStatus: { Destroyed: 'destroyed', Ready: 'ready' }
    };
});

const { PassThrough } = require('stream');
const { EventEmitter } = require('events');
const https = require('https');
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

        const openStreamSpy = jest.spyOn(playCommand.helpers, 'openStreamFromUrl').mockImplementation(async (url, headers) => {
            const stream = new PassThrough();
            stream.end();
            return stream;
        });
        const transcodeSpy = jest.spyOn(playCommand.helpers, 'transcodeStreamToPcm').mockImplementation(async stream => stream);

        const { serverQueue } = await runPlayCommand();

        expect(global.fetch).toHaveBeenCalledWith('https://suno.com/s/test', expect.any(Object));
        expect(voice.joinVoiceChannel).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'voice-channel-id', guildId: 'guild-id' }));

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs).toHaveLength(1);
        expect(queue.songs[0].streamUrl).toBe('https://cdn.suno.com/audio/test.mp3');
        expect(queue.songs[0].title).toBe('Test Song');
        expect(queue.songs[0].duration).toBe('02:05');

        expect(openStreamSpy).toHaveBeenCalledWith('https://cdn.suno.com/audio/test.mp3', {});
        expect(transcodeSpy).toHaveBeenCalled();
        expect(queue.player.play).toHaveBeenCalled();
        expect(voice.createAudioResource).toHaveBeenCalledWith(expect.any(PassThrough), expect.objectContaining({ inputType: 'raw', inlineVolume: true }));

        transcodeSpy.mockRestore();
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
        const transcodeSpy = jest.spyOn(playCommand.helpers, 'transcodeStreamToPcm').mockImplementation(async stream => stream);

        const { serverQueue } = await runPlayCommand();

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs[0].streamUrl).toBe('https://cdn.suno.com/audio/escaped.mp3');
        expect(queue.songs[0].title).toBe('Escaped Song & more');
        expect(queue.songs[0].duration).toBe('03:35');

        transcodeSpy.mockRestore();
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
        const transcodeSpy = jest.spyOn(playCommand.helpers, 'transcodeStreamToPcm').mockImplementation(async stream => stream);

        const { serverQueue } = await runPlayCommand();

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs[0].streamUrl).toBe('https://cdn.suno.com/audio/percent.mp3');
        expect(queue.songs[0].title).toBe('Percent Encoded Song');
        expect(queue.songs[0].duration).toBe('02:22');

        transcodeSpy.mockRestore();
        openStreamSpy.mockRestore();
    });

    test('falls back to scanning document when __NEXT_DATA__ payload is absent', async () => {
        const escapedPayload = JSON.stringify({
            song: {
                title: 'Fallback Song',
                audio_length_seconds: 301,
                audio_url: 'https://cdn.suno.com/audio/fallback.mp3'
            }
        }).replace(/"/g, '\\"');

        const html = `<!DOCTYPE html><html><head><meta property="og:title" content="Fallback Song"></head><body><script>self.__next_f = self.__next_f || [];self.__next_f.push([1,"/s/[id]","${escapedPayload}"]);</script></body></html>`;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => html
        });

        const openStreamSpy = jest.spyOn(playCommand.helpers, 'openStreamFromUrl').mockImplementation(async () => {
            const stream = new PassThrough();
            stream.end();
            return stream;
        });
        const transcodeSpy = jest.spyOn(playCommand.helpers, 'transcodeStreamToPcm').mockImplementation(async stream => stream);

        const { serverQueue } = await runPlayCommand();

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs[0].streamUrl).toBe('https://cdn.suno.com/audio/fallback.mp3');
        expect(queue.songs[0].title).toBe('Fallback Song');
        expect(queue.songs[0].duration).toBe('05:01');

        transcodeSpy.mockRestore();
        openStreamSpy.mockRestore();
    });

    test('preserves apostrophes in Suno titles when falling back to document scanning', async () => {
        const escapedPayload = JSON.stringify({
            song: {
                title: "That's Why",
                audio_length_seconds: 129,
                audio_url: 'https://cdn.suno.com/audio/thats-why.mp3'
            }
        }).replace(/"/g, '\\"');

        const html = `<!DOCTYPE html><html><head><meta property="og:title" content="That's Why"></head><body><script>self.__next_f = self.__next_f || [];self.__next_f.push([1,"/s/[id]","${escapedPayload}"]);</script></body></html>`;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => html
        });

        const openStreamSpy = jest.spyOn(playCommand.helpers, 'openStreamFromUrl').mockImplementation(async () => {
            const stream = new PassThrough();
            stream.end();
            return stream;
        });
        const transcodeSpy = jest.spyOn(playCommand.helpers, 'transcodeStreamToPcm').mockImplementation(async stream => stream);

        const { message, serverQueue } = await runPlayCommand();

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs[0].streamUrl).toBe('https://cdn.suno.com/audio/thats-why.mp3');
        expect(queue.songs[0].title).toBe("That's Why");
        expect(queue.songs[0].duration).toBe('02:09');
        expect(message.channel.send).toHaveBeenCalledWith(expect.stringContaining("That's Why"));

        transcodeSpy.mockRestore();
        openStreamSpy.mockRestore();
    });

    test('ignores Suno silent placeholder audio and prefers the clip payload in __next_f data', async () => {
        const html = `<!DOCTYPE html><html><head><meta property="og:title" content="You Follow?"></head><body><audio id="silent-audio" src="https://cdn1.suno.ai/sil-100.mp3"></audio><script>self.__next_f = self.__next_f || [];self.__next_f.push([1,"2c:[\\"$\\",\\"$L3d\\",null,{\\"clip\\":{\\"status\\":\\"complete\\",\\"title\\":\\"You Follow?\\",\\"audio_url\\":\\"https://cdn1.suno.ai/72db7d39-e8d6-4a36-94ba-71cdad5f6e8b.mp3\\",\\"metadata\\":{\\"duration\\":177.76}}}]"]);</script></body></html>`;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => html
        });

        const openStreamSpy = jest.spyOn(playCommand.helpers, 'openStreamFromUrl').mockImplementation(async () => {
            const stream = new PassThrough();
            stream.end();
            return stream;
        });
        const transcodeSpy = jest.spyOn(playCommand.helpers, 'transcodeStreamToPcm').mockImplementation(async stream => stream);

        const { serverQueue } = await runPlayCommand();

        const queue = serverQueue.get('guild-id');
        expect(queue).toBeDefined();
        expect(queue.songs[0].streamUrl).toBe('https://cdn1.suno.ai/72db7d39-e8d6-4a36-94ba-71cdad5f6e8b.mp3');
        expect(queue.songs[0].title).toBe('You Follow?');
        expect(queue.songs[0].duration).toBe('02:57');

        transcodeSpy.mockRestore();
        openStreamSpy.mockRestore();
    });

    test('follows redirects when opening a resolved Suno audio URL', async () => {
        const finalResponse = new PassThrough();
        finalResponse.statusCode = 200;
        finalResponse.headers = {};

        const requests = [];
        const getSpy = jest.spyOn(https, 'get').mockImplementation((url, options, callback) => {
            requests.push({ url, options });

            const request = new EventEmitter();
            request.once = request.once.bind(request);

            process.nextTick(() => {
                if (requests.length === 1) {
                    callback({
                        statusCode: 302,
                        headers: { location: '/audio/final.mp3' },
                        resume: jest.fn()
                    });
                    return;
                }

                callback(finalResponse);
            });

            return request;
        });

        const stream = await playCommand.helpers.openStreamFromUrl('https://cdn.suno.com/audio/start.mp3');

        expect(stream.statusCode).toBe(200);
        expect(requests).toHaveLength(2);
        expect(requests[0].url).toBe('https://cdn.suno.com/audio/start.mp3');
        expect(requests[1].url).toBe('https://cdn.suno.com/audio/final.mp3');

        getSpy.mockRestore();
    });
});
