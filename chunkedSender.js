function computeUnclosed(str) {
    const stack = [];
    const re = /(\*{1,3})/g; // handle only asterisks, ignore underscores
    let m;
    while ((m = re.exec(str)) !== null) {
        const token = m[1];
        if (stack.length && stack[stack.length - 1] === token) {
            stack.pop();
        } else {
            stack.push(token);
        }
    }
    return stack;
}

const CHUNK_SIZE = 1950;

function createChunkSender(channel) {
    let textBuffer = '';
    let prefix = '';
    return async function send(text = '', force = false) {
        textBuffer += text;
        while (textBuffer.length >= CHUNK_SIZE || (force && textBuffer.length)) {
            let part = textBuffer.slice(0, CHUNK_SIZE);
            if (textBuffer.length > CHUNK_SIZE) {
                let splitPos = Math.max(part.lastIndexOf('\n'), part.lastIndexOf(' '));
                if (splitPos <= 0) splitPos = CHUNK_SIZE;
                part = textBuffer.slice(0, splitPos);
            }
            const chunk = prefix + part;
            const unclosed = computeUnclosed(chunk);
            const closing = unclosed.slice().reverse().join('');
            await channel.send((chunk + closing).trimStart());
            prefix = unclosed.join('');
            textBuffer = textBuffer.slice(part.length);
        }
    };
}

module.exports = { computeUnclosed, createChunkSender };
