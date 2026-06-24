const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

function readNumber(name, fallback) {
  const rawValue = process.env[name] ?? fallback;
  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function readNonNegativeNumber(name, fallback) {
  const rawValue = process.env[name] ?? fallback;
  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return value;
}

function readString(name, fallback) {
  const value = process.env[name] ?? fallback;

  if (!value || String(value).trim() === '') {
    throw new Error(`${name} is required`);
  }

  return String(value).trim();
}

const tempDir = path.resolve(process.cwd(), readString('TEMP_DIR', './temp'));

const config = {
  port: readNumber('PORT', '3000'),
  host: readString('HOST', '0.0.0.0'),
  openaiApiKey: readString('OPENAI_API_KEY'),
  openaiTranscribeModel: readString('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-transcribe'),
  apiKey: readString('API_KEY'),
  defaultLanguage: readString('DEFAULT_LANGUAGE', 'id'),
  tempDir,
  maxUploadMb: readNumber('MAX_UPLOAD_MB', '500'),
  maxChunkMb: readNumber('MAX_CHUNK_MB', '24'),
  chunkSeconds: readNumber('CHUNK_SECONDS', '600'),
  ffmpegAudioBitrate: readString('FFMPEG_AUDIO_BITRATE', '64k'),
  ffmpegAudioChannels: readNumber('FFMPEG_AUDIO_CHANNELS', '1'),
  ffmpegAudioSampleRate: readNumber('FFMPEG_AUDIO_SAMPLE_RATE', '16000'),
  requestTimeoutMs: readNumber('REQUEST_TIMEOUT_MS', '1800000'),
  openaiChunkRetries: readNonNegativeNumber('OPENAI_CHUNK_RETRIES', '3'),
  openaiRetryBaseMs: readNumber('OPENAI_RETRY_BASE_MS', '1000')
};

config.maxUploadBytes = config.maxUploadMb * 1024 * 1024;
config.maxChunkBytes = config.maxChunkMb * 1024 * 1024;

module.exports = config;
