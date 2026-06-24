const path = require('node:path');

const config = require('../config');
const { downloadDriveFile } = require('../services/googleDriveDownloader');
const { prepareAudioChunks } = require('../services/audioProcessor');
const { transcribeChunks } = require('../services/openaiTranscriber');
const {
  badRequest,
  openAiError,
  toErrorResponse,
  unauthorized
} = require('../utils/errors');
const {
  bytesToMb,
  createRequestTempFolder,
  deleteTempFolderSafe
} = require('../utils/fileUtils');
const logger = require('../utils/logger');

const MAX_FILES_PER_REQUEST = 5;

function getApiKey(request) {
  const value = request.headers['x-api-key'];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Expected JSON body');
  }

  if (!Array.isArray(body.file_ids)) {
    throw badRequest('Expected file_ids array');
  }

  if (body.file_ids.length === 0) {
    throw badRequest('file_ids must contain at least one file ID');
  }

  if (body.file_ids.length > MAX_FILES_PER_REQUEST) {
    throw badRequest(`Too many file IDs. Maximum ${MAX_FILES_PER_REQUEST} files are allowed`);
  }

  const fileIds = body.file_ids.map((fileId) => {
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw badRequest('file_ids must contain non-empty strings');
    }

    return fileId.trim();
  });

  const language =
    typeof body.language === 'string' && body.language.trim()
      ? body.language.trim()
      : config.defaultLanguage;

  return {
    fileIds,
    language
  };
}

async function processDriveFile(downloadedFile, language, requestDir, requestId, fileIndex) {
  logger.info('Google Drive file downloaded', {
    request_id: requestId,
    file_index: fileIndex + 1,
    file_name: downloadedFile.originalFileName,
    file_size_mb: Number(bytesToMb(downloadedFile.uploadedBytes).toFixed(2))
  });

  const fileWorkDir = path.join(requestDir, `file-${String(fileIndex + 1).padStart(3, '0')}`);
  const audioResult = await prepareAudioChunks(downloadedFile.uploadedFile, fileWorkDir);
  const chunkPaths = audioResult.chunks;

  logger.info('Audio prepared for transcription', {
    request_id: requestId,
    file_index: fileIndex + 1,
    chunk_count: chunkPaths.length
  });

  const transcription = await transcribeChunks(chunkPaths, language);

  if (transcription.failedChunks.length > 0) {
    logger.warn('File transcription had failed chunks', {
      request_id: requestId,
      file_index: fileIndex + 1,
      failed_chunks: transcription.failedChunks
    });

    throw openAiError('OpenAI transcription failed');
  }

  return {
    file_index: fileIndex + 1,
    file_name: downloadedFile.originalFileName,
    success: true,
    chunk_count: chunkPaths.length,
    transcript: transcription.transcript,
    chunkCount: chunkPaths.length
  };
}

async function transcribeDriveFilesRoute(request, reply) {
  const startedAt = Date.now();
  let requestDir = null;
  let requestId = null;

  try {
    if (getApiKey(request) !== config.apiKey) {
      throw unauthorized();
    }

    const input = validateBody(request.body);
    const tempContext = await createRequestTempFolder(config.tempDir);
    requestDir = tempContext.requestDir;
    requestId = tempContext.requestId;

    logger.info('Drive transcription request started', {
      request_id: requestId,
      file_count: input.fileIds.length
    });

    const fileResults = [];
    let totalChunkCount = 0;

    for (let fileIndex = 0; fileIndex < input.fileIds.length; fileIndex += 1) {
      const downloadedFile = await downloadDriveFile(input.fileIds[fileIndex], requestDir, fileIndex);
      const fileResult = await processDriveFile(
        downloadedFile,
        input.language,
        requestDir,
        requestId,
        fileIndex
      );

      totalChunkCount += fileResult.chunkCount;
      fileResults.push(fileResult);
    }

    logger.info('Drive transcription completed', {
      request_id: requestId,
      file_count: input.fileIds.length,
      chunk_count: totalChunkCount,
      duration_ms: Date.now() - startedAt
    });

    return reply.code(200).send({
      success: true,
      file_count: input.fileIds.length,
      total_chunk_count: totalChunkCount,
      merged_transcript: fileResults
        .map((fileResult) => fileResult.transcript.trim())
        .filter(Boolean)
        .join('\n\n'),
      files: fileResults.map((fileResult) => ({
        file_index: fileResult.file_index,
        file_name: fileResult.file_name,
        success: fileResult.success,
        chunk_count: fileResult.chunk_count,
        transcript: fileResult.transcript
      }))
    });
  } catch (error) {
    const response = toErrorResponse(error);

    logger.warn('Drive transcription request failed', {
      request_id: requestId,
      error: response.body.error,
      message: response.body.message,
      duration_ms: Date.now() - startedAt
    });

    return reply.code(response.statusCode).send(response.body);
  } finally {
    if (requestDir) {
      try {
        await deleteTempFolderSafe(requestDir, config.tempDir);
      } catch (cleanupError) {
        logger.warn('Temp cleanup failed', {
          request_id: requestId,
          message: cleanupError.message
        });
      }
    }
  }
}

async function registerTranscribeDriveFilesRoute(fastify) {
  fastify.post('/transcribe-drive-files', transcribeDriveFilesRoute);
}

module.exports = registerTranscribeDriveFilesRoute;
