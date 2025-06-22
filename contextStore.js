const contexts = new Map();

module.exports = {
    getContext(id) {
        return contexts.get(id);
    },
    setContext(id, context) {
        if (context) {
            contexts.set(id, context);
        } else {
            contexts.delete(id);
        }
    }
};
