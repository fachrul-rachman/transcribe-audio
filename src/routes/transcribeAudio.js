const path = require('node:path');

const config = require('../config');
const { prepareAudioChunks } = require('../services/audioProcessor');
const { transcribeChunks } = require('../services/openaiTranscriber');
const {
  AppError,
  badRequest,
  openAiError,
  payloadTooLarge,
  toErrorResponse,
  unauthorized
} = require('../utils/errors');
const {
  bytesToMb,
  createRequestTempFolder,
  deleteTempFolderSafe,
  saveUploadStream
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

function getInputFilePath(requestDir, filename, fileIndex) {
  const extension = path.extname(path.basename(filename || '')).toLowerCase();
  const safeIndex = String(fileIndex + 1).padStart(3, '0');

  return path.join(requestDir, `input-${safeIndex}${extension}`);
}

async function readMultipartUpload(request, requestDir) {
  const files = [];
  let language = config.defaultLanguage;

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') {
          part.file.resume();
          continue;
        }

        if (files.length >= MAX_FILES_PER_REQUEST) {
          part.file.resume();
          throw badRequest(`Too many files uploaded. Maximum ${MAX_FILES_PER_REQUEST} files are allowed`);
        }

        const originalFileName = path.basename(part.filename || `audio-${files.length + 1}`);
        const uploadedFile = getInputFilePath(requestDir, originalFileName, files.length);
        const uploadedBytes = await saveUploadStream(part, uploadedFile, config.maxUploadBytes);

        files.push({
          uploadedFile,
          originalFileName,
          uploadedBytes
        });
        continue;
      }

      if (part.fieldname === 'language' && typeof part.value === 'string' && part.value.trim()) {
        language = part.value.trim();
      }
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw payloadTooLarge('Uploaded file exceeds configured max upload size');
    }

    if (error && error.code === 'FST_FILES_LIMIT') {
      throw badRequest(`Too many files uploaded. Maximum ${MAX_FILES_PER_REQUEST} files are allowed`);
    }

    if (error && error.statusCode === 413) {
      throw payloadTooLarge('Uploaded file exceeds configured max upload size');
    }

    throw badRequest('Invalid multipart request');
  }

  if (files.length === 0) {
    throw badRequest('No file uploaded. Expected multipart field: file');
  }

  return {
    files,
    language
  };
}

async function processUploadedFile(uploadedFile, language, requestDir, requestId, fileIndex) {
  logger.info('Audio file uploaded', {
    request_id: requestId,
    file_index: fileIndex + 1,
    file_name: uploadedFile.originalFileName,
    file_size_mb: Number(bytesToMb(uploadedFile.uploadedBytes).toFixed(2))
  });

  const fileWorkDir = path.join(requestDir, `file-${String(fileIndex + 1).padStart(3, '0')}`);
  const audioResult = await prepareAudioChunks(uploadedFile.uploadedFile, fileWorkDir);
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
    file_name: uploadedFile.originalFileName,
    success: true,
    chunk_count: chunkPaths.length,
    transcript: transcription.transcript,
    chunkCount: chunkPaths.length
  };
}

async function transcribeAudioRoute(request, reply) {
  const startedAt = Date.now();
  let requestDir = null;
  let requestId = null;

  try {
    if (getApiKey(request) !== config.apiKey) {
      throw unauthorized();
    }

    const tempContext = await createRequestTempFolder(config.tempDir);
    requestDir = tempContext.requestDir;
    requestId = tempContext.requestId;
    request.transcribeRequestId = requestId;

    logger.info('Transcription request started', { request_id: requestId });

    const upload = await readMultipartUpload(request, requestDir);

    logger.info('Multipart upload received', {
      request_id: requestId,
      file_count: upload.files.length
    });

    const fileResults = [];
    let totalChunkCount = 0;

    for (let fileIndex = 0; fileIndex < upload.files.length; fileIndex += 1) {
      const fileResult = await processUploadedFile(
        upload.files[fileIndex],
        upload.language,
        requestDir,
        requestId,
        fileIndex
      );

      totalChunkCount += fileResult.chunkCount;
      fileResults.push(fileResult);
    }

    logger.info('Transcription completed', {
      request_id: requestId,
      file_count: upload.files.length,
      chunk_count: totalChunkCount,
      duration_ms: Date.now() - startedAt
    });

    const body = {
      success: true,
      file_count: upload.files.length,
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
    };

    return reply.code(200).send(body);
  } catch (error) {
    const response = toErrorResponse(error);

    logger.warn('Transcription request failed', {
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

async function registerTranscribeAudioRoute(fastify) {
  fastify.post('/transcribe-audio', transcribeAudioRoute);
}

module.exports = registerTranscribeAudioRoute;
