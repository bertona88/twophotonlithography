import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) {
  throw new Error("The production worker shim must run in a worker thread");
}

const pendingMessages = [];
const nativeFetch = globalThis.fetch;

globalThis.self = globalThis;
globalThis.postMessage = (message, transfer = []) => {
  parentPort.postMessage(message, transfer);
};
globalThis.fetch = async (input, init) => {
  const requestUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;

  if (requestUrl.startsWith("/assets/")) {
    const assetPath = path.join(workerData.clientRoot, requestUrl.slice(1));
    const bytes = await readFile(assetPath);
    return new Response(bytes, {
      headers: { "Content-Type": "application/wasm" },
    });
  }

  return nativeFetch(input, init);
};

parentPort.on("message", (data) => {
  if (typeof globalThis.onmessage === "function") {
    globalThis.onmessage({ data });
  } else {
    pendingMessages.push(data);
  }
});

await import(pathToFileURL(workerData.workerPath).href);

for (const data of pendingMessages.splice(0)) {
  globalThis.onmessage({ data });
}
