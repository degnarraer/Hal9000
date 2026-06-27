const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Tests menu exposes Voice Pipeline Tester page', () => {
  const menuJs = read('public/menu.js');
  const testsHtml = read('public/menu-pages/tests.html');
  const indexHtml = read('public/index.html');

  assert.match(menuJs, /voicePipelineTester:\s*\{\s*title:\s*'Voice Pipeline Tester'/);
  assert.match(menuJs, /route:\s*'voicePipelineTester'[\s\S]*title:\s*'Voice Pipeline Tester'/);
  assert.match(testsHtml, /data-admin-route="voicePipelineTester"/);
  assert.match(indexHtml, /\/menu\/voice-pipeline-tester\.js/);
});

test('Voice Pipeline Tester shows every stage in the target voice path', () => {
  const pageHtml = read('public/menu-pages/voice-pipeline-tester.html');

  assert.match(pageHtml, /Mic \/ browser audio/);
  assert.match(pageHtml, /Pipecat transport/);
  assert.match(pageHtml, /VAD \/ turn detection/);
  assert.match(pageHtml, /STT/);
  assert.match(pageHtml, /Ollama/);
  assert.match(pageHtml, /Kokoro TTS/);
  assert.match(pageHtml, /Audio output/);
  assert.match(pageHtml, /id="voicePipelineMicChart"/);
  assert.match(pageHtml, /id="voicePipelineChartStatus"/);
  assert.match(pageHtml, /data-voice-pipeline-renderer="scroll"/);
  assert.match(pageHtml, /data-voice-pipeline-renderer="waveform"/);
  assert.match(pageHtml, /data-voice-pipeline-renderer="power"/);
  assert.match(pageHtml, /id="voicePipelineMicLight"/);
  assert.match(pageHtml, /id="voicePipelineMicAudioLight"/);
  assert.match(pageHtml, /id="voicePipelinePcmLight"/);
  assert.match(pageHtml, /id="voicePipelineTransportLight"/);
  assert.match(pageHtml, /id="voicePipelinePressureLight"/);
  assert.match(pageHtml, /id="voicePipelineVadLight"/);
  assert.match(pageHtml, /id="voicePipelineSttLight"/);
  assert.match(pageHtml, /id="voicePipelineOllamaLight"/);
  assert.match(pageHtml, /id="voicePipelineTtsLight"/);
  assert.match(pageHtml, /id="voicePipelineAudioLight"/);
  assert.match(pageHtml, /id="voicePipelineTranscript"/);
  assert.match(pageHtml, /id="voicePipelineResponse"/);
  assert.match(pageHtml, /id="voicePipelineCopyDebug"/);
  assert.match(pageHtml, /id="voicePipelineToggleVad"/);
  assert.match(pageHtml, /id="voicePipelineToggleStt"/);
  assert.match(pageHtml, /id="voicePipelineToggleLlm"/);
  assert.match(pageHtml, /id="voicePipelineToggleTts"/);
  assert.match(pageHtml, /id="voicePipelineToggleAudio"/);
  assert.match(pageHtml, /id="voicePipelineToggleRawMic"/);
  assert.doesNotMatch(pageHtml, /id="voicePipelineToggleRawMic" type="checkbox" checked/);
  assert.match(pageHtml, /id="voicePipelineToggleChart"/);
  assert.match(pageHtml, /id="voicePipelineToggleEvents"/);
  assert.ok(
    pageHtml.indexOf('id="voicePipelineToggleEvents"') < pageHtml.indexOf('id="voicePipelineMicChart"'),
    'mic chart should occupy the slot after Stage Toggles'
  );
  assert.ok(
    pageHtml.indexOf('id="voicePipelineMicChart"') < pageHtml.indexOf('id="voicePipelineTranscript"'),
    'transcript should render after the mic chart card'
  );
});

