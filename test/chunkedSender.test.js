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
});
