const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getTtsProvider,
  buildPiperEnv,
  getPiperConfigDetails,
  getPiperRuntimeStatus,
  getSupportedTtsProviders,
  piperArgsForOutput,
  resolveTtsProvider,
  splitTextForTts
} = require('../server/tts');
const { sanitizeSettings } = require('../server/ttsSettings');

test('getTtsProvider defaults to piper', () => {
  assert.equal(getTtsProvider({}), 'piper');
  assert.equal(getTtsProvider({ TTS_PROVIDER: 'piper' }), 'piper');
  assert.equal(getTtsProvider({ TTS_PROVIDER: 'unknown' }), 'piper');
});

test('tts provider helpers expose and resolve supported engines', () => {
  assert.deepEqual(getSupportedTtsProviders(), ['piper']);
  assert.equal(resolveTtsProvider('piper', 'piper'), 'piper');
  assert.equal(resolveTtsProvider('unknown', 'piper'), 'piper');
});

test('getPiperConfigDetails exposes speaker options from Piper config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-piper-config-'));
  const configPath = path.join(dir, 'voice.onnx.json');
  fs.writeFileSync(configPath, JSON.stringify({ speaker_id_map: { alice: 1, bob: 0 } }), 'utf8');

  const details = getPiperConfigDetails({ TTS_PIPER_CONFIG: configPath });

  assert.equal(details.loaded, true);
  assert.deepEqual(details.speakers, [
    { label: 'bob', value: '0' },
    { label: 'alice', value: '1' }
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('getPiperRuntimeStatus reports missing and configured model state', () => {
  assert.equal(getPiperRuntimeStatus({}).hasModel, false);
  assert.deepEqual(
    getPiperRuntimeStatus({ TTS_PIPER_MODEL: 'voice.onnx', TTS_PIPER_CONFIG: 'voice.onnx.json' }),
    {
      provider: 'piper',
      bin: 'piper',
      hasModel: true,
      hasConfig: true,
      configLoaded: false
    }
  );
});

test('sanitizeSettings accepts admin-applied voice defaults', () => {
  assert.deepEqual(
    sanitizeSettings({
      provider: 'piper',
      lang: 'en-US',
      piperSpeaker: '1',
      piperLengthScale: '1.1',
      piperNoiseScale: '0.5',
      piperNoiseW: '0.7'
    }, {}),
    {
      provider: 'piper',
      lang: 'en-US',
      piperSpeaker: '1',
      piperLengthScale: '1.1',
      piperNoiseScale: '0.5',
      piperNoiseW: '0.7'
    }
  );
});

test('sanitizeSettings falls back from invalid providers', () => {
  assert.equal(sanitizeSettings({ provider: 'bogus' }, { TTS_PROVIDER: 'piper', TTS_LANG: 'en' }).provider, 'piper');
});

test('sanitizeSettings treats Default labels as empty config values', () => {
  assert.deepEqual(
    sanitizeSettings({
      provider: 'piper',
      lang: 'en',
      piperSpeaker: 'Default',
      piperLengthScale: 'Default',
      piperNoiseScale: 'Default',
      piperNoiseW: 'Default'
    }, {}),
    {
      provider: 'piper',
      lang: 'en',
      piperSpeaker: '',
      piperLengthScale: '',
      piperNoiseScale: '',
      piperNoiseW: ''
    }
  );
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
