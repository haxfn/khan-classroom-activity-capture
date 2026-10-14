"use strict";

const OPERATION = "GetProgressByStudent";
const COURSE_OPERATION = "GetProgressByCourseForStudent";
const SKILL_OPERATION = "GetProgressBySkillForStudentForCourse";
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

function isCourseExport(value) {
  return value?.operationName === COURSE_OPERATION
    && typeof value?.requestVariables?.studentKaid === "string"
    && value?.response?.data?.teacherOverviewByCourseForStudentReport
    && Array.isArray(value.response.data.teacherOverviewByCourseForStudentReport.rows);
}

function isSkillExport(value) {
  return value?.operationName === SKILL_OPERATION
    && typeof value?.requestVariables?.studentKaid === "string"
    && typeof value?.requestVariables?.courseId === "string"
    && value?.response?.data?.teacherOverviewBySkillForStudentForCourseReport
    && Array.isArray(value.response.data.teacherOverviewBySkillForStudentForCourseReport.rows)
    && value?.response?.data?.courseById;
}

function coursesToExpand(value) {
  return (value.response.data.teacherOverviewByCourseForStudentReport.rows || [])
    .filter((row) => row?.course?.id && Object.values(row.info || {}).some(
      (metric) => typeof metric === "number" && metric > 0
    ))
    .map((row) => ({
      courseId: row.course.id,
      title: row.course.translatedTitle || row.productFeature?.translatedTitle || row.course.id
    }));
}

function studentsToExpand(data) {
  const classroom = data.response.data.classroom;
  const nicknames = new Map(
    (classroom?.studentKaidsAndNicknames || [])
      .filter((student) => student?.kaid)
      .map((student) => [student.kaid, student.coachNickname || ""])
  );
  return data.response.data.teacherOverviewByStudentReport.rows
    .filter((row) => Object.values(row.info || {}).some((value) => typeof value === "number" && value > 0))
    .map((row) => ({
      studentKaid: row.user.kaid,
      nickname: nicknames.get(row.user.kaid) || ""
    }))
    .filter((student) => student.studentKaid && student.nickname);
}

async function getCapture(tabId) {
  const result = await chrome.storage.session.get(captureKey(tabId));
  return result[captureKey(tabId)] || null;
}

async function setCapture(tabId, capture) {
  await chrome.storage.session.set({ [captureKey(tabId)]: capture });
}

