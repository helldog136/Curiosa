// Test module: the same three steps as the media upload of the alerts overlay (curiosa-extras), built on ctx.api.files.upload. A refusal of the core reaches
// the assistant word for word (an error marked `expose`), as the real module does.
const expose = (message) => Object.assign(new Error(message), { expose: true });
const out = (r) => { if (!r.ok) throw expose(r.message || "The upload was refused."); return r; };
export default {
  mcp: {
    clip_upload_begin: async (ctx, a) => out(await ctx.api.files.upload.begin({ bytes: a.bytes, sha256: a.sha256, accept: ["video", "image"], label: "Clip" })),
    clip_upload_chunk: async (ctx, a) => out(await ctx.api.files.upload.chunk({ upload: a.upload, index: a.index, data: a.data })),
    clip_upload_finish: async (ctx, a) => out(await ctx.api.files.upload.finish({ upload: a.upload })),
  },
};
