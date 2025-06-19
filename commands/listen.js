const { joinVoiceChannel, EndBehaviorType } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const prism = require('prism-media');
const { nodewhisper } = require('nodejs-whisper');

module.exports = async function(message, serverQueue) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.channel.send('❌ You need to join a voice channel first!');
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false
    });

    message.channel.send('🎙️ Listening for your command...');

    const receiver = connection.receiver;
    const userId = message.author.id;
    const audioStream = receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 1000,
        },
    });

    const recordingsDir = path.join(__dirname, '../recordings');
    fs.mkdirSync(recordingsDir, { recursive: true });

    const rawPath = path.join(recordingsDir, `${Date.now()}-${userId}.pcm`);
    const output = fs.createWriteStream(rawPath);
    const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
    audioStream.pipe(decoder).pipe(output);

    await new Promise(resolve => audioStream.on('end', resolve));

    const wavPath = rawPath.replace('.pcm', '.wav');
    await new Promise(resolve => {
        const ffmpeg = spawn('ffmpeg', [
            '-y',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            '-i', rawPath,
            '-ar', '16000',
            '-ac', '1',
            '-af', 'apad=pad_dur=0.1',
            wavPath,
        ]);
        ffmpeg.on('close', resolve);
    });
    fs.unlinkSync(rawPath);

    try {
        const transcript = await nodewhisper(wavPath, { modelName: 'base.en' });
        fs.unlinkSync(wavPath);
        const cleaned = transcript
            .replace(/\[[^\]]+\]\s*/g, '') // remove timecodes like [00:00:00.000 --> 00:00:01.000]
            .replace(/[.?!]\s*$/g, '')
            .trim()
            .toLowerCase();
        const text = cleaned;
        message.channel.send(`📝 Heard: ${text}`);
        // Preserve the original Discord.js message object so command handlers can
        // access properties like `member` that are non-enumerable
        const fakeMessage = Object.assign(Object.create(message), { content: `!${text}` });
        if (text.startsWith('play')) {
            await require('./play')(fakeMessage, serverQueue);
        } else if (text.startsWith('skip')) {
            require('./skip')(fakeMessage, serverQueue);
        } else if (text.startsWith('pause')) {
            require('./pause')(fakeMessage, serverQueue);
        } else if (text.startsWith('resume')) {
            require('./resume')(fakeMessage, serverQueue);
        } else if (text.startsWith('stop')) {
            require('./stop')(fakeMessage, serverQueue);
        } else {
            message.channel.send('❌ Command not recognized.');
        }
    } catch (err) {
        console.error('Whisper error:', err);
        message.channel.send('❌ Failed to transcribe audio.');
    }
};
