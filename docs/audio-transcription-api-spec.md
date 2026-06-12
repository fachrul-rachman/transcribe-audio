# n8n Audio Transcription Helper API

## 1. Project Overview

Build a small production-ready API service for a self-hosted n8n workflow.

The API receives an audio file from n8n, stores it temporarily, processes large audio safely, transcribes it using the OpenAI API, merges all chunk transcripts in order, returns a JSON response, and deletes all temporary files after processing.

This service must stay simple, robust, and easy to maintain.

No database is required.

No Google Drive integration is required.

n8n is responsible for sending the audio file to this API.

---

## 2. Main Goal

Create a standalone Node.js API that solves this problem:

> n8n may receive audio files larger than the OpenAI transcription upload limit, so this API must prepare, split, transcribe, and merge the audio transcript automatically.

Expected flow:

```txt
n8n
  -> sends multipart/form-data audio file
  -> Fastify API receives file
  -> saves file to temp folder
  -> checks file size
  -> compresses/converts audio with ffmpeg
  -> splits large audio into safe chunks
  -> transcribes each chunk with OpenAI
  -> merges transcript text in chunk order
  -> returns JSON response to n8n
  -> cleans all temporary files
```

---

## 3. Tech Stack

Use:

* Node.js
* Fastify
* @fastify/multipart
* OpenAI SDK
* ffmpeg
* dotenv
* PM2 for production deployment

Do not use:

* Database
* Google Drive API
* Queue system
* Redis
* BullMQ
* Worker architecture
* Complex background job system
* Frontend

Keep it simple.

---

## 4. Runtime Target

Development:

* Windows
* Node.js
* ffmpeg installed and available in PATH

Production:

* Ubuntu VPS
* Node.js
* ffmpeg installed
* PM2
* API called by self-hosted n8n

---

## 5. Endpoint

### `POST /transcribe-audio`

Receives an audio file and returns the transcript.

---

## 6. Request Format

Content type:

```txt
multipart/form-data
```

Required field:

```txt
file
```

Optional field:

```txt
language
```

Default language:

```txt
id
```

Expected common file types:

* mp3
* m4a

The API should not be hardcoded only for these extensions if ffmpeg can process the file, but mp3 and m4a are the main expected formats.

---

## 7. Authentication

The endpoint must require a simple internal API key.

Use request header:

```txt
x-api-key: <API_KEY>
```

The value must be compared with `API_KEY` from `.env`.

If the header is missing or invalid, return HTTP `401`.

Example error:

```json
{
  "success": false,
  "error": "Unauthorized",
  "message": "Missing or invalid API key"
}
```

---

## 8. Response Format

### Full Success

Return:

```json
{
  "success": true,
  "partial": false,
  "file_name": "audio.mp3",
  "chunk_count": 3,
  "transcript": "Full transcript text..."
}
```

### Partial Success

If one or more chunks fail but at least one chunk succeeds, return HTTP `200` with:

```json
{
  "success": true,
  "partial": true,
  "file_name": "audio.mp3",
  "chunk_count": 5,
  "failed_chunks": [
    {
      "chunk_index": 3,
      "error": "OpenAI transcription failed"
    }
  ],
  "transcript": "Partial transcript text from successful chunks..."
}
```

Important:

* Partial success must not throw a full request error.
* n8n should still receive the transcript text that was successfully generated.
* Failed chunk information must be included clearly.

### Full Failure

If the request cannot be processed at all, return an error JSON.

Example:

```json
{
  "success": false,
  "error": "Bad Request",
  "message": "No file uploaded"
}
```

---

## 9. Audio Processing Rules

### Upload Handling

The API must:

1. Accept multipart upload.
2. Save the uploaded file to a unique temporary request folder.
3. Avoid filename collision by using a generated request ID.
4. Preserve the original filename for response metadata.
5. Clean up all temporary files after processing, whether success or error.

Example temp structure:

```txt
temp/
  request-uuid/
    input-original.m4a
    normalized.mp3
    chunks/
      chunk-000.mp3
      chunk-001.mp3
      chunk-002.mp3
```

---

## 10. File Size Handling

The OpenAI transcription API has an upload limit, so the service must keep each uploaded transcription chunk safely below the limit.

Use a safety margin.

Recommended config:

```txt
MAX_CHUNK_MB=24
```

Do not target exactly 25MB.

That is how bugs are born and then promoted to production.

