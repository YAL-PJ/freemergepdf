// This file was the previous Google Forms-based error reporter.
// It has been replaced by error-tracker.js, which posts to the shared
// Apps Script backend (google-apps-script/feedback-backend.gs).
//
// All call sites referencing window.reportError continue to work — the new
// tracker registers the same function. See error-tracker.js for the impl.