async function compressReport(report) {
  const compressed = new Response(
    new Blob([JSON.stringify(report)]).stream().pipeThrough(new CompressionStream("gzip"))
  );
  const bytes = new Uint8Array(await compressed.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function decompressReports(reports) {
  return Promise.all((reports || []).map(async (packed) => {
    const bytes = Uint8Array.from(atob(packed.payload), (character) => character.charCodeAt(0));
    const decompressed = new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
    );
    const report = JSON.parse(await decompressed.text());
    if (report.requestVariables?.studentKaid !== packed.studentKaid) {
      throw new Error("A captured student report could not be restored.");
    }
    if (packed.courseId && report.requestVariables?.courseId !== packed.courseId) {
      throw new Error("A captured course report could not be restored.");
    }
    return { ...report, capturedAt: packed.capturedAt };
  }));
}

async function exportData(capture) {
  const [expandedStudentReports, expandedCourseReports] = await Promise.all([
    decompressReports(capture.expandedStudentReports),
    decompressReports(capture.expandedCourseReports)
  ]);
  return {
    ...capture.data,
    expandedStudentReports,
    expandedCourseReports
  };
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
        data: null,
        expandedStudentReports: [],
        expandedCourseReports: []
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
      .then(async (capture) => {
        if (capture?.status !== "complete" || !isActivityExport(capture.data)) {
          sendResponse({ ok: false, error: "No completed capture is available to download." });
          return;
        }
        sendResponse({
          ok: true,
          data: await exportData(capture)
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture:finish") {
    if (!Number.isInteger(message.tabId)) {
      sendResponse({ ok: false, error: "Could not identify the active tab." });
      return;
    }
    getCapture(message.tabId)
      .then(async (capture) => {
        if (!capture || !["collecting", "complete"].includes(capture.status) || !isActivityExport(capture.data)) {
          sendResponse({ ok: false, error: "The class overview has not been captured yet." });
          return;
        }
        const completed = { ...capture, status: "complete", completedAt: new Date().toISOString() };
        await setCapture(message.tabId, completed);
        chrome.tabs.sendMessage(message.tabId, { type: "capture:stop" }).catch(() => {});
        sendResponse({
          ok: true,
          data: await exportData(completed),
          courseReportCount: (completed.expandedStudentReports || []).length,
          skillReportCount: (completed.expandedCourseReports || []).length
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture:page-data") {
    const validSummary = isActivityExport(message.data);
    const validCourseReport = isCourseExport(message.data);
    const validSkillReport = isSkillExport(message.data);
    if (!Number.isInteger(sender.tab?.id) || !isActivityOverviewUrl(sender.url) || (!validSummary && !validCourseReport && !validSkillReport)) {
      sendResponse({ ok: false, error: "The page did not send a supported Activity Overview response." });
      return;
    }
    const tabId = sender.tab.id;
    getCapture(tabId).then(async (capture) => {
      if (validSummary) {
        if (capture?.status !== "armed") {
          sendResponse({ ok: false, error: "Capture is no longer waiting for the class overview." });
          return;
        }
        const collecting = {
          ...capture,
          status: "collecting",
          data: message.data,
          expandedStudentReports: [],
          expandedCourseReports: [],
          autoProgress: {
            total: studentsToExpand(message.data).length,
            completed: 0,
            failed: 0,
            current: "",
            done: false
          }
        };
        await setCapture(tabId, collecting);
        sendResponse({
          ok: true,
          status: collecting.status,
          students: studentsToExpand(message.data),
          courseReportCount: 0
        });
        return;
      }

      if (capture?.status !== "collecting" || !isActivityExport(capture.data)) {
        sendResponse({ ok: false, error: "Capture the class overview before opening student cards." });
        return;
      }
      if (validSkillReport) {
        const reports = capture.expandedCourseReports || [];
        const report = {
          studentKaid: message.data.requestVariables.studentKaid,
          courseId: message.data.requestVariables.courseId,
          capturedAt: new Date().toISOString(),
          payload: await compressReport(message.data)
        };
        const existingIndex = reports.findIndex(
          (item) => item.studentKaid === report.studentKaid
            && item.courseId === report.courseId
        );
        if (existingIndex === -1) reports.push(report);
        else reports[existingIndex] = report;
        await setCapture(tabId, { ...capture, expandedCourseReports: reports });
        chrome.tabs.sendMessage(tabId, {
          type: "capture:skills-captured",
          studentKaid: message.data.requestVariables.studentKaid,
          courseId: message.data.requestVariables.courseId,
          skillReportCount: reports.length
        }).catch(() => {});
        sendResponse({ ok: true, status: "collecting", skillReportCount: reports.length });
        return;
      }
      const reports = capture.expandedStudentReports || [];
      const report = {
        studentKaid: message.data.requestVariables.studentKaid,
        capturedAt: new Date().toISOString(),
        payload: await compressReport(message.data)
      };
      const existingIndex = reports.findIndex(
        (item) => item.studentKaid === report.studentKaid
      );
      if (existingIndex === -1) reports.push(report);
      else reports[existingIndex] = report;
      await setCapture(tabId, { ...capture, expandedStudentReports: reports });
      const courses = coursesToExpand(message.data);
      chrome.tabs.sendMessage(tabId, {
        type: "capture:course-captured",
        studentKaid: message.data.requestVariables.studentKaid,
        courses,
        courseReportCount: reports.length
      }).catch(() => {});
      sendResponse({ ok: true, status: "collecting", courses, courseReportCount: reports.length });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture:auto-progress") {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !isActivityOverviewUrl(sender.url)) {
      sendResponse({ ok: false, error: "Automatic capture updates must come from the Activity Overview page." });
      return;
    }
    getCapture(tabId).then(async (capture) => {
      if (capture?.status !== "collecting") {
        sendResponse({ ok: false, error: "Capture is no longer active." });
        return;
      }
      await setCapture(tabId, {
        ...capture,
        autoProgress: {
          ...(capture.autoProgress || {}),
          ...message.progress
        }
      });
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture:auto-error") {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !isActivityOverviewUrl(sender.url)) {
      sendResponse({ ok: false, error: "Automatic capture errors must come from the Activity Overview page." });
      return;
    }
    getCapture(tabId).then(async (capture) => {
      if (capture?.status !== "collecting") {
        sendResponse({ ok: false, error: "Capture is no longer active." });
        return;
      }
      await setCapture(tabId, {
        ...capture,
        autoProgress: {
          ...(capture.autoProgress || {}),
          done: true,
          error: String(message.error || "Automatic row expansion stopped.")
        }
      });
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
