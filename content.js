"use strict";

const CHANNEL = "khan-classroom-activity-capture-v1";

function sendPageEvent(type) {
  window.postMessage({ channel: CHANNEL, type }, location.origin);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "capture:stop") sendPageEvent("capture:stop");
});

chrome.runtime.sendMessage({ type: "capture:content-ready" }).then((result) => {
  if (result?.capture?.status === "armed") sendPageEvent("capture:arm");
}).catch(() => {});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (message?.channel !== CHANNEL || message.type !== "capture:page-data") return;
  chrome.runtime.sendMessage({ type: "capture:page-data", data: message.data }).catch(() => {});
});
