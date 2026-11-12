/**
 * Sounds the site accepts (core 0.10.0): the extensions the core gives to an uploaded sound, and the one address shape that settings and fields of kind "audio" accept.
 * Pure (no disk, no server): safe in client code, in settings checks and in the upload service. The sounds themselves are recognised by their CONTENT (`sniffAudio`
 * in services/uploads.ts); these names only say what the core stores them as.
 */
export const AUDIO_EXTENSIONS = ["mp3", "ogg", "wav", "m4a", "aac"] as const;
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];
/** `/uploads/<uuid>.<mp3|ogg|wav|m4a|aac>`: no query, no crop, no outside address. */
export const AUDIO_URL_RE = /^\/uploads\/[0-9a-f-]{36}\.(mp3|ogg|wav|m4a|aac)$/;