---

## 11. ffmpeg Processing Strategy

Use ffmpeg to normalize the input audio before transcription.

Recommended output format:

```txt
mp3
```

Recommended audio settings:

```txt
mono
64k bitrate
16000 Hz sample rate
```

Recommended ffmpeg options:

```txt
-ac 1
-b:a 64k
-ar 16000
```

Reason:

* Smaller file size
* Better chance of staying below upload limit
* Good enough for speech transcription
* Keeps processing simple

---

## 12. Chunking Strategy

Use duration-based chunking first.

Recommended default:

```txt
CHUNK_SECONDS=600
```

That means 10 minutes per chunk.

After creating chunks, validate each chunk size.

If a chunk is still larger than `MAX_CHUNK_MB`, the API should retry with smaller chunk duration.

Suggested retry durations:

```txt
600 seconds
300 seconds
180 seconds
120 seconds
60 seconds
```

If a chunk is still too large after the smallest duration, return a clear processing error.

Do not implement complex dynamic bitrate estimation unless necessary.

Keep the first version simple and reliable.

---

## 13. Transcription Rules

Use OpenAI SDK.

Default model:

```txt
gpt-4o-transcribe
```

Default language:

```txt
id
```

Language can be overridden using multipart field:

```txt
language
```

Each chunk must be transcribed in order.

The final transcript must merge chunk transcripts in the correct order.

Use a simple separator between chunks, for example:

```txt
\n\n
```

Do not include timestamps in the first version.

Do not include verbose metadata in the final response unless needed for errors.

---

## 14. Error Handling Requirements

Handle these cases clearly:

### Request Errors

* Missing API key
* Invalid API key
* Missing file field
* Empty uploaded file
* Invalid multipart request
* Upload exceeds configured max upload size

### Audio Processing Errors

* ffmpeg not installed
* ffmpeg conversion failed
* ffmpeg split failed
* Unsupported/corrupt audio file
* Generated chunk missing
* Generated chunk still exceeds max chunk size

### OpenAI Errors

* Missing `OPENAI_API_KEY`
* OpenAI API failure
* OpenAI rate limit
* OpenAI timeout
* Failed transcription for one chunk

### Cleanup Errors

Cleanup errors must not hide the main result.

If cleanup fails, log it, but still return the main response if transcription succeeded.

---

## 15. Temporary File Cleanup

The API must delete the request temp folder in a `finally` block.

Cleanup must run for:

* full success
* partial success
* request error
* ffmpeg error
* OpenAI error

Use safe deletion.

Never delete outside the configured temp directory.

---

## 16. Environment Variables

Create `.env.example` with:

```env
PORT=3000
HOST=0.0.0.0

OPENAI_API_KEY=your-openai-api-key
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe

API_KEY=change-this-internal-secret

DEFAULT_LANGUAGE=id

TEMP_DIR=./temp

MAX_UPLOAD_MB=500
MAX_CHUNK_MB=24

CHUNK_SECONDS=600
FFMPEG_AUDIO_BITRATE=64k
FFMPEG_AUDIO_CHANNELS=1
FFMPEG_AUDIO_SAMPLE_RATE=16000

REQUEST_TIMEOUT_MS=1800000
```

Notes:

* `REQUEST_TIMEOUT_MS=1800000` means 30 minutes.
* This API is expected to run synchronously for now.
* n8n HTTP Request timeout and reverse proxy timeout must also be adjusted if needed.

---

## 17. Suggested Project Structure

Use this structure:

```txt
audio-transcriber-api/
  src/
    server.js
    config.js
    routes/
      transcribeAudio.js
    services/
      audioProcessor.js
      openaiTranscriber.js
    utils/
      fileUtils.js
      errors.js
      logger.js
  temp/
    .gitkeep
  .env.example
  .gitignore
  package.json
  README.md
```

Keep files small and readable.

Do not create unnecessary abstractions.

---

## 18. Implementation Details

### `src/config.js`

Responsible for:

* loading environment variables
* validating required env values
* converting numeric env values
* exporting config object

Must validate:

* `OPENAI_API_KEY`
* `API_KEY`
* `PORT`
* `MAX_UPLOAD_MB`
* `MAX_CHUNK_MB`
* `CHUNK_SECONDS`

---

### `src/server.js`

Responsible for:

* creating Fastify instance
* registering multipart
* setting upload limits
* registering routes
* starting the server
* handling graceful shutdown

