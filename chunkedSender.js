function computeUnclosed(str) {
    const stack = [];
    // capture discord markdown tokens: *, **, ***, _, __, `, ```
    // ignore list markers or underscores followed by whitespace
    const re = /(`{3,}|`|\*{1,3}(?!\s)|_{1,2}(?!\s))/g;
    let m;
    while ((m = re.exec(str)) !== null) {
        const token = m[0];
        if (token.startsWith('_')) {
            const prev = str[m.index - 1];
            const next = str[m.index + token.length];
            if (prev !== undefined && next !== undefined && /\w/.test(prev) && /\w/.test(next)) {
                continue; // ignore foo_bar
            }
        }
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
                    part = textBuffer.slice(0, splitPos); // omit trailing newline
                } else {
                    splitPos = part.lastIndexOf(' ');
                    if (splitPos <= 0) {
                        splitPos = CHUNK_SIZE;
                    } else {
                        const prev = part[splitPos - 1];
                        if (!/[.!?]/.test(prev)) {
                            const nl = part.lastIndexOf('\n');
                            if (nl > 0) splitPos = nl;
                        }
                    }
                    part = textBuffer.slice(0, splitPos);
                }
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
