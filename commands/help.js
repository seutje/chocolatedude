module.exports = function (message) {
    const helpMessage = [
        '**Available Commands:**',
        '!play <url or search> - play a YouTube video, playlist or Spotify track/playlist.',
        '!skip - skip the current song.',
        '!pause - pause playback.',
        '!resume - resume if paused.',
        '!stop - stop and leave the voice channel.',
        '!loop [single|all] - cycle looping modes for one song or the whole queue.',
        '!queue - display the current queue.',
        '!search <terms> - show top YouTube results.',
        '!shuffle - shuffle upcoming songs.',
        '!remove <position> - remove a song by its number in the queue.',
        '!listen - record a short voice message and execute the spoken command.',
        '!help - show this message.'
    ].join('\n');

    message.channel.send(helpMessage);
};
