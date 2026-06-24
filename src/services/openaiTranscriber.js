const fs = require('node:fs');
const { OpenAI } = require('openai');

const config = require('../config');
const { openAiError } = require('../utils/errors');
const logger = require('../utils/logger');

const client = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.requestTimeoutMs
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getOpenAiStatusCode(error) {
  if (error && error.status === 429) {
    return 429;
  }

  if (error && error.status >= 400 && error.status < 500) {
    return 502;
  }

  return 502;
}

function isTransientOpenAiError(error) {
  if (!error) {
    return false;
  }

  const message = error.message ? String(error.message) : '';

  if (error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500) {
    return true;
  }

  if (/Premature close|socket hang up|fetch failed/i.test(message)) {
    return true;
  }

  return [
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ETIMEDOUT',
    'ERR_STREAM_PREMATURE_CLOSE',
    'UND_ERR_SOCKET'
  ].includes(error.code);
}

function getSafeOpenAiMessage(error) {
  if (error && error.status === 429) {
    return 'OpenAI rate limit reached';
  }

  if (error && error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
    return 'OpenAI connection closed early';
  }

  if (error && error.code === 'ETIMEDOUT') {
    return 'OpenAI transcription timed out';
  }

  return 'OpenAI transcription failed';
}

async function transcribeChunkOnce(chunkPath, language) {
  const response = await client.audio.transcriptions.create({
    file: fs.createReadStream(chunkPath),
    model: config.openaiTranscribeModel,
    language
  });

  return response.text || '';
}

async function transcribeChunk(chunkPath, language, chunkIndex) {
  let lastError = null;

  for (let attempt = 1; attempt <= config.openaiChunkRetries + 1; attempt += 1) {
    try {
      return await transcribeChunkOnce(chunkPath, language);
    } catch (error) {
      lastError = error;

      if (!isTransientOpenAiError(error) || attempt > config.openaiChunkRetries) {
        throw error;
      }

      const delayMs = config.openaiRetryBaseMs * 2 ** (attempt - 1);

      logger.warn('Retrying chunk transcription after transient OpenAI error', {
        chunk_index: chunkIndex,
        attempt,
        next_attempt: attempt + 1,
        delay_ms: delayMs,
        status: error && error.status,
        code: error && error.code,
        message: error && error.message ? String(error.message).slice(0, 200) : undefined
      });

      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function transcribeChunks(chunkPaths, language) {
  const transcripts = [];
  const failedChunks = [];
  let firstFailureStatusCode = null;

  for (let index = 0; index < chunkPaths.length; index += 1) {
    try {
      const text = await transcribeChunk(chunkPaths[index], language, index + 1);
      transcripts.push({
        index,
        text
      });
    } catch (error) {
      const safeMessage = getSafeOpenAiMessage(error);
      firstFailureStatusCode = firstFailureStatusCode || getOpenAiStatusCode(error);
      failedChunks.push({
        chunk_index: index + 1,
        error: safeMessage
      });

      logger.warn('Chunk transcription failed', {
        chunk_index: index + 1,
        status: error && error.status,
        code: error && error.code,
        message: error && error.message ? String(error.message).slice(0, 200) : undefined
      });
    }
  }

  if (transcripts.length === 0) {
    const firstFailure = failedChunks[0];
    throw openAiError(
      firstFailure ? firstFailure.error : 'OpenAI transcription failed',
      firstFailureStatusCode || 502
    );
  }

  return {
    transcript: transcripts
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.text.trim())
      .filter(Boolean)
      .join('\n\n'),
    failedChunks
  };
}

module.exports = {
  transcribeChunks
};
