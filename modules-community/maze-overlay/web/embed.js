// Porté depuis le labyrinthe de helldog136.be (TypeScript → JavaScript), sans autre changement de logique.
// Résout une URL YouTube/Twitch clip vers son URL d'embed lecture directe —
// utilisé par le focus promo (la vidéo doit jouer, pas juste être liée).
// Fonctions pures, sans DOM — utilisables aussi bien côté serveur (route
// API, pour la miniature) que client (composant de focus).
export function getYouTubeVideoId(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes("youtu.be"))
            return u.pathname.slice(1) || null;
        if (u.pathname.startsWith("/shorts/"))
            return u.pathname.split("/")[2] ?? null;
        if (u.hostname.includes("youtube.com"))
            return u.searchParams.get("v");
        return null;
    }
    catch {
        return null;
    }
}
export function getYouTubeThumbnailUrl(url) {
    const id = getYouTubeVideoId(url);
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
export function getYouTubeEmbedUrl(url) {
    const id = getYouTubeVideoId(url);
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1` : null;
}
export function getTwitchClipEmbedUrl(url, parentHost) {
    if (!parentHost)
        return null;
    try {
        const u = new URL(url);
        let slug = null;
        if (u.hostname.includes("clips.twitch.tv")) {
            slug = u.pathname.slice(1).split("/")[0] ?? null;
        }
        else {
            const match = u.pathname.match(/\/clip\/([^/]+)/);
            slug = match?.[1] ?? null;
        }
        if (!slug)
            return null;
        return `https://clips.twitch.tv/embed?clip=${slug}&parent=${parentHost}&autoplay=true&muted=true`;
    }
    catch {
        return null;
    }
}
