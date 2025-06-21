module.exports = async function (message) {
    const args = message.content.split(' ').slice(1);
    const prompt = args.join(' ');

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the image command.');
    }

    // Notify the user before starting generation
    await message.channel.send('⏳ Generating image, please wait...');

    const apiUrl = process.env.DIFFUSION_URL || 'http://localhost:5000/generate_and_upscale';

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        if (!result.image_base64) {
            throw new Error("Response missing 'image_base64'");
        }

        const buffer = Buffer.from(result.image_base64, 'base64');
        await message.channel.send({ files: [{ attachment: buffer, name: 'image.png' }] });
    } catch (error) {
        console.error('Error during !image command:', error);
        message.channel.send('❌ Failed to generate the image.');
    }
};
