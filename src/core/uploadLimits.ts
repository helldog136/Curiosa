/**
 * Size caps of an upload, per kind of content (pure: safe in client code). The kind comes from the BYTES of the file (see `saveUpload` in services/uploads.ts), never from its name.
 * Images 5 MB, sounds 10 MB, videos 50 MB (the web server in front of the site must accept 60 MB: `client_max_body_size 60m` under nginx).
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
