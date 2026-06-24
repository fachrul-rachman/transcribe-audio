# n8n Audio Transcription Helper API

Small production-ready Fastify API for self-hosted n8n audio transcription.

The API accepts one to five multipart audio uploads, normalizes each file with ffmpeg, splits large audio into safe chunks, transcribes chunks with OpenAI, merges transcript text in upload order, and deletes temporary files after each request.

## Requirements

- Node.js 20 or newer recommended
- ffmpeg installed and available in `PATH`
- OpenAI API key
- PM2 for production on Ubuntu

No database, queue, Redis, Docker, frontend, or Google Drive integration is required.

## Installation

```bash
npm install
cp .env.example .env
```

Edit `.env` and set:

```env
OPENAI_API_KEY=your-openai-api-key
API_KEY=your-internal-api-key
```

## Environment

Important defaults:

```env
PORT=3000
HOST=0.0.0.0
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe
DEFAULT_LANGUAGE=id
GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
TEMP_DIR=./temp
MAX_UPLOAD_MB=500
MAX_CHUNK_MB=24
CHUNK_SECONDS=600
REQUEST_TIMEOUT_MS=1800000
OPENAI_CHUNK_RETRIES=3
OPENAI_RETRY_BASE_MS=1000
```

`REQUEST_TIMEOUT_MS=1800000` is 30 minutes. Increase n8n HTTP Request timeout and reverse proxy timeout if large files need more time.
`OPENAI_CHUNK_RETRIES` retries transient OpenAI/network failures per chunk, such as premature connection close, timeout, rate limit, or upstream 5xx errors.
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` should stay in `.env` and can use escaped `\n` newlines.

## ffmpeg on Windows

Install ffmpeg and make sure `ffmpeg.exe` is available in `PATH`.

Verify:

```bash
ffmpeg -version
```

If the command is not found, add the ffmpeg `bin` directory to the Windows `PATH`, then reopen the terminal.

## ffmpeg on Ubuntu

```bash
sudo apt update
sudo apt install -y ffmpeg
ffmpeg -version
```

## Run Locally

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Expected:

```json
{
  "success": true,
  "status": "ok"
}
```

## Test with curl

### Google Drive file IDs

Share each Drive audio file, or the containing folder, with the service account email from `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`.

```bash
curl -X POST http://localhost:3000/transcribe-drive-files \
  -H "x-api-key: change-this-internal-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "language": "id",
    "file_ids": [
      "google-drive-file-id-1",
      "google-drive-file-id-2"
    ]
  }'
```

The API accepts 1 to 5 Google Drive file IDs and returns the same response shape as multipart uploads.

### One file

```bash
curl -X POST http://localhost:3000/transcribe-audio \
  -H "x-api-key: change-this-internal-secret" \
  -F "language=id" \
  -F "file=@sample.mp3"
```

### Multiple files

Use the same `file` field multiple times. The API accepts up to 5 files per request and processes them in upload order.

```bash
curl -X POST http://localhost:3000/transcribe-audio \
  -H "x-api-key: change-this-internal-secret" \
  -F "language=id" \
  -F "file=@part-01.mp3" \
  -F "file=@part-02.mp3" \
  -F "file=@part-03.mp3" \
  -F "file=@part-04.mp3" \
  -F "file=@part-05.mp3"
```

PowerShell example:

```powershell
curl.exe -X POST "http://localhost:3000/transcribe-audio" `
  -H "x-api-key: change-this-internal-secret" `
  -F "language=id" `
  -F "file=@C:\path\to\part-01.mp3" `
  -F "file=@C:\path\to\part-02.mp3" `
  -F "file=@C:\path\to\part-03.mp3" `
  -F "file=@C:\path\to\part-04.mp3" `
  -F "file=@C:\path\to\part-05.mp3"
```

Success response:

```json
{
  "success": true,
  "file_count": 3,
  "total_chunk_count": 8,
  "merged_transcript": "Transcript file 1...\n\nTranscript file 2...\n\nTranscript file 3...",
  "files": [
    {
      "file_index": 1,
      "file_name": "part-01.mp3",
      "success": true,
      "chunk_count": 3,
      "transcript": "Transcript file 1..."
    },
    {
      "file_index": 2,
      "file_name": "part-02.mp3",
      "success": true,
      "chunk_count": 3,
      "transcript": "Transcript file 2..."
    },
    {
      "file_index": 3,
      "file_name": "part-03.mp3",
      "success": true,
      "chunk_count": 2,
      "transcript": "Transcript file 3..."
    }
  ]
}
```