test('Voice Pipeline Tester uses the app mic controller with a pipeline provider override', () => {
  const pageJs = read('public/menu/voice-pipeline-tester.js');
  const micJs = read('public/mic.js');

  assert.match(pageJs, /window\.addEventListener\('bob:mic', handleVoicePipelineMicEvent\)/);
  assert.match(pageJs, /navigator\.mediaDevices\?\.addEventListener\?\.\('devicechange', \(\) => queueVoicePipelineInputDeviceRefresh\(\{ reason: 'devicechange' \}\)\)/);
  assert.match(pageJs, /function setVoicePipelineCaptureControlsLocked\(isLocked\)/);
  assert.match(pageJs, /voicePipelineToggleRawMic/);
  assert.match(pageJs, /activeCaptureMode: audioConstraints \? 'raw' : 'browser-processed'/);
  assert.match(pageJs, /function queueVoicePipelineInputDeviceRefresh\(options = \{\}\)/);
  assert.match(pageJs, /voicePipelineRuntime\?\.running && !options\.force/);
  assert.match(pageJs, /input device refresh deferred during active capture/);
  assert.match(pageJs, /function uniqueVoicePipelineInputDevices\(devices = \[\]\)/);
  assert.match(pageJs, /if \(!id \|\| id === 'default'\) return false/);
  assert.match(pageJs, /function getVoicePipelineAudioConstraintsOverride\(\)/);
  assert.match(pageJs, /echoCancellation:\s*false/);
  assert.match(pageJs, /noiseSuppression:\s*false/);
  assert.match(pageJs, /autoGainControl:\s*false/);
  assert.match(pageJs, /window\.__mic\.setSettingsOverride\?\.\(\{\s*transcriptionProvider:\s*'pipeline'/);
  assert.match(pageJs, /audioConstraints/);
  assert.match(pageJs, /RAW MIC CAPTURE CHECKBOX:/);
  assert.match(pageJs, /ACTIVE CAPTURE MODE:/);
  assert.match(pageJs, /ACTIVE TRACK:/);
  assert.match(pageJs, /function getVoicePipelineStageOptions\(\)/);
  assert.match(pageJs, /const stageOptions = getVoicePipelineStageOptions\(\)/);
  assert.match(pageJs, /const needsPipelineTransport = Object\.values\(stageOptions\)\.some\(Boolean\)/);
  assert.match(pageJs, /serverStt:\s*needsPipelineTransport/);
  assert.match(pageJs, /waveform:\s*false/);
  assert.match(pageJs, /voicePipelineVad: stageOptions\.vad/);
  assert.match(pageJs, /voicePipelineStt: stageOptions\.stt/);
  assert.match(pageJs, /voicePipelineLlm: stageOptions\.llm/);
  assert.match(pageJs, /voicePipelineTts: stageOptions\.tts/);
  assert.match(pageJs, /voicePipelineAudioOutput: stageOptions\.audioOutput/);
  assert.match(pageJs, /window\.__mic\.startFromUserButton\(\)/);
  assert.match(pageJs, /window\.__mic\?\.stopFromUserButton\?\.\(\)/);
  assert.match(pageJs, /window\.__mic\?\.setDiagnosticOptions\?\.\(runtime\.previousDiagnostics/);
  assert.match(pageJs, /window\.__mic\?\.setSettingsOverride\?\.\(runtime\.previousSettingsOverride/);
  assert.match(pageJs, /\/api\/voice\/pipeline\/status/);
  assert.match(pageJs, /\/api\/tts\/status/);
  assert.match(pageJs, /detail\.type === 'vad-start'/);
  assert.match(pageJs, /detail\.type === 'vad-end'/);
  assert.match(pageJs, /detail\.type === 'stt-start'/);
  assert.match(pageJs, /detail\.type === 'stt-complete'/);
  assert.match(pageJs, /detail\.type === 'stage-options'/);
  assert.match(pageJs, /detail\.type === 'stage-skipped'/);
  assert.match(pageJs, /detail\.type === 'assistant-text'/);
  assert.match(pageJs, /detail\.type === 'audio-output'/);
  assert.match(pageJs, /detail\.type === 'media-device-change'/);
  assert.match(pageJs, /detail\.type === 'voice-pipeline-audio-playback'/);
  assert.match(pageJs, /setVoicePipelineLamp\('MicAudio'/);
  assert.match(pageJs, /Mic producing audio/);
  assert.match(pageJs, /Mic audio is 0/);
  assert.match(pageJs, /setVoicePipelineLamp\('Pcm'/);
  assert.match(pageJs, /PCM audio is 0/);
  assert.match(pageJs, /MIC AUDIO:/);
  assert.match(pageJs, /if \(detail\.type !== 'audio-pump'\) \{/);
  assert.match(pageJs, /chartSource:\s*'analyser'/);
  assert.match(pageJs, /function startVoicePipelineChartLoop\(\)/);
  assert.match(pageJs, /function stopVoicePipelineChartLoop\(\)/);
  assert.match(pageJs, /window\.__mic\?\.getAudioLevelSnapshot\?\.\(\)/);
  assert.match(pageJs, /function queueVoicePipelineMicChart\(detail\)/);
  assert.match(pageJs, /requestAnimationFrame\(drawVoicePipelineMicChart\)/);
  assert.match(pageJs, /function drawVoicePipelineMicChart\(\)/);
  assert.match(pageJs, /let voicePipelineRendererMode = 'scroll'/);
  assert.match(pageJs, /function setVoicePipelineRendererMode\(mode/);
  assert.match(pageJs, /data-voice-pipeline-renderer/);
  assert.match(pageJs, /function drawVoicePipelineSharedWaveform\(\)/);
  assert.match(pageJs, /renderWaveformToCanvas/);
  assert.match(pageJs, /function drawVoicePipelinePowerBar\(\)/);
  assert.match(pageJs, /voicePipelineChartSamples\.unshift/);
  assert.match(pageJs, /scaleVoicePipelineAudioLevel/);
  assert.match(pageJs, /chart draw pressure/);
  assert.match(pageJs, /CHART MODE:/);
  assert.match(pageJs, /VOICE_PIPELINE_CHART_STATUS_MS/);
  assert.match(pageJs, /VOICE_PIPELINE_CHART_PRESSURE_LOG_MS/);
  assert.match(pageJs, /if \(!getVoicePipelineUiOptions\(\)\.chart\) return/);
  assert.match(pageJs, /area === 'pipecat-transport'/);
  assert.match(pageJs, /area === 'voice-pipeline'/);
  assert.match(pageJs, /detail\.pressure === true/);
  assert.match(pageJs, /detail\.socketPressure/);
  assert.match(pageJs, /setVoicePipelineLamp\('Pressure'/);
  assert.match(pageJs, /function voicePipelinePressureReason\(detail = \{\}\)/);
  assert.match(pageJs, /pressure \? `Transport \$\{pressureReason\}` : 'Transport good'/);
  assert.match(pageJs, /function formatVoicePipelineBytes\(bytes\)/);
  assert.match(pageJs, /BACK PRESSURE:/);

  assert.match(micJs, /let micSettingsOverride = null/);
  assert.match(micJs, /function setMicSettingsOverride\(settings = null\)/);
  assert.match(micJs, /function getMicSettingsOverride\(\)/);
  assert.match(micJs, /if \(micSettingsOverride\)/);
  assert.match(micJs, /setSettingsOverride: setMicSettingsOverride/);
  assert.match(micJs, /function getMicAudioLevelSnapshot\(\)/);
  assert.match(micJs, /getAudioLevelSnapshot: getMicAudioLevelSnapshot/);
});
