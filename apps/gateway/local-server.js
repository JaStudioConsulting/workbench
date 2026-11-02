import { fileURLToPath } from "node:url";
import { createLocalRuntimeApp } from "./src/local-runtime.js";

const distDir = fileURLToPath(new URL("../console/dist", import.meta.url));
const port = Number(process.env.PORT || 8092);
const host = process.env.HOST || "127.0.0.1";
const app = await createLocalRuntimeApp({ distDir });

app.listen(port, host, () => {
  console.log(`Recruiting Workbench listening on http://${host}:${port}`);
});