If any file fails, the request returns an error and does not return a partial transcript.

## n8n HTTP Request Setup

HTTP Request node:

```txt
Method: POST
URL: http://your-vps-ip:3000/transcribe-audio
Authentication: None
Headers:
  x-api-key: your-api-key
Body Content Type: Form-Data
Form field:
  file = binary file, repeat up to 5 times for multiple files
  language = id
Response Format: JSON
Timeout: increase if audio files are large
```

The `file` form field must contain the binary audio file. For multiple files, repeat the `file` field. Files are transcribed and merged in upload order.

## Google Sheets / Apps Script Setup

Use `POST /transcribe-drive-files` when Google Sheets has Drive file IDs instead of local files.

Apps Script example:

```javascript
function transcribeDriveFiles() {
  const url = 'http://your-vps-ip:3000/transcribe-drive-files';
  const payload = {
    language: 'id',
    file_ids: [
      'google-drive-file-id-1',
      'google-drive-file-id-2'
    ]
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': 'your-api-key'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log(response.getContentText());
}
```

Google Drive setup:

- Enable Google Drive API for the Google Cloud project.
- Create a service account.
- Put service account credentials in `.env` as `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
- Share each audio file or containing folder with the service account email.
- Use downloadable audio files, not Google Docs/Sheets native files.

## Run with PM2

```bash
npm install --omit=dev
pm2 start src/server.js --name audio-transcriber-api
pm2 save
pm2 startup
```

View logs:

```bash
pm2 logs audio-transcriber-api
```

Restart after changes:

```bash
pm2 restart audio-transcriber-api
```

## Production Notes

- Keep the API behind a reverse proxy and firewall rules.
- Require `x-api-key` for every transcription request.
- Use HTTPS at the reverse proxy layer.
- Do not expose `.env`.
- Do not log OpenAI keys, internal API keys, file contents, or full transcripts.
- Keep `MAX_CHUNK_MB` below the OpenAI upload limit. The default is `24`.
- If production sees repeated OpenAI connection closes, reduce `CHUNK_SECONDS` to `180` so each OpenAI request is shorter.
- Keep `OPENAI_CHUNK_RETRIES` enabled for transient network failures. The default is `3`.
- Audio chunks are re-encoded during splitting so each segment is a clean MP3 for OpenAI transcription.
- Keep Google service account secrets in `.env`; do not commit them.
- Make sure reverse proxy, n8n, and Node timeouts are high enough for large audio.
- Temporary request folders are deleted after success and errors.

## Manual Test Plan

Prepare:

```txt
small.mp3       under 25MB
large.mp3       around 50-80MB
invalid.txt     non-audio file
```

Test:

- `GET /health` returns `{ "success": true, "status": "ok" }`.
- Small single-file audio returns `success: true`, `file_count: 1`, and `total_chunk_count: 1`.
- Multiple audio files return `merged_transcript` and a `files` array in upload order.
- More than 5 uploaded files returns HTTP `400`.
- `POST /transcribe-drive-files` accepts 1 to 5 Drive file IDs and returns the same response shape.
- Large audio is normalized, split into chunks below `MAX_CHUNK_MB`, and returns merged transcript.
- Missing `x-api-key` returns HTTP `401`.
- Wrong `x-api-key` returns HTTP `401`.
- Missing `file` returns HTTP `400`.
- Invalid audio returns HTTP `422`.
- After each request, the temp request folder is deleted.

## Troubleshooting

### `ffmpeg is not installed or is not available in PATH`

Install ffmpeg and verify:

```bash
ffmpeg -version
```

### `Uploaded file exceeds configured max upload size`

Increase `MAX_UPLOAD_MB` in `.env` if the file size is expected.

### OpenAI rate limit

Wait and retry, or reduce concurrent n8n calls to this API.

### OpenAI connection closed early

If logs show `ERR_STREAM_PREMATURE_CLOSE` or `Premature close`, the connection to OpenAI was interrupted while reading the response. The API retries transient failures per chunk by default.

Recommended production settings:

```env
OPENAI_CHUNK_RETRIES=5
OPENAI_RETRY_BASE_MS=2000
CHUNK_SECONDS=180
```

After changing `.env`, restart PM2:

```bash
pm2 restart audio-transcriber-api
```

### Request timeout

Increase:

- `REQUEST_TIMEOUT_MS`
- n8n HTTP Request timeout
- reverse proxy timeout
- PM2 or VPS process timeout settings if applicable

### Invalid or corrupt audio

The API relies on ffmpeg to validate and convert audio. If ffmpeg cannot process the file, the API returns HTTP `422`.
