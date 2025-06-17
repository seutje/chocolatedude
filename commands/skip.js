module.exports = function (message, serverQueue) {
    const queueConstruct = serverQueue.get(message.guild.id);
    if (!queueConstruct || !queueConstruct.songs.length) {
        return message.channel.send('❌ There are no songs in the queue to skip!');
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
        return message.channel.send('❌ You must be in the same voice channel as the bot to skip music!');
    }

    if (queueConstruct.loop === 'single') {
        queueConstruct.loop = 'none';
        message.channel.send('🔁 Single song looping disabled due to skip.');
    }
    queueConstruct.player.stop();
    message.channel.send('⏭️ Skipped the current song.');
};
