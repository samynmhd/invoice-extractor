import { initBotId } from "botid/client/core";

// Attach BotID classification to the extraction endpoint so the server can
// reject automated traffic before it spends a Claude call.
initBotId({
  protect: [{ path: "/api/extract", method: "POST" }],
});
