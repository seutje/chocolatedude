const formatDuration = require('../formatDuration');

describe('formatDuration', () => {
  test('formats 90 seconds as 01:30', () => {
    expect(formatDuration(90)).toBe('01:30');
  });

  test('formats 3700 seconds as 1:01:40', () => {
    expect(formatDuration(3700)).toBe('1:01:40');
  });

  test('returns N/A for invalid input', () => {
    expect(formatDuration(null)).toBe('N/A');
    expect(formatDuration(NaN)).toBe('N/A');
  });
});
