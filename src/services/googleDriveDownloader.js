const path = require('node:path');

const { google } = require('googleapis');

const config = require('../config');
const { AppError, badRequest, googleDriveError } = require('../utils/errors');
const { saveReadableStreamToDisk } = require('../utils/fileUtils');

function getPrivateKey() {
  if (!config.googleServiceAccountPrivateKey) {
    return null;
  }

  return config.googleServiceAccountPrivateKey.replace(/\\n/g, '\n');
}

function createDriveClient() {
  if (!config.googleServiceAccountClientEmail || !config.googleServiceAccountPrivateKey) {
    throw googleDriveError('Google Drive service account is not configured', 500);
  }

  const auth = new google.auth.JWT({
    email: config.googleServiceAccountClientEmail,
    key: getPrivateKey(),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({
    version: 'v3',
    auth
  });
}

function getSafeDriveInputPath(requestDir, fileName, fileIndex) {
  const extension = path.extname(path.basename(fileName || '')).toLowerCase();
  const safeIndex = String(fileIndex + 1).padStart(3, '0');

  return path.join(requestDir, `drive-input-${safeIndex}${extension}`);
}

function mapDriveError(error, fileIndex) {
  if (error instanceof AppError) {
    return error;
  }

  const status = error && error.code;

  if (status === 404) {
    return badRequest(`Google Drive file ${fileIndex + 1} was not found or is not shared with the service account`);
  }

  if (status === 403) {
    return badRequest(`Google Drive file ${fileIndex + 1} is not accessible by the service account`);
  }

  return googleDriveError(`Failed to download Google Drive file ${fileIndex + 1}`, 502, error);
}

async function downloadDriveFile(fileId, requestDir, fileIndex) {
  const drive = createDriveClient();

  try {
    const metadataResponse = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size'
    });

    const metadata = metadataResponse.data;

    if (!metadata || !metadata.name) {
      throw googleDriveError(`Google Drive file ${fileIndex + 1} has no metadata`);
    }

    if (metadata.mimeType && metadata.mimeType.startsWith('application/vnd.google-apps.')) {
      throw badRequest(`Google Drive file ${fileIndex + 1} is not a downloadable audio file`);
    }

    const destinationPath = getSafeDriveInputPath(requestDir, metadata.name, fileIndex);
    const mediaResponse = await drive.files.get(
      {
        fileId,
        alt: 'media'
      },
      {
        responseType: 'stream'
      }
    );

    const downloadedBytes = await saveReadableStreamToDisk(
      mediaResponse.data,
      destinationPath,
      config.maxUploadBytes
    );

    return {
      uploadedFile: destinationPath,
      originalFileName: path.basename(metadata.name),
      uploadedBytes: downloadedBytes
    };
  } catch (error) {
    throw mapDriveError(error, fileIndex);
  }
}

module.exports = {
  downloadDriveFile
};
