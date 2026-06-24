const Fastify = require('fastify');
const multipart = require('@fastify/multipart');

const config = require('./config');
const registerTranscribeAudioRoute = require('./routes/transcribeAudio');
const registerTranscribeDriveFilesRoute = require('./routes/transcribeDriveFiles');
const logger = require('./utils/logger');

async function buildServer() {
  const fastify = Fastify({
    logger: false,
    bodyLimit: config.maxUploadBytes,
    requestTimeout: config.requestTimeoutMs
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 5
    }
  });

  fastify.get('/health', async () => ({
    success: true,
    status: 'ok'
  }));

  await fastify.register(registerTranscribeAudioRoute);
  await fastify.register(registerTranscribeDriveFilesRoute);

  return fastify;
}

async function start() {
  const fastify = await buildServer();

  const shutdown = async (signal) => {
    logger.info('Shutdown signal received', { signal });

    try {
      await fastify.close();
      process.exit(0);
    } catch (error) {
      logger.error('Shutdown failed', { message: error.message });
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await fastify.listen({
      port: config.port,
      host: config.host
    });

    logger.info('Audio transcriber API listening', {
      host: config.host,
      port: config.port
    });
  } catch (error) {
    logger.error('Failed to start server', { message: error.message });
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  buildServer
};
