"use strict";

(() => {
  const CHANNEL = "khan-classroom-activity-capture-v1";
  const SUMMARY_OPERATION = "GetProgressByStudent";
  const COURSE_OPERATION = "GetProgressByCourseForStudent";
  const SKILL_OPERATION = "GetProgressBySkillForStudentForCourse";
  let armed = false;
  let summaryDelivered = false;

  function requestPayloadFromText(text) {
    if (typeof text !== "string") return null;
    try {
      const value = JSON.parse(text);
      return [SUMMARY_OPERATION, COURSE_OPERATION, SKILL_OPERATION].includes(value?.operationName) ? value : null;
    } catch {
      return null;
    }
  }

  function requestPayload(input, init) {
    if (typeof init?.body === "string") {
      return Promise.resolve(requestPayloadFromText(init.body));
    }
    if (input instanceof Request) {
      return input.clone().text().then(requestPayloadFromText).catch(() => null);
    }
    return Promise.resolve(null);
  }

  function publish(request, response) {
    if (!armed) return;
    const isSummary = request.operationName === SUMMARY_OPERATION
      && response?.data?.teacherOverviewByStudentReport;
    const isCourseReport = request.operationName === COURSE_OPERATION
      && response?.data?.teacherOverviewByCourseForStudentReport
      && typeof request.variables?.studentKaid === "string";
    const isSkillReport = request.operationName === SKILL_OPERATION
      && response?.data?.teacherOverviewBySkillForStudentForCourseReport
      && typeof request.variables?.studentKaid === "string"
      && typeof request.variables?.courseId === "string";
    if (isSummary && summaryDelivered) return;
    if (!isSummary && !isCourseReport && !isSkillReport) return;
    if (isSummary) summaryDelivered = true;
    window.postMessage({
      channel: CHANNEL,
      type: "capture:page-data",
      data: {
        operationName: request.operationName,
        requestVariables: request.variables || {},
        response
      }
    }, location.origin);
  }

  function inspectJson(request, readResponse) {
    request.then((payload) => {
      if (!payload) return;
      Promise.resolve().then(readResponse).then((response) => {
        if (response && typeof response === "object") publish(payload, response);
      }).catch(() => {});
    }).catch(() => {});
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function(input, init) {
      const request = requestPayload(input, init);
      return originalFetch.apply(this, arguments).then((response) => {
        inspectJson(request, () => response.clone().json());
        return response;
      });
    };
  }

  const xhrRequests = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    xhrRequests.set(this, null);
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    xhrRequests.set(xhr, requestPayloadFromText(typeof body === "string" ? body : ""));
    xhr.addEventListener("load", function() {
      const payload = xhrRequests.get(xhr);
      if (!payload || !armed || xhr.status < 200 || xhr.status >= 300) return;
      let response;
      try {
        response = xhr.responseType === "json" ? xhr.response : JSON.parse(xhr.responseText);
      } catch {
        return;
      }
      publish(payload, response);
    }, { once: true });
    return originalSend.apply(this, arguments);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
    if (event.data.type === "capture:arm") {
      armed = true;
      summaryDelivered = false;
    } else if (event.data.type === "capture:stop") {
      armed = false;
    }
  });
})();
