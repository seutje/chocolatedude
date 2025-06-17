/**
 * Formats a duration in seconds into a MM:SS or HH:MM:SS string.
 * @param {number} totalSeconds The total number of seconds.
 * @returns {string} The formatted duration string.
 */
function formatDuration(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds === null) return 'N/A';
    totalSeconds = Math.floor(totalSeconds);

    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) {
        parts.push(String(hours));
    }
    parts.push(String(minutes).padStart(2, '0'));
    parts.push(String(seconds).padStart(2, '0'));

    return parts.join(':');
}

module.exports = formatDuration;
