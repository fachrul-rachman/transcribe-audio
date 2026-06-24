const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const config = require('../config');
const { audioProcessingError } = require('../utils/errors');
const { ensureDirectory, getFileSizeBytes, listChunkFiles } = require('../utils/fileUtils');

const execFileAsync = promisify(execFile);
const RETRY_DURATIONS_SECONDS = [600, 300, 180, 120, 60];

async function runFfmpeg(args, failureMessage) {
  try {
    await execFileAsync('ffmpeg', args, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw audioProcessingError('ffmpeg is not installed or is not available in PATH', error);
    }

    throw audioProcessingError(failureMessage, error);
  }
}

async function runFfprobe(args, failureMessage) {
  try {
    const result = await execFileAsync('ffprobe', args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });

    return result.stdout;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw audioProcessingError('ffprobe is not installed or is not available in PATH', error);
    }

    throw audioProcessingError(failureMessage, error);
  }
}

async function normalizeAudio(inputPath, outputPath) {
  await runFfmpeg(
    [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      String(config.ffmpegAudioChannels),
      '-b:a',
      config.ffmpegAudioBitrate,
      '-ar',
      String(config.ffmpegAudioSampleRate),
      outputPath
    ],
    'Failed to process audio with ffmpeg'
  );

  await assertGeneratedFile(outputPath, 'ffmpeg did not generate normalized audio');
}

async function getAudioDurationSeconds(filePath) {
  const stdout = await runFfprobe(
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath
    ],
    'Failed to inspect audio duration with ffprobe'
  );

  const duration = Number(String(stdout).trim());

  if (!Number.isFinite(duration) || duration <= 0) {
    throw audioProcessingError('Could not determine audio duration');
  }

  return duration;
}

async function splitAudio(normalizedPath, chunksDir, durationSeconds) {
  await fsp.rm(chunksDir, { recursive: true, force: true });
  await ensureDirectory(chunksDir);

  await runFfmpeg(
    [
      '-y',
      '-i',
      normalizedPath,
      '-f',
      'segment',
      '-segment_time',
      String(durationSeconds),
      '-reset_timestamps',
      '1',
      '-map',
      '0:a',
      '-c:a',
      'libmp3lame',
      '-ac',
      String(config.ffmpegAudioChannels),
      '-b:a',
      config.ffmpegAudioBitrate,
      '-ar',
      String(config.ffmpegAudioSampleRate),
      path.join(chunksDir, 'chunk-%03d.mp3')
    ],
    'Failed to split audio with ffmpeg'
  );

  const chunks = await listChunkFiles(chunksDir);

  if (chunks.length === 0) {
    throw audioProcessingError('ffmpeg did not generate audio chunks');
  }

  return chunks;
}

async function assertGeneratedFile(filePath, message) {
  try {
    const stats = await fsp.stat(filePath);

    if (!stats.isFile() || stats.size === 0) {
      throw new Error(message);
    }
  } catch (error) {
    throw audioProcessingError(message, error);
  }
}

async function validateChunkSizes(chunkPaths) {
  for (const chunkPath of chunkPaths) {
    const sizeBytes = await getFileSizeBytes(chunkPath);

    if (sizeBytes > config.maxChunkBytes) {
      return false;
    }
  }

  return true;
}

function getRetryDurations() {
  const configuredDuration = Number(config.chunkSeconds);
  const fallbackDurations = RETRY_DURATIONS_SECONDS.filter((duration) => duration < configuredDuration);
  const durations = [configuredDuration, ...fallbackDurations]
    .map((duration) => Number(duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0);

  return [...new Set(durations)];
}

async function prepareAudioChunks(inputPath, requestDir) {
  await ensureDirectory(requestDir);

  const normalizedPath = path.join(requestDir, 'normalized.mp3');
  const chunksDir = path.join(requestDir, 'chunks');

  await normalizeAudio(inputPath, normalizedPath);

  const normalizedSizeBytes = await getFileSizeBytes(normalizedPath);
  const normalizedDurationSeconds = await getAudioDurationSeconds(normalizedPath);

  if (
    normalizedSizeBytes <= config.maxChunkBytes &&
    normalizedDurationSeconds <= config.chunkSeconds
  ) {
    return {
      normalizedPath,
      chunks: [normalizedPath]
    };
  }

  for (const durationSeconds of getRetryDurations()) {
    const chunks = await splitAudio(normalizedPath, chunksDir, durationSeconds);
    const chunksAreValid = await validateChunkSizes(chunks);

    if (chunksAreValid) {
      return {
        normalizedPath,
        chunks
      };
    }
  }

  throw audioProcessingError(
    `Generated chunk still exceeds max chunk size of ${config.maxChunkMb}MB after retrying smaller durations`
  );
}

module.exports = {
  prepareAudioChunks
};
