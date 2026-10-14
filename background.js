"use strict";

const OPERATION = "GetProgressByStudent";
const CHANNEL = "khan-classroom-activity-capture-v1";
const CAPTURE_PREFIX = "capture:";

function captureKey(tabId) {
  return `${CAPTURE_PREFIX}${tabId}`;
}

function isActivityOverviewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "www.khanacademy.org"
      && /^\/teacher\/class\/[^/]+\/overview(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function isActivityExport(value) {
  return value?.operationName === OPERATION
    && value?.response?.data?.teacherOverviewByStudentReport
    && Array.isArray(value.response.data.teacherOverviewByStudentReport.rows);
}

async function getCapture(tabId) {
  const result = await chrome.storage.session.get(captureKey(tabId));
  return result[captureKey(tabId)] || null;
}

async function setCapture(tabId, capture) {
  await chrome.storage.session.set({ [captureKey(tabId)]: capture });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "capture:content-ready") {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !isActivityOverviewUrl(sender.url)) {
      sendResponse({ ok: false, error: "This is not an eligible Khan Academy page." });
      return;
    }
    getCapture(tabId)
      .then((capture) => sendResponse({ ok: true, capture }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture:arm") {
    const tabId = message.tabId;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "Could not identify the active tab." });
      return;
    }
    chrome.tabs.get(tabId).then((tab) => {
      if (!isActivityOverviewUrl(tab.url)) {
        sendResponse({ ok: false, error: "Open a Khan Academy classroom Activity Overview page first." });
        return;
      }
      return setCapture(tabId, {
        status: "armed",
        startedAt: new Date().toISOString(),
        data: null
      }).then(() => sendResponse({ ok: true }));
    }).catch((error) => {
      sendResponse({ ok: false, error: error.message || "Could not arm capture for this tab." });
    });
    return true;
  }

  if (message?.type === "capture:status") {
    if (!Number.isInteger(message.tabId)) {
      sendResponse({ ok: false, error: "Could not identify the active tab." });
      return;
    }
    getCapture(message.tabId)
      .then((capture) => sendResponse({ ok: true, capture }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture:cancel") {
    if (!Number.isInteger(message.tabId)) {
      sendResponse({ ok: false, error: "Could not identify the active tab." });
      return;
    }
    chrome.storage.session.remove(captureKey(message.tabId))
      .then(() => {
        chrome.tabs.sendMessage(message.tabId, { type: "capture:stop" }).catch(() => {});
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture:export") {
    if (!Number.isInteger(message.tabId)) {
      sendResponse({ ok: false, error: "Could not identify the active tab." });
      return;
    }
    getCapture(message.tabId)
      .then((capture) => {
        if (capture?.status !== "complete" || !isActivityExport(capture.data)) {
          sendResponse({ ok: false, error: "No completed capture is available to download." });
          return;
        }
        sendResponse({ ok: true, data: capture.data });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture:page-data") {
    if (!Number.isInteger(sender.tab?.id) || !isActivityOverviewUrl(sender.url) || !isActivityExport(message.data)) {
      sendResponse({ ok: false, error: "The page did not send a valid Activity Overview response." });
      return;
    }
    const tabId = sender.tab.id;
    getCapture(tabId).then(async (capture) => {
      if (capture?.status !== "armed") {
        sendResponse({ ok: false, error: "Capture is no longer armed." });
        return;
      }
      await setCapture(tabId, {
        ...capture,
        status: "complete",
        completedAt: new Date().toISOString(),
        data: message.data
      });
      chrome.tabs.sendMessage(tabId, { type: "capture:stop" }).catch(() => {});
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(captureKey(tabId)).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && !isActivityOverviewUrl(tab.url)) {
    chrome.storage.session.remove(captureKey(tabId)).catch(() => {});
  }
});
