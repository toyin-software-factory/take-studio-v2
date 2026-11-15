import { TEST_ORIGIN } from "./test-wiring";

/**
 * `POST /mcp` (spec 0019 AC-1, AC-2, AC-3, AC-10, AC-11) with the real route handlers
 * over a real test database. Own database so the rate windows stay out of other files.
 */
export const ORIGIN = TEST_ORIGIN;
export const rpc = (method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  ...(params === undefined ? {} : { params }),
});
export const call = (name: string, args: unknown = {}) =>
  rpc("tools/call", { name, arguments: args });
export type Reply = {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};
export const json = async (response: Response): Promise<Reply> => (await response.json()) as Reply;
export const toolText = (reply: Reply): { text: string; isError: boolean } => {
  const content = (reply.result?.content ?? []) as { text: string }[];
  return { text: content[0]?.text ?? "", isError: reply.result?.isError === true };
};
