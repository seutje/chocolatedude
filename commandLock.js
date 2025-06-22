let active = false;

module.exports = {
  isActive: () => active,
  acquire() {
    if (active) return false;
    active = true;
    return true;
  },
  release() {
    active = false;
  }
};
