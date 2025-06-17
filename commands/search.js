const youtubeSearch = require('youtube-search-without-api-key');

module.exports = async function (message) {
    const args = message.content.split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return message.channel.send('❌ Please provide search terms for the search command.');
    }

    try {
        const searchResults = await youtubeSearch.search(query);

        if (!searchResults.length) {
            return message.channel.send('❌ No search results found for your query.');
        }

        let responseMessage = '🔍 **Top 10 YouTube Search Results:**\n';
        searchResults.slice(0, 10).forEach((result, index) => {
            responseMessage += `${index + 1}. **${result.title}**\n   URL: <${result.url}>\n`;
        });

        message.channel.send(responseMessage);
    } catch (error) {
        console.error('Error during YouTube search for !search command:', error);
        message.channel.send('❌ An error occurred while performing the search. Please try again.');
    }
};
