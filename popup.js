"use strict";

const statusNode = document.querySelector("#status");
const captureButton = document.querySelector("#capture");
const downloadButton = document.querySelector("#download");
const cancelButton = document.querySelector("#cancel");

let activeTabId = null;
let activeTabIsKhan = false;
let refreshTimer = null;

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
  statusNode.setAttribute("aria-live", isError ? "assertive" : "polite");
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !Number.isInteger(tab.id)) throw new Error("Could not identify the current tab.");
  activeTabId = tab.id;
  try {
    const url = new URL(tab.url);
    activeTabIsKhan = url.protocol === "https:"
      && url.hostname === "www.khanacademy.org"
      && /^\/teacher\/class\/[^/]+\/overview(?:\/|$)/.test(url.pathname);
  } catch {
    activeTabIsKhan = false;
  }
}

async function updateStatus() {
  if (activeTabId === null) return;
  try {
    const result = await send({ type: "capture:status", tabId: activeTabId });
    if (!result?.ok) throw new Error(result?.error || "Could not read capture status.");
    const capture = result.capture;

    downloadButton.hidden = capture?.status !== "complete";
    cancelButton.hidden = capture?.status !== "armed";
    captureButton.disabled = !activeTabIsKhan;

    if (!activeTabIsKhan) {
      setStatus("Open a Khan Academy classroom Activity Overview page to start capture.");
    } else if (capture?.status === "armed") {
      setStatus("Capture is armed. The page is refreshing; wait for its activity report to load.");
    } else if (capture?.status === "complete") {
      const count = capture.data.response.data.teacherOverviewByStudentReport.rows.length;
      setStatus(`Capture complete: ${new Intl.NumberFormat().format(count)} student rows are ready to download.`);
    } else {
      setStatus("Ready to capture. Start when the Activity Overview is open.");
    }
  } catch (error) {
    captureButton.disabled = true;
    setStatus(error instanceof Error ? error.message : "Could not check capture status.", true);
  }
}

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  setStatus("Arming capture…");
  try {
    if (activeTabId === null) await getCurrentTab();
    if (!activeTabIsKhan) throw new Error("Open a Khan Academy classroom Activity Overview page first.");
    const result = await send({ type: "capture:arm", tabId: activeTabId });
    if (!result?.ok) throw new Error(result?.error || "Could not start capture.");
    await chrome.tabs.reload(activeTabId);
    await updateStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not start capture.", true);
    captureButton.disabled = !activeTabIsKhan;
  }
});

downloadButton.addEventListener("click", async () => {
  downloadButton.disabled = true;
  try {
    const result = await send({ type: "capture:export", tabId: activeTabId });
    if (!result?.ok) throw new Error(result?.error || "No captured data is available.");
    const blob = new Blob([`${JSON.stringify(result.data, null, 2)}\n`], {
      type: "application/json;charset=utf-8"
    });
    const objectUrl = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({
        url: objectUrl,
        filename: "khan-activity-export.json",
        saveAs: true
      });
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    setStatus("Download started. The JSON can be opened in Class Activity Explorer.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not download captured data.", true);
  } finally {
    downloadButton.disabled = false;
  }
});

cancelButton.addEventListener("click", async () => {
  cancelButton.disabled = true;
  try {
    const result = await send({ type: "capture:cancel", tabId: activeTabId });
    if (!result?.ok) throw new Error(result?.error || "Could not cancel capture.");
    await updateStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not cancel capture.", true);
  } finally {
    cancelButton.disabled = false;
  }
});

async function initialize() {
  try {
    await getCurrentTab();
    await updateStatus();
    refreshTimer = setInterval(updateStatus, 1000);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not inspect the current tab.", true);
  }
}

window.addEventListener("unload", () => {
  if (refreshTimer !== null) clearInterval(refreshTimer);
});

initialize();
