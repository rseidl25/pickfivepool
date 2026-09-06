import app from "./app.js";
import { startPoller } from "./espn/poller.js";
import { hydrateStore } from "./store.js";

const PORT = process.env.PORT || 3000;

await hydrateStore();
startPoller();

app.listen(PORT, () => {
  console.log(`Pick 5 Pool server listening on port ${PORT}`);
});
