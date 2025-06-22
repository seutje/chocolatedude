const { getContext, setContext } = require('../contextStore');

describe('contextStore', () => {
  test('stores and retrieves context by id', () => {
    const ctx = [1,2,3];
    setContext('user', ctx);
    expect(getContext('user')).toBe(ctx);
  });

  test('clears context when set to null', () => {
    setContext('user', null);
    expect(getContext('user')).toBeUndefined();
  });
});
