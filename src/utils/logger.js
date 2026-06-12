function timestamp() {
  return new Date().toISOString();
}

function info(message, meta = {}) {
  console.log(JSON.stringify({ level: 'info', time: timestamp(), message, meta }));
}

function warn(message, meta = {}) {
  console.warn(JSON.stringify({ level: 'warn', time: timestamp(), message, meta }));
}

function error(message, meta = {}) {
  console.error(JSON.stringify({ level: 'error', time: timestamp(), message, meta }));
}

module.exports = {
  info,
  warn,
  error
};
