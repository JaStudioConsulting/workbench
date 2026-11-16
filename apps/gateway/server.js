import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3001);
const app = await createApp();
app.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`Gateway listening on ${port}`));
