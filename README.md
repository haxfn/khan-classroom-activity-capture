# Khan Classroom Activity Capture

A local Chrome extension that captures the Activity Overview report from the current Khan Academy tab after you explicitly start a capture. It exports JSON in the format accepted by `Class Activity Explorer.html`.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this `khan-classroom-capture` folder.
4. Sign in to Khan Academy and open the class **Activity overview** page.
5. Select the extension icon and choose **Capture activity and refresh page**.
6. Wait for the report to load. Reopen the extension popup if the browser closed it during refresh.
7. Select **Download captured JSON** and upload `khan-activity-export.json` in Class Activity Explorer.

## Scope and privacy

- Capture is user-initiated and refreshes the current Khan Academy page.
- The extension only looks for the `GetProgressByStudent` Activity Overview response.
- Data is held in `chrome.storage.session` for the current browser session and the current tab; closing that tab removes it.
- The extension does not collect passwords or cookies and does not send captured data to a server.
- The extension requests Khan Academy site access so Chrome can run it on the teacher classroom pages; its scripts are restricted to `/teacher/class/.../overview/...` pages. Captured information may include identifiable student records; keep the exported file private.
- Only the report and filters actually returned by that page refresh are included. This does not fetch other report tabs, date ranges, or pages.

The extension depends on Khan Academy's current client behavior. If it reports that no response was found, verify that the Activity Overview page finished loading and try the capture again.
