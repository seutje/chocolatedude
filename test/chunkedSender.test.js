const { createChunkSender } = require('../chunkedSender');

describe('createChunkSender', () => {
  test('splits long text into multiple messages', async () => {
    const sent = [];
    const channel = { send: async (msg) => { sent.push(msg); } };
    const send = createChunkSender(channel);
    const longText = 'a'.repeat(2000);
    await send(longText);
    await send('', true);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.join('')).toBe(longText);
    for (const msg of sent) {
      expect(msg.length).toBeLessThanOrEqual(2000);
    }
  });

  test('closes unclosed markdown across chunks', async () => {
    const sent = [];
    const channel = { send: async (msg) => { sent.push(msg); } };
    const send = createChunkSender(channel);
    const text = 'a'.repeat(1949) + '*' + 'b';
    await send(text);
    await send('', true);
    expect(sent.length).toBe(2);
    expect(sent[0].endsWith('**')).toBe(true);
    expect(sent[1]).toBe('*b*');
  });

  test('maintains bold formatting across chunks', async () => {
    const sent = [];
    const channel = { send: async (msg) => { sent.push(msg); } };
    const send = createChunkSender(channel);
    const text = 'a'.repeat(1948) + '**' + 'bold';
    await send(text);
    await send('', true);
    expect(sent.length).toBe(2);
    expect(sent[0].endsWith('****')).toBe(true);
    expect(sent[1]).toBe('**bold**');
  });

  test('maintains underscore italics across chunks', async () => {
    const sent = [];
    const channel = { send: async (msg) => { sent.push(msg); } };
    const send = createChunkSender(channel);
    const text = 'a'.repeat(1949) + '_' + 'b';
    await send(text);
    await send('', true);
    expect(sent.length).toBe(2);
    expect(sent[0].endsWith('__')).toBe(true);
    expect(sent[1]).toBe('_b_');
  });

  test('handles code fences across chunks', async () => {
    const sent = [];
    const channel = { send: async (msg) => { sent.push(msg); } };
    const send = createChunkSender(channel);
    const text = 'a'.repeat(1947) + '```' + 'js\nconsole.log(1)';
    await send(text);
    await send('', true);
    expect(sent.length).toBe(2);
    expect(sent[0].endsWith('````')).toBe(true);
    expect(sent[1].startsWith('```')).toBe(true);
  });

  test('splits at newline without breaking words', async () => {
    const sent = [];
    const channel = { send: async (msg) => { sent.push(msg); } };
    const send = createChunkSender(channel);
    const text = 'Paragraph one.\n'.padEnd(1940, 'a') + '\nParagraph two.';
    await send(text);
    await send('', true);
    expect(sent.length).toBe(2);
    expect(sent[0].endsWith('\n')).toBe(true);
    expect(sent.join('')).toBe(text);
  });
});
