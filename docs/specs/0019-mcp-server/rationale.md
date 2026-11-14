# 0019 rationale. MCP server for AI agents

Decision record for [spec 0019](index.md).

## Context

Spec 0018 (PR #242, Proposed) opens the existing routes to a bearer API key through one function, `resolveCreator(request)`, and a public registry of routes (method, path, shapes, errors) that is importable as data (its AC-16 exists for this spec). Feature 14 asks that an assistant can upload a take, run it, review the cuts and fetch the results for a signed in creator, and reach only that creator's takes.

Three things are new here. First, the transport: MCP is JSON-RPC over HTTP, and our Worker (Next.js on Cloudflare via OpenNext) has no long lived memory, so the server must be stateless. Second, identity: the MCP authorization standard is OAuth 2.1 (protected resource metadata, PKCE, dynamic client registration), and the hosted connectors in Claude.ai and ChatGPT use it, while developer tools (Claude Code, Cursor, scripts) accept a fixed header. Better Auth 1.7.19 core has no OAuth provider or MCP plugin, so OAuth is new build work. Third, an assistant is a third party reading creator data: transcripts and cut reasons come from the creator's own video and enter the assistant's context, so they must be treated as untrusted text and destructive actions need a guard.

Forces: same limits and ownership as the web (so no second rulebook), no secrets or personal text in logs, a video of up to 2 GB cannot travel inside a JSON message, a stateless Worker, and a legal copy that must say what an assistant can read (spec 0015).

## Options considered

### Option 1: Thin tools over the API, key first then OAuth (chosen)

Stateless `/mcp` on our Worker. Tools call the registry routes in process with the caller's own credential. Step one accepts API keys; step two adds OAuth for hosted connectors.

**Pros**:
- Same limits, ownership and errors by construction; nothing to keep in step.
- Step one is small and already useful for developer tools; OAuth is added without changing the tools.
- No new infrastructure: same Worker, same database.

**Cons**:
- OAuth is real security work (clients, codes, consent, rotating tokens) and a new stored area.
- Route handlers become callable from a second entry point, so their exported signatures need to stay stable (the parity test guards this).

### Option 2: API key only

Skip OAuth; every client pastes a key.

**Pros**:
- Least to build and the least new security surface.

**Cons**:
- Claude.ai and ChatGPT hosted connectors expect OAuth, so the audience of non developer creators cannot connect; pasting a long lived key into a chat product is also worse for them.

### Option 3: A separate MCP service (own Worker or Durable Object sessions)

Run the MCP server as its own deployment that calls our public API over HTTPS.

**Pros**:
- Clean separation; sessions and streaming are possible.

**Cons**:
- A second deploy, second set of secrets, a network hop per tool call and a second place for limits to go wrong; stateless JSON replies already cover every tool here (no tool streams).

### Option 4: Hand written tool wrappers with their own logic

Write each tool to call server functions directly instead of through the routes.

**Pros**:
- No synthetic requests.

**Cons**:
- Re-implements the guard, Origin and error mapping; exactly the drift spec 0018 was designed to avoid.

## Rationale

The routes already hold every rule the feature promises, so calling them in process with the caller's own credential is the only way for the assistant to be bound by exactly the same limits and ownership (Option 4 repeats the rules; Option 3 adds a hop and a deployment for streaming that no tool needs). Keys first because they cost almost nothing on top of spec 0018 and serve developer tools immediately; OAuth second because the hosted Claude.ai and ChatGPT connectors cannot use a pasted key, and the creators who would benefit most (not developers) are the ones who need the sign in flow. Stateless JSON replies fit a Worker with no shared memory and every tool is a short request and reply. Uploading is the one place the protocol does not fit (a 2 GB file in JSON), so the tool hands out the same presigned links the web app uses, and the server never fetches a URL on an assistant's behalf (an open fetch would be a cost and SSRF risk we do not need yet).

## References

**Project sources**:
- Spec 0018 (public API: `resolveCreator`, the registry, keys, the rate limit, session only routes), spec 0014 (allowance), spec 0015 (privacy and terms, legal checklist), spec 0004 and `src/server/AGENTS.md` (route pattern)
- Commitments C-28 (scope order), C-30 (recommended option stands unless Toyin says otherwise), C-29 (agents cannot reach external clients such as Claude.ai, so that live check is Toyin's)

**Practices and standards**:
- Model Context Protocol, Streamable HTTP transport and authorization (OAuth 2.1 with protected resource metadata, PKCE, dynamic client registration), as of my knowledge; check the current revision at build time
- OAuth 2.1 and RFC 7591, RFC 8707 (resource indicators), RFC 9728 (protected resource metadata)
- Store only hashes of bearer secrets, rotate refresh tokens and revoke the grant on reuse
- Treat model visible tool output from user content as untrusted data; confirm destructive actions
