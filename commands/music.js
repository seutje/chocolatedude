const { fetch, Agent } = require('undici');
const { spawn } = require('child_process');
const queue = require('../commandLock');

module.exports = async function (message) {
    const match = message.content.match(/^!music(?::(\d+))?\s*(.*)$/s);
    const length = match && match[1] ? parseInt(match[1], 10) : undefined;
    let remainder = match ? match[2].trim() : '';

    let lyrics;
    const lyricsIndex = remainder.indexOf('--lyrics');
    if (lyricsIndex !== -1) {
        lyrics = remainder.slice(lyricsIndex + 8).trim();
        remainder = remainder.slice(0, lyricsIndex).trim();
    }
    const prompt = remainder;

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the music command.');
    }

    const label = `!music by ${message.author.username}`;
    const ahead = queue.enqueue(label, async () => {
        await message.channel.send('⏳ Generating music, please wait...');

        const apiUrl = process.env.MUSIC_URL || 'http://localhost:8000';

        try {
            const agent = new Agent({ headersTimeout: 20 * 60 * 1000 });
            const payload = { prompt };
            if (length) payload.length = length;
            if (lyrics) payload.lyrics = lyrics;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                dispatcher: agent
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            if (!result.audio_base64) {
                throw new Error("Response missing 'audio_base64'");
            }

            const flacBuffer = Buffer.from(result.audio_base64, 'base64');

            // Convert FLAC to MP3 using ffmpeg from the system path
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-f', 'mp3',
                'pipe:1'
            ]);

            const mp3Chunks = [];
            ffmpeg.stdout.on('data', chunk => mp3Chunks.push(chunk));

            const conversionPromise = new Promise((resolve, reject) => {
                ffmpeg.on('close', code => {
                    if (code === 0) resolve();
                    else reject(new Error(`ffmpeg exited with code ${code}`));
                });
                ffmpeg.on('error', reject);
            });

            ffmpeg.stdin.write(flacBuffer);
            ffmpeg.stdin.end();

            await conversionPromise;

            const mp3Buffer = Buffer.concat(mp3Chunks);
            await message.channel.send({ files: [{ attachment: mp3Buffer, name: 'music.mp3' }] });
        } catch (error) {
            console.error('Error during !music command:', error);
            message.channel.send('❌ Failed to generate the music.');
        }
    });

    if (ahead === false) {
        return message.channel.send('❌ The waiting list is full. Please try again later.');
    }
    if (ahead > 0) {
        message.channel.send(`⌛ Added to waiting list. There are ${ahead} request(s) ahead of you.`);
    }
};
