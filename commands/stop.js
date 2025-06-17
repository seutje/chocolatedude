module.exports = function (message, serverQueue) {
    const queueConstruct = serverQueue.get(message.guild.id);
    if (!queueConstruct) {
        return message.channel.send('❌ I am not in a voice channel.');
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
        return message.channel.send('❌ You must be in the same voice channel as the bot to stop music!');
    }

    queueConstruct.songs = [];
    queueConstruct.player.stop();
    queueConstruct.connection.destroy();
    serverQueue.delete(message.guild.id);
    message.channel.send('⏹️ Stopped playback and left the channel.');
};
