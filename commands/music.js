const { fetch, Agent } = require('undici');
const lock = require('../commandLock');

let isMusicRequestActive = false;

module.exports = async function (message) {
    const match = message.content.match(/^!music\s+(.*)$/s);
    const prompt = match ? match[1].trim() : '';

    if (isMusicRequestActive || !lock.acquire()) {
        return message.channel.send('❌ Another request is already in progress. Please wait for it to finish.');
    }

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the music command.');
    }

    await message.channel.send('⏳ Generating music, please wait...');
    isMusicRequestActive = true;
    const resetTimeout = setTimeout(() => {
        isMusicRequestActive = false;
        lock.release();
    }, 20 * 60 * 1000);

    const apiUrl = process.env.MUSIC_URL || 'http://localhost:8000';

    try {
        const agent = new Agent({ headersTimeout: 20 * 60 * 1000 });
        const payload = { prompt };
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

        const buffer = Buffer.from(result.audio_base64, 'base64');
        await message.channel.send({ files: [{ attachment: buffer, name: 'music.mp3' }] });
    } catch (error) {
        console.error('Error during !music command:', error);
        message.channel.send('❌ Failed to generate the music.');
    } finally {
        clearTimeout(resetTimeout);
        isMusicRequestActive = false;
        lock.release();
    }
};
