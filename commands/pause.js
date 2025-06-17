const { AudioPlayerStatus } = require('@discordjs/voice');

module.exports = function (message, serverQueue) {
    const queueConstruct = serverQueue.get(message.guild.id);
    if (!queueConstruct || queueConstruct.songs.length === 0) {
        return message.channel.send('❌ There is no music currently playing to pause!');
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
        return message.channel.send('❌ You must be in the same voice channel as the bot to pause music!');
    }

    if (queueConstruct.player.state.status === AudioPlayerStatus.Playing) {
        queueConstruct.player.pause();
        message.channel.send('⏸️ Music paused.');
    } else {
        message.channel.send('❌ Music is not currently playing or is already paused.');
    }
};
