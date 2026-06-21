const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getTtsProvider,
  buildPiperEnv,
  getSupportedTtsProviders,
  piperArgsForOutput,
  resolveTtsProvider,
  splitTextForTts
} = require('../server/tts');

test('getTtsProvider defaults to google and accepts piper', () => {
  assert.equal(getTtsProvider({}), 'google');
  assert.equal(getTtsProvider({ TTS_PROVIDER: 'piper' }), 'piper');
  assert.equal(getTtsProvider({ TTS_PROVIDER: 'unknown' }), 'google');
});

test('tts provider helpers expose and resolve supported engines', () => {
  assert.deepEqual(getSupportedTtsProviders(), ['google', 'piper', 'windows']);
  assert.equal(resolveTtsProvider('piper', 'google'), 'piper');
  assert.equal(resolveTtsProvider('windows', 'google'), 'windows');
  assert.equal(resolveTtsProvider('unknown', 'piper'), 'piper');
});

test('buildPiperEnv applies tester voice overrides', () => {
  const env = buildPiperEnv({
    speaker: '2',
    lengthScale: '1.2',
    noiseScale: '0.4',
    noiseW: '0.7'
  }, { TTS_PIPER_MODEL: 'voice.onnx' });

  assert.equal(env.TTS_PIPER_SPEAKER, '2');
  assert.equal(env.TTS_PIPER_LENGTH_SCALE, '1.2');
  assert.equal(env.TTS_PIPER_NOISE_SCALE, '0.4');
  assert.equal(env.TTS_PIPER_NOISE_W, '0.7');
});

test('splitTextForTts keeps short text intact', () => {
  assert.deepEqual(splitTextForTts('  Hello   there.  ', 200), ['Hello there.']);
});

test('splitTextForTts prefers sentence and word boundaries', () => {
  const chunks = splitTextForTts('First sentence. Second sentence has several words in it. Third sentence.', 35);
  assert.deepEqual(chunks, [
    'First sentence.',
    'Second sentence has several words',
    'in it. Third sentence.'
  ]);
});

test('piperArgsForOutput requires a model', () => {
  assert.throws(() => piperArgsForOutput('out.wav', {}), /TTS_PIPER_MODEL/);
});

test('piperArgsForOutput includes optional voice controls', () => {
  assert.deepEqual(
    piperArgsForOutput('out.wav', {
      TTS_PIPER_MODEL: 'voice.onnx',
      TTS_PIPER_CONFIG: 'voice.json',
      TTS_PIPER_SPEAKER: '1',
      TTS_PIPER_LENGTH_SCALE: '1.05',
      TTS_PIPER_NOISE_SCALE: '0.55',
      TTS_PIPER_NOISE_W: '0.8'
    }),
    [
      '--model', 'voice.onnx',
      '--output_file', 'out.wav',
      '--config', 'voice.json',
      '--speaker', '1',
      '--length_scale', '1.05',
      '--noise_scale', '0.55',
      '--noise_w', '0.8'
    ]
  );
});
