// Types for OpenNext's generated Worker entry (`opennextjs-cloudflare build` writes it), so
// src/worker.ts can import it before the first build without a ts-ignore.
declare module "*/.open-next/worker.js" {
  const handler: {
    fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>;
  };
  export default handler;
}
