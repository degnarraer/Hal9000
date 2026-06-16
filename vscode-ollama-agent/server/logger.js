const EventEmitter = require('events');

class Logger extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.bufferSize = opts.bufferSize || 1000;
    this.buffer = [];
  }

  _push(level, msg) {
    const entry = { ts: new Date().toISOString(), level, msg };
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    this.emit('log', entry);
  }

  info(msg) { this._push('info', String(msg)); }
  warn(msg) { this._push('warn', String(msg)); }
  error(msg) { this._push('error', String(msg)); }
  debug(msg) { this._push('debug', String(msg)); }

  history(limit = 200) {
    return this.buffer.slice(-limit);
  }
}

module.exports = Logger;
