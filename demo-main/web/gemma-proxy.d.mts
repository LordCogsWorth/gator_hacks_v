// Types for gemma-proxy.mjs (plain JS so it runs in Vite's Node process without extra typings).
type Next = () => void;
type Middleware = (req: unknown, res: unknown, next: Next) => void;

export function gemmaMiddleware(env: Record<string, string | undefined>): Middleware;