Fastify body/upload size should use `MAX_UPLOAD_MB`.

---

### `src/routes/transcribeAudio.js`

Responsible for:

* checking `x-api-key`
* reading multipart file and optional language field
* saving uploaded file to temp
* calling audio processor
* calling transcription service
* returning success, partial success, or error response
* ensuring cleanup runs

---

### `src/services/audioProcessor.js`

Responsible for:

* converting uploaded audio to normalized mp3
* splitting normalized audio into chunks
* validating chunk size
* retrying with smaller chunk duration if needed
* returning ordered chunk file paths

Should use Node child process to run ffmpeg.

Do not use shell string concatenation with unsafe user input.

Use `spawn` or `execFile`.

---

### `src/services/openaiTranscriber.js`

Responsible for:

* creating OpenAI client
* transcribing one chunk
* transcribing all chunks in order
* collecting failed chunks
* returning transcript and error details

Important:

* If a chunk fails, continue processing the next chunk.
* Return partial transcript if at least one chunk succeeds.
* If all chunks fail, return full failure.

---

### `src/utils/fileUtils.js`

Responsible for:

* creating request temp folder
* saving upload stream to disk
* getting file size in MB
* deleting temp folder safely
* listing/sorting chunk files

---

### `src/utils/errors.js`

Responsible for:

* consistent error response format
* helper for known errors
* mapping errors to HTTP status codes

Keep it simple.

---

### `src/utils/logger.js`

Use console-based logging.

No external logging system required.

Log:

* request start
* original filename
* file size
* chunk count
* failed chunks
* processing duration
* cleanup errors

Do not log:

* OpenAI API key
* internal API key
* full transcript
* sensitive file content

---

## 19. README Requirements

Create a complete `README.md` with:

### Sections

* Project description
* Requirements
* Installation
* Environment setup
* ffmpeg installation on Windows
* ffmpeg installation on Ubuntu
* Run locally
* Test with curl
* n8n HTTP Request setup
* Run with PM2
* Production notes
* Troubleshooting

### Include Windows ffmpeg note

Explain that ffmpeg must be installed and available in PATH.

### Include Ubuntu ffmpeg install

```bash
sudo apt update
sudo apt install -y ffmpeg
```

### Include local run

```bash
npm install
cp .env.example .env
npm run dev
```

### Include production run with PM2

```bash
npm install --omit=dev
pm2 start src/server.js --name audio-transcriber-api
pm2 save
pm2 startup
```

### Include curl example

```bash
curl -X POST http://localhost:3000/transcribe-audio \
  -H "x-api-key: change-this-internal-secret" \
  -F "language=id" \
  -F "file=@sample.mp3"
```

### Include n8n setup

n8n HTTP Request node:

```txt
Method: POST
URL: http://your-vps-ip:3000/transcribe-audio
Authentication: None
Headers:
  x-api-key: your-api-key
Body Content Type: Form-Data
Form field:
  file = binary file
  language = id
Response Format: JSON
Timeout: increase if audio files are large
```

---

## 20. package.json Requirements

