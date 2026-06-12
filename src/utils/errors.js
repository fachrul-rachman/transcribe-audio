class AppError extends Error {
  constructor(statusCode, error, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.error = error;
    this.code = options.code;
    this.cause = options.cause;
  }
}

function badRequest(message) {
  return new AppError(400, 'Bad Request', message);
}

function unauthorized() {
  return new AppError(401, 'Unauthorized', 'Missing or invalid API key');
}

function payloadTooLarge(message) {
  return new AppError(413, 'Payload Too Large', message);
}

function audioProcessingError(message, cause) {
  return new AppError(422, 'Audio Processing Error', message, { cause });
}

function openAiError(message, statusCode = 502, cause) {
  return new AppError(statusCode, 'OpenAI Error', message, { cause });
}

function toErrorResponse(error) {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        success: false,
        error: error.error,
        message: error.message
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      success: false,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred'
    }
  };
}

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  payloadTooLarge,
  audioProcessingError,
  openAiError,
  toErrorResponse
};
