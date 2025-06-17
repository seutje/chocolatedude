module.exports = async function (message, serverQueue, client) {
    const queueConstruct = serverQueue.get(message.guild.id);
    if (!queueConstruct) {
        return message.channel.send('❌ There is no active queue to toggle video!');
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
        return message.channel.send('❌ You must be in the same voice channel as the bot to toggle video!');
    }

    queueConstruct.streamVideo = !queueConstruct.streamVideo;
    const status = queueConstruct.streamVideo ? 'enabled' : 'disabled';
    message.channel.send(`📺 Video streaming ${status}. This will take effect on the next song.`);

    if (queueConstruct.streamVideo) {
        try {
            const invite = await client.discordTogether.createTogetherCode(queueConstruct.voiceChannel.id, 'youtube');
            message.channel.send(`▶️ Join the watch party: ${invite.code}`);
        } catch (error) {
            console.error('Error creating YouTube Together session:', error);
            message.channel.send('❌ Failed to start a watch party.');
        }
    }
};
