"use strict";

const CHANNEL = "khan-classroom-activity-capture-v1";
let automationRun = 0;
const courseWaiters = new Map();
const skillWaiters = new Map();

function sendPageEvent(type) {
  window.postMessage({ channel: CHANNEL, type }, location.origin);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "capture:stop") {
    automationRun += 1;
    for (const resolve of courseWaiters.values()) resolve(null);
    for (const resolve of skillWaiters.values()) resolve(false);
    courseWaiters.clear();
    skillWaiters.clear();
    sendPageEvent("capture:stop");
  } else if (message?.type === "capture:course-captured") {
    courseWaiters.get(message.studentKaid)?.(message.courses || []);
  } else if (message?.type === "capture:skills-captured") {
    skillWaiters.get(`${message.studentKaid}:${message.courseId}`)?.();
  }
});

chrome.runtime.sendMessage({ type: "capture:content-ready" }).then((result) => {
  if (result?.capture?.status === "armed") sendPageEvent("capture:arm");
}).catch(() => {});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (message?.channel !== CHANNEL || message.type !== "capture:page-data") return;
  chrome.runtime.sendMessage({ type: "capture:page-data", data: message.data }).then((result) => {
    if (!result?.ok || result.status !== "collecting" || message.data.operationName !== "GetProgressByStudent") return;
    automateStudentRows(result.students || []);
  }).catch(() => {});
});

function rowForText(text) {
  const matches = [...document.querySelectorAll('[role="row"]')]
    .filter((row) => row.textContent?.includes(text))
    .sort((a, b) => a.textContent.length - b.textContent.length);
  return matches[0] || null;
}

function studentRowFor(student) {
  return rowForText(student.nickname);
}

async function waitForStudentRow(student, run) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && run === automationRun) {
    const row = studentRowFor(student);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function waitForCourseReport(studentKaid, run) {
  if (run !== automationRun) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      courseWaiters.delete(studentKaid);
      resolve(null);
    }, 15_000);
    courseWaiters.set(studentKaid, (courses) => {
      clearTimeout(timer);
      courseWaiters.delete(studentKaid);
      resolve(run === automationRun ? courses : null);
    });
  });
}

async function waitForCourseRow(course, run) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && run === automationRun) {
    const row = rowForText(course.title);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function waitForSkillReport(studentKaid, courseId, run) {
  if (run !== automationRun) return false;
  const key = `${studentKaid}:${courseId}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      skillWaiters.delete(key);
      resolve(false);
    }, 15_000);
    skillWaiters.set(key, () => {
      clearTimeout(timer);
      skillWaiters.delete(key);
      resolve(run === automationRun);
    });
  });
}

async function reportProgress(progress) {
  const result = await chrome.runtime.sendMessage({ type: "capture:auto-progress", progress });
  if (!result?.ok) throw new Error(result?.error || "Could not update automatic capture progress.");
}

async function automateStudentRows(students) {
  const run = ++automationRun;
  let failed = 0;
  try {
    for (let index = 0; index < students.length; index += 1) {
      if (run !== automationRun) return;
      const student = students[index];
      await reportProgress({
        total: students.length,
        completed: index,
        failed,
        current: student.nickname,
        done: false
      });

      const row = await waitForStudentRow(student, run);
      if (!row) {
        failed += 1;
        continue;
      }

      const responseArrived = waitForCourseReport(student.studentKaid, run);
      row.scrollIntoView({ block: "center", behavior: "instant" });
      row.click();
      const courses = await responseArrived;
      if (!courses) {
        if (run !== automationRun) return;
        failed += 1;
      } else {
        for (const course of courses) {
          if (run !== automationRun) return;
          await reportProgress({
            total: students.length,
            completed: index,
            failed,
            current: `${student.nickname} · ${course.title}`,
            done: false
          });
          const courseRow = await waitForCourseRow(course, run);
          if (!courseRow) {
            failed += 1;
            continue;
          }
          const skillsArrived = waitForSkillReport(student.studentKaid, course.courseId, run);
          courseRow.scrollIntoView({ block: "center", behavior: "instant" });
          courseRow.click();
          if (await skillsArrived) {
            rowForText(course.title)?.click();
          } else {
            if (run !== automationRun) return;
            failed += 1;
          }
        }
        studentRowFor(student)?.click();
      }
      await reportProgress({
        total: students.length,
        completed: index + 1,
        failed,
        current: "",
        done: false
      });
    }

    if (run !== automationRun) return;
    await reportProgress({
      total: students.length,
      completed: students.length,
      failed,
      current: "",
      done: true
    });
  } catch (error) {
    if (run !== automationRun) return;
    await chrome.runtime.sendMessage({
      type: "capture:auto-error",
      error: error instanceof Error ? error.message : "Automatic row expansion stopped."
    });
  }
}
