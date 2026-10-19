"use strict";

const statusNode = document.querySelector("#status");
const captureButton = document.querySelector("#capture");
const downloadButton = document.querySelector("#download");
const cancelButton = document.querySelector("#cancel");
const detailRadios = [...document.querySelectorAll("input[name=\"capture-mode\"]")];

function selectedCaptureMode() {
  for (const radio of detailRadios) {
    if (radio.checked) return radio.value === "full" ? "full" : "summary";
  }
  return "summary";
}

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
    const isFullCapture = (capture?.mode || "summary") === "full";
    const captureInProgress = ["armed", "collecting"].includes(capture?.status);
    for (const radio of detailRadios) {
      radio.disabled = captureInProgress;
      if (captureInProgress) radio.checked = radio.value === (capture?.mode || "summary");
    }

    const autoProgress = capture?.autoProgress || {};
    const readyToFinish = capture?.status === "collecting" && autoProgress.done === true;
    downloadButton.hidden = capture?.status !== "complete" && !readyToFinish;
    downloadButton.textContent = capture?.status === "complete" ? "Download captured JSON" : "Finish and download JSON";
    cancelButton.hidden = !["armed", "collecting"].includes(capture?.status);
    captureButton.disabled = !activeTabIsKhan || ["armed", "collecting"].includes(capture?.status);

    if (!activeTabIsKhan) {
      setStatus("Open a Khan Academy classroom Activity Overview page to start capture.");
    } else if (capture?.status === "armed") {
      setStatus("Capture is armed. The page is refreshing; wait for its activity report to load.");
    } else if (capture?.status === "collecting") {
      const studentCount = capture.data.response.data.teacherOverviewByStudentReport.rows.length;
      const courseReportCount = (capture.expandedStudentReports || []).length;
      const skillReportCount = (capture.expandedCourseReports || []).length;
      const capturedSoFar = isFullCapture
        ? `${new Intl.NumberFormat().format(courseReportCount)} student cards and `
          + `${new Intl.NumberFormat().format(skillReportCount)} course breakdowns`
        : `${new Intl.NumberFormat().format(courseReportCount)} student course reports`;
      const reportList = isFullCapture
        ? `${new Intl.NumberFormat().format(courseReportCount)} student reports and `
          + `${new Intl.NumberFormat().format(skillReportCount)} course breakdowns`
        : `${new Intl.NumberFormat().format(courseReportCount)} student course reports`;
      if (!autoProgress.done) {
        const current = autoProgress.current ? ` Opening ${autoProgress.current}.` : "";
        setStatus(
          `Class overview captured (${new Intl.NumberFormat().format(studentCount)} students). `
          + `Automatically captured ${capturedSoFar} so far.`
          + current
        );
      } else if (autoProgress.error) {
        setStatus(
          `Automatic expansion stopped: ${autoProgress.error} `
          + `${reportList} are available to download.`
        );
      } else if (autoProgress.failed) {
        setStatus(
          `Automatic expansion finished: ${reportList} captured; `
          + `${new Intl.NumberFormat().format(autoProgress.failed)} rows could not be captured. You can download the available data.`
        );
      } else {
        setStatus(`Automatic expansion finished: ${reportList} captured.`);
      }
    } else if (capture?.status === "complete") {
      const count = capture.data.response.data.teacherOverviewByStudentReport.rows.length;
      const courseCount = (capture.expandedStudentReports || []).length;
      const skillCount = (capture.expandedCourseReports || []).length;
      const summary = isFullCapture
        ? `Capture complete: ${new Intl.NumberFormat().format(count)} class rows, `
          + `${new Intl.NumberFormat().format(courseCount)} student reports, and `
          + `${new Intl.NumberFormat().format(skillCount)} course breakdowns are ready.`
        : `Capture complete: ${new Intl.NumberFormat().format(count)} class rows and `
          + `${new Intl.NumberFormat().format(courseCount)} student course reports are ready.`;
      if (autoProgress.error) {
        setStatus(`${summary} Automatic expansion stopped early: ${autoProgress.error}`);
      } else if (autoProgress.failed) {
        setStatus(`${summary} ${new Intl.NumberFormat().format(autoProgress.failed)} details could not be captured.`);
      } else {
        setStatus(summary);
      }
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
    const result = await send({ type: "capture:arm", tabId: activeTabId, mode: selectedCaptureMode() });
    if (!result?.ok) throw new Error(result?.error || "Could not start capture.");
    await chrome.tabs.reload(activeTabId);
    await updateStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not start capture.", true);
    captureButton.disabled = !activeTabIsKhan;
  }
});

async function downloadData(data) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
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
}

downloadButton.addEventListener("click", async () => {
  downloadButton.disabled = true;
  try {
    const statusResult = await send({ type: "capture:status", tabId: activeTabId });
    if (!statusResult?.ok) throw new Error(statusResult?.error || "Could not read capture status.");
    const result = await send({
      type: statusResult.capture?.status === "collecting" ? "capture:finish" : "capture:export",
      tabId: activeTabId
    });
    if (!result?.ok) throw new Error(result?.error || "No captured data is available.");
    await downloadData(result.data);
    setStatus(
      `Download started with ${new Intl.NumberFormat().format(result.courseReportCount || 0)} student course reports.`
    );
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
