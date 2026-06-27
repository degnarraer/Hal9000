class BobSttCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.offset = 0;
    this.workerPort = null;
    this.sequence = 0;
    this.lastChunkFrame = 0;
    this.port.onmessage = event => {
      if (event.data?.type === 'worker-port') this.workerPort = event.ports?.[0] || null;
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;

    let readOffset = 0;
    while (readOffset < input.length) {
      const writable = Math.min(this.bufferSize - this.offset, input.length - readOffset);
      this.buffer.set(input.subarray(readOffset, readOffset + writable), this.offset);
      this.offset += writable;
      readOffset += writable;

      if (this.offset >= this.bufferSize) {
        const chunk = this.buffer;
        const levels = this.inputLevels(chunk);
        this.sequence += 1;
        const frameGap = this.lastChunkFrame ? currentFrame - this.lastChunkFrame : this.bufferSize;
        this.lastChunkFrame = currentFrame;
        const gapMs = (frameGap / sampleRate) * 1000;
        this.port.postMessage({
          type: 'metrics',
          level: levels.average,
          peak: levels.peak,
          sequence: this.sequence,
          gapMs,
          expectedGapMs: (this.bufferSize / sampleRate) * 1000
        });
        if (this.workerPort) {
          this.workerPort.postMessage({ type: 'chunk', input: chunk }, [chunk.buffer]);
        } else {
          this.port.postMessage({ type: 'chunk', input: chunk }, [chunk.buffer]);
        }
        this.buffer = new Float32Array(this.bufferSize);
        this.offset = 0;
      }
    }

    return true;
  }

  inputLevels(input) {
    let sum = 0;
    let peak = 0;
    for (let index = 0; index < input.length; index += 1) {
      const value = Math.abs(input[index] || 0);
      sum += value;
      if (value > peak) peak = value;
    }
    return { average: sum / Math.max(1, input.length), peak };
  }
}

registerProcessor('bob-stt-capture', BobSttCaptureProcessor);
