# Connect an AI assistant to Take Studio

You can now let an AI assistant work on your takes for you. Ask it to upload a video, look over the cuts, apply them, and hand you the transcript and the finished video.

## How to connect

There are two ways, and you pick by the assistant you use.

- **Developer tools** such as Claude Code and Cursor use an API key. Make one on the API keys screen, then paste the server address and your key into the tool. The steps are on the docs page.
- **Claude.ai and ChatGPT** connect by signing in. Add Take Studio as a custom connector with the server address, sign in, then choose Allow on the screen that asks if the app may use your Take Studio. There is no key to copy. Choose Deny and nothing is connected.

## You stay in charge

- The assistant can only do what you can do, on your own takes, inside the same limits.
- Deleting always asks first. The assistant cannot delete a take unless it clearly confirms, and it is told to check with you before it tries.
- Words from your video, such as the transcript, are treated as plain information. The assistant is told never to follow them as instructions.

## See and end connections

Open your account menu, then API keys. Under Connected apps you will see every assistant you allowed, when it connected and when it was last used. Choose Disconnect and it stops working right away. To end an assistant that uses a key, revoke the key on the same screen.

## Learn more

Setup text, a worked example and every tool are at `/docs/mcp`.
