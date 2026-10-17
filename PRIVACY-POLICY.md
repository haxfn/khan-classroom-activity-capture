# Privacy Policy

**Last updated: October 17, 2026**

Khan Classroom Activity Capture is a Chrome extension that captures activity reports from the Khan Academy teacher Activity Overview page and lets the user download those reports as a JSON file for use with Class Activity Explorer.

## Information handled

When the user explicitly starts a capture, the extension reads the following report responses from the currently open Khan Academy class Activity Overview:

- The class activity report, which can include student identifiers, nicknames, and activity metrics.
- Per-student course reports and per-course skill reports for students and courses with activity.

The extension does not collect passwords, cookies, general browsing history, or keystrokes. It only processes the report types needed for its capture purpose, on the supported teacher class overview page.

## How information is used and stored

Captured reports are temporarily stored in Chrome session storage for the current tab while the capture is in progress. Expanded reports are compressed locally before storage. The capture is removed when its tab is closed or navigated away from the supported page, and Chrome session storage is temporary to the browser session.

When the user chooses to finish and download, the extension creates a JSON file on the user's device. The file may contain identifiable student information and progress data. The user is responsible for protecting the downloaded file and deciding whether to provide it to another application, including Class Activity Explorer.

## Sharing and sale

The extension's code does not send captured reports to the extension developer or to an extension-operated server, and the developer does not sell or transfer this information. The extension does not use captured information for advertising, creditworthiness, or purposes unrelated to its capture and export functionality.

The extension operates on Khan Academy pages and does not control Khan Academy's own handling of information. Any separate application to which the user uploads the downloaded file has its own privacy practices.

## Data security and retention

The extension processes reports locally in the browser and does not maintain a developer-operated copy. Temporary browser storage is cleared as described above. A downloaded JSON file remains under the user's control and should be deleted when no longer needed.

## Changes and contact

This policy may be updated if the extension's data handling changes. The current version will be published with the extension's source repository. For questions about this policy, contact the repository owner through the repository's GitHub page.
