function computeUnclosed(str) {
    const stack = [];
    const re = /(```|`|\*{1,3}|_{1,2})/g;
    let m;
    let inFence = false;
    let inInline = false;
    while ((m = re.exec(str)) !== null) {
        const token = m[0];

        if (token === '```') {
            if (stack.length && stack[stack.length - 1] === '```') {
                stack.pop();
            } else {
                stack.push('```');
            }
            inFence = !inFence;
            continue;
        }

        if (inFence) continue;

        if (token === '`') {
            if (stack.length && stack[stack.length - 1] === '`') {
                stack.pop();
                inInline = false;
            } else {
                stack.push('`');
                inInline = true;
            }
            continue;
        }

        if (inInline) continue;

        if (token.startsWith('*')) {
            if (/\s/.test(str[m.index + token.length])) continue;
        } else if (token.startsWith('_')) {
            if (/\s/.test(str[m.index + token.length])) continue;
            const prev = str[m.index - 1];
            const next = str[m.index + token.length];
            if (prev && next && /\w/.test(prev) && /\w/.test(next)) continue;
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
