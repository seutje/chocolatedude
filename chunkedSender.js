function computeUnclosed(str) {
    const stack = [];
    // capture discord markdown tokens: *, **, ***, _, __, `, ```
    // ignore single asterisks used for list markers
    const re = /(`{3,}|`|\*{1,3}(?!\s)|_{1,2})/g;
    let m;
    while ((m = re.exec(str)) !== null) {
        const token = m[0];
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
                let splitPos = part.lastIndexOf('\n');
                if (splitPos > 0) {
                    splitPos += 1; // keep newline with the first chunk
                } else {
                    splitPos = part.lastIndexOf(' ');
                    if (splitPos <= 0) {
                        splitPos = CHUNK_SIZE;
                    } else {
                        const prev = part[splitPos - 1];
                        if (!/[.!?]/.test(prev)) {
                            const nl = part.lastIndexOf('\n');
                            if (nl > 0) splitPos = nl + 1;
                        }
                    }
                }
                part = textBuffer.slice(0, splitPos);
            }
            const chunk = prefix + part;
            const unclosed = computeUnclosed(chunk);
            const closing = unclosed.slice().reverse().join('');
            await channel.send(chunk + closing);
            prefix = unclosed.join('');
            textBuffer = textBuffer.slice(part.length);
        }
    };
}

module.exports = { computeUnclosed, createChunkSender };
