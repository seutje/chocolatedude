const MAX_QUEUE = 50;

let active = false;
let currentLabel = null;
const queue = [];

async function runNext() {
  if (active || queue.length === 0) return;
  const { label, fn } = queue.shift();
  active = true;
  currentLabel = label;
  try {
    await fn();
  } catch (err) {
    console.error('Inference queue error:', err);
  } finally {
    active = false;
    currentLabel = null;
    runNext();
  }
}

module.exports = {
  enqueue(label, fn) {
    if (queue.length >= MAX_QUEUE) return false;
    const position = active ? queue.length + 1 : queue.length;
    queue.push({ label, fn });
    runNext();
    return position; // number of requests ahead of this one
  },
  list() {
    return { current: currentLabel, waiting: queue.map(i => i.label) };
  },
  isActive: () => active
};
