# MCP real-browser analysis is a separate mode, not integrated into the web UI

For Publications protected by Cloudflare Bot Management, the headless Playwright pipeline cannot produce reliable DOM-based scores. The Claude-in-Chrome MCP tools can navigate these Publications in a real browser, bypassing bot protection. However, MCP tools only run inside an interactive Claude session — they cannot be called from the Node.js analyzer server.

We decided not to build an IPC bridge between the web UI and Claude's session (Model B). Instead, bot-protected Publications are analysed directly by Claude using MCP tools, producing a structured report without the web UI. The web UI handles Publications Playwright can reach; Claude handles the rest. The two modes are complementary, not unified.

The rejected alternative (Model B) would require a persistent IPC channel, shared state between the web server and Claude's session, and a "handoff" protocol — significant complexity for a tool used ad-hoc by a single Analyst.
