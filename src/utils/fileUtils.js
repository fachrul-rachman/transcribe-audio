const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const { badRequest, payloadTooLarge } = require('./errors');

async function ensureDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true });
}

async function createRequestTempFolder(tempDir) {
  await ensureDirectory(tempDir);

  const requestId = crypto.randomUUID();
  const requestDir = path.join(tempDir, `request-${requestId}`);
  await ensureDirectory(requestDir);

  return {
    requestId,
    requestDir
  };
}

function getSafeInputPath(requestDir, filename) {
  const extension = path.extname(path.basename(filename || '')).toLowerCase();
  return path.join(requestDir, `input-original${extension}`);
}

async function saveUploadStream(file, destinationPath, maxUploadBytes) {
  let bytesWritten = 0;
  const output = fs.createWriteStream(destinationPath);

  file.file.on('data', (chunk) => {
    bytesWritten += chunk.length;
  });

  try {
    await pipeline(file.file, output);
  } catch (error) {
    if (error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw payloadTooLarge('Uploaded file exceeds configured max upload size');
    }

    throw error;
  }

  if (file.file.truncated || bytesWritten > maxUploadBytes) {
    throw payloadTooLarge('Uploaded file exceeds configured max upload size');
  }

  if (bytesWritten === 0) {
    throw badRequest('Uploaded file is empty');
  }

  return bytesWritten;
}

async function saveReadableStreamToDisk(readable, destinationPath, maxBytes) {
  let bytesWritten = 0;
  const output = fs.createWriteStream(destinationPath);

  readable.on('data', (chunk) => {
    bytesWritten += chunk.length;

    if (bytesWritten > maxBytes) {
      readable.destroy(payloadTooLarge('Downloaded file exceeds configured max upload size'));
    }
  });

  try {
    await pipeline(readable, output);
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') {
      throw error;
    }

    if (error && error.statusCode === 413) {
      throw payloadTooLarge('Downloaded file exceeds configured max upload size');
    }

    throw error;
  }

  if (bytesWritten === 0) {
    throw badRequest('Downloaded file is empty');
  }

  return bytesWritten;
}

async function getFileSizeBytes(filePath) {
  const stats = await fsp.stat(filePath);
  return stats.size;
}

function bytesToMb(bytes) {
  return bytes / 1024 / 1024;
}

async function deleteTempFolderSafe(requestDir, tempDir) {
  const resolvedRequestDir = path.resolve(requestDir);
  const resolvedTempDir = path.resolve(tempDir);
  const relativePath = path.relative(resolvedTempDir, resolvedRequestDir);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath === '') {
    throw new Error('Refusing to delete path outside temp directory');
  }

  await fsp.rm(resolvedRequestDir, { recursive: true, force: true });
}

async function listChunkFiles(chunksDir) {
  const entries = await fsp.readdir(chunksDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(chunksDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

module.exports = {
  ensureDirectory,
  createRequestTempFolder,
  getSafeInputPath,
  saveUploadStream,
  saveReadableStreamToDisk,
  getFileSizeBytes,
  bytesToMb,
  deleteTempFolderSafe,
  listChunkFiles
};
