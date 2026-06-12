const fs = require('node:fs');
const { OpenAI } = require('openai');

const config = require('../config');
const { openAiError } = require('../utils/errors');
const logger = require('../utils/logger');

const client = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.requestTimeoutMs
});

function getOpenAiStatusCode(error) {
  if (error && error.status === 429) {
    return 429;
  }

  if (error && error.status >= 400 && error.status < 500) {
    return 502;
  }

  return 502;
}

function getSafeOpenAiMessage(error) {
  if (error && error.status === 429) {
    return 'OpenAI rate limit reached';
  }

  if (error && error.code === 'ETIMEDOUT') {
    return 'OpenAI transcription timed out';
  }

  return 'OpenAI transcription failed';
}

async function transcribeChunk(chunkPath, language) {
  const response = await client.audio.transcriptions.create({
    file: fs.createReadStream(chunkPath),
    model: config.openaiTranscribeModel,
    language
  });

  return response.text || '';
}

async function transcribeChunks(chunkPaths, language) {
  const transcripts = [];
  const failedChunks = [];
  let firstFailureStatusCode = null;

  for (let index = 0; index < chunkPaths.length; index += 1) {
    try {
      const text = await transcribeChunk(chunkPaths[index], language);
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
