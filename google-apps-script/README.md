# Apps Script backend — moved

The backend that receives this site's feedback and error reports now lives in
one place:

**https://github.com/YAL-PJ/apps-script-backend** → `src/feedback-backend.gs`

The copy that used to sit here was the one actually deployed (confirmed via
`?action=health`), so it became the base for the canonical version. Three other
repos held copies that disagreed with it and had never been deployed.

## This site's wiring

- `feedback.js` → `FEEDBACK_ENDPOINT`, posts `{ app: 'freemergepdf', ... }`
- `error-reporting.js` → `ERROR_APPS_SCRIPT_ENDPOINT`, posts
  `{ action: 'error_report', app: 'freemergepdf', ... }`, with a Google Form
  fallback (`ERROR_FORM`) that has its own separate field mapping.

The endpoint URL is stable. To change backend behaviour, edit and deploy from
the canonical repo — do not paste code into the Apps Script editor by hand.
