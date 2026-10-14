"use strict";

(() => {
  const CHANNEL = "khan-classroom-activity-capture-v1";
  const OPERATION = "GetProgressByStudent";
  let armed = false;
  let delivered = false;

  function requestPayloadFromText(text) {
    if (typeof text !== "string") return null;
    try {
      const value = JSON.parse(text);
      return value?.operationName === OPERATION ? value : null;
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
    if (!armed || delivered || !response?.data?.teacherOverviewByStudentReport) return;
    delivered = true;
    armed = false;
    window.postMessage({
      channel: CHANNEL,
      type: "capture:page-data",
      data: {
        operationName: OPERATION,
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
      if (!payload || !armed || delivered || xhr.status < 200 || xhr.status >= 300) return;
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
      delivered = false;
    } else if (event.data.type === "capture:stop") {
      armed = false;
    }
  });
})();