Include scripts:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  }
}
```

Dependencies:

```txt
@fastify/multipart
dotenv
fastify
openai
```

Dev dependencies are optional.

Do not add TypeScript unless explicitly requested.

Use plain JavaScript for faster implementation and easier deployment.

---

## 21. API Behavior Examples

### Success

```json
{
  "success": true,
  "partial": false,
  "file_name": "voice-message.mp3",
  "chunk_count": 2,
  "transcript": "This is the full transcript..."
}
```

### Partial Success

```json
{
  "success": true,
  "partial": true,
  "file_name": "voice-message.mp3",
  "chunk_count": 4,
  "failed_chunks": [
    {
      "chunk_index": 2,
      "error": "OpenAI transcription failed"
    }
  ],
  "transcript": "Transcript from successful chunks..."
}
```

### Unauthorized

```json
{
  "success": false,
  "error": "Unauthorized",
  "message": "Missing or invalid API key"
}
```

### Missing File

```json
{
  "success": false,
  "error": "Bad Request",
  "message": "No file uploaded. Expected multipart field: file"
}
```

### Audio Processing Error

```json
{
  "success": false,
  "error": "Audio Processing Error",
  "message": "Failed to process audio with ffmpeg"
}
```

---

## 22. Security Requirements

Minimum security:

* Require `x-api-key`.
* Do not expose service publicly without a reverse proxy and firewall rules.
* Do not log secrets.
* Do not log full transcript.
* Limit upload size.
* Store files only in temp request folders.
* Delete temp files after each request.
* Avoid shell injection by using safe child process execution.
* Do not accept arbitrary output paths from user input.

---

## 23. KISS Rules

Follow these rules strictly:

* No database.
* No queue.
* No Redis.
* No frontend.
* No Google Drive.
* No unnecessary frameworks.
* No complex architecture.
* No premature optimization.
* No over-abstracted class structure.
* Use clear functions.
* Use readable file names.
* Handle errors properly.
* Prefer boring code that works.

---

## 24. Acceptance Criteria

The implementation is complete when:

1. `POST /transcribe-audio` accepts multipart audio upload.
2. Missing or invalid `x-api-key` returns `401`.
3. Missing file returns clear JSON error.
4. Uploaded file is saved to a unique temp folder.
5. Audio is normalized with ffmpeg.
6. Large audio is split into chunks below configured max chunk size.
7. Each chunk is transcribed using `gpt-4o-transcribe`.
8. Transcripts are merged in correct chunk order.
9. Full success returns `success: true` and `partial: false`.
10. Chunk failure returns `success: true` and `partial: true` if at least one chunk succeeds.
11. Full failure returns `success: false`.
12. Temporary files are deleted after processing.
13. README explains Windows local setup.
14. README explains Ubuntu VPS setup.
15. README explains PM2 deployment.
16. README explains n8n HTTP Request configuration.
17. No database or Google Drive integration exists.
18. Code is simple, readable, and production-ready.

---

## 25. Suggested Manual Test Plan

Prepare test files:

```txt
small.mp3       under 25MB
large.mp3       around 50-80MB
invalid.txt     non-audio file
```

Test cases:

### Health Check

Optional but recommended:

```txt
GET /health
```

Response:

```json
{
  "success": true,
  "status": "ok"
}
```

### Small Audio

Upload small mp3.

Expected:

* no unnecessary failure
* returns transcript
* `partial: false`

### Large Audio

Upload 50-80MB audio.

Expected:

* ffmpeg processes file
* chunks are created
* each chunk is below max chunk size
* returns merged transcript
* `chunk_count` is greater than 1

### Missing API Key

Expected:

* HTTP 401
* clear JSON error

### Wrong API Key

Expected:

* HTTP 401
* clear JSON error

### Missing File

Expected:

* HTTP 400
* clear JSON error

### Invalid Audio

Expected:

* HTTP 400 or 422
* clear JSON error from ffmpeg processing

### Cleanup Check

After every test, temp request folder should be deleted.

---

## 26. Codex Implementation Prompt

Use this prompt when asking Codex to build the project:

```txt
Build this project based on docs/audio-transcription-api-spec.md.

Implement a small production-ready Node.js Fastify API for n8n audio transcription.

Use JavaScript, not TypeScript.

Follow the project structure in the spec.

Use:
- Fastify
- @fastify/multipart
- OpenAI SDK
- dotenv
- ffmpeg through child_process spawn or execFile
- PM2 deployment instructions in README

Do not use:
- database
- queue
- Redis
- Google Drive integration
- frontend
- unnecessary architecture

Implement:
- POST /transcribe-audio
- x-api-key authentication
- multipart upload field file
- optional language field default id
- temp folder per request
- ffmpeg normalization to mp3 mono low bitrate
- duration-based chunking
- chunk size validation below MAX_CHUNK_MB
- retry smaller chunk duration if chunks are too large
- OpenAI transcription using gpt-4o-transcribe
- continue transcription when a chunk fails
- return partial success if some chunks fail
- cleanup temp files in finally
- clear JSON errors
- README with Windows, Ubuntu, n8n, curl, and PM2 instructions

Keep the code simple, readable, robust, and production-ready.
```

---

## 27. Notes for Codex

Be careful with multipart handling.

The API must correctly read both:

* uploaded binary file
* optional text field `language`

The implementation should not assume the file extension is trustworthy.

ffmpeg should be the real validator/converter.

The service should be synchronous for the first version.

This is acceptable because n8n will call the API and wait for the JSON response.

Timeouts can be adjusted in:

* n8n HTTP Request node
* Node.js server config
* reverse proxy config
* PM2 process settings

Do not implement background jobs unless explicitly requested later.
