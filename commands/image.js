const { fetch, Agent } = require('undici');
const lock = require('../commandLock');

// Track whether an image generation request is in progress
let isImageRequestActive = false;

module.exports = async function (message) {
    const match = message.content.match(/^!image(?::(\d+))?\s*(.*)$/s);
    const seed = match && match[1] ? parseInt(match[1], 10) : undefined;
    const prompt = match ? match[2].trim() : '';

    if (isImageRequestActive || !lock.acquire()) {
        return message.channel.send('❌ Another request is already in progress. Please wait for it to finish.');
    }

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the image command.');
    }

    // Notify the user before starting generation and mark as active
    await message.channel.send('⏳ Generating image, please wait...');
    isImageRequestActive = true;
    const resetTimeout = setTimeout(() => {
        isImageRequestActive = false;
        lock.release();
    }, 20 * 60 * 1000); // safety timeout matching the request timeout

    const apiUrl = process.env.DIFFUSION_URL || 'http://localhost:5000/generate_and_upscale';

    try {
        const agent = new Agent({ headersTimeout: 20 * 60 * 1000 });
        const payload = { prompt };
        if (seed !== undefined) payload.seed = seed;
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
        if (!result.image_base64) {
            throw new Error("Response missing 'image_base64'");
        }

        const buffer = Buffer.from(result.image_base64, 'base64');
        const usedSeed = result.seed !== undefined ? result.seed : seed;
        const captionParts = [`Prompt: ${prompt}`];
        if (usedSeed !== undefined) captionParts.push(`Seed: ${usedSeed}`);
        const caption = captionParts.join(' | ');
        await message.channel.send({
            content: caption,
            files: [{ attachment: buffer, name: 'image.png' }]
        });
    } catch (error) {
        console.error('Error during !image command:', error);
        message.channel.send('❌ Failed to generate the image.');
    } finally {
        clearTimeout(resetTimeout);
        isImageRequestActive = false;
        lock.release();
    }
};
