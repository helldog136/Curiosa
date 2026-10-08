// Double de next/navigation : redirect/notFound lèvent, comme dans Next, pour que les tests puissent les attraper.
export class RedirectError extends Error { constructor(url) { super(`NEXT_REDIRECT ${url}`); this.url = url; } }
export class NotFoundError extends Error { constructor() { super("NEXT_NOT_FOUND"); } }
export const redirect = (url) => { throw new RedirectError(url); };
export const permanentRedirect = (url) => { throw new RedirectError(url); };
export const notFound = () => { throw new NotFoundError(); };
