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
        '!ask <prompt> - ask a question using the local Ollama API. Attach images to include them with the prompt.',
        '!image[:seed] <prompt> - generate an image using the API at DIFFUSION_URL. The resulting seed will be displayed with the image.',
        '!music[:length] <prompt> [--lyrics text] - generate music using the API at MUSIC_URL. Specify a length like !music:120 and optionally provide lyrics.',
        '!wait - show the waiting list for AI requests.',
        '!game - get a link to a fun browser game.',
        '!listen - record a short voice message and execute the spoken command (e.g. play, skip, image).',
        '!help - show this message.'
    ].join('\n');

    message.channel.send(helpMessage);
};
