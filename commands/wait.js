const queue = require('../commandLock');

module.exports = function(message) {
  const { current, waiting } = queue.list();
  if (!current && waiting.length === 0) {
    return message.channel.send('No requests in the waiting list.');
  }
  const lines = [];
  if (current) lines.push(`Currently processing: ${current}`);
  if (waiting.length) {
    lines.push('Waiting list:');
    waiting.forEach((label, idx) => {
      lines.push(`${idx + 1}. ${label}`);
    });
  }
  message.channel.send(lines.join('\n'));
};
