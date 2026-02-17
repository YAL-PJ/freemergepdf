// Lightweight background error reporter posting to a private Google Form
const ERROR_FORM = {
    formId: '1FAIpQLScU-BSqZxoccP0MO5jXfV7xieP-_1Iw6Bu2_GBZr1il6Jt8Dw',
    fields: {
        message: 'entry.344292171',
        stack: 'entry.830093809',
        url: 'entry.481622629',
        feature: 'entry.1336491440',
        userAgent: 'entry.387606365',
        appVersion: 'entry.1662306861',
        userNote: 'entry.1016590946'
    }
};

const ERROR_REPORT_LIMITS = {
    stackLength: 1800,
    throttleMs: 8000
};

let lastErrorFingerprint = '';
let lastErrorAt = 0;

function scrub(text = '') {
    return String(text || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]');
}

function fingerprint(message, feature, note = '') {
    return `${message}|${feature || ''}|${note || ''}`;
}

function normalizeError(err) {
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack || '' };
    }
    if (err && typeof err === 'object') {
        if (typeof err.message === 'string') {
            return { message: err.message, stack: err.stack || '' };
        }
        try {
            return { message: JSON.stringify(err), stack: '' };
        } catch (_) {
            return { message: String(err), stack: '' };
        }
    }
    return { message: String(err || 'Unknown error'), stack: '' };
}

function sendErrorReport(err, context = {}) {
    try {
        const { message, stack } = normalizeError(err);
        const safeMessage = scrub(message).slice(0, 500);
        const safeStack = scrub(stack).slice(0, ERROR_REPORT_LIMITS.stackLength);
        const feature = scrub(context.feature || '');
        const endpoint = `https://docs.google.com/forms/d/e/${ERROR_FORM.formId}/formResponse`;
        const safeUserNote = scrub(context.userNote || '').slice(0, 500);

        const now = Date.now();
        const fp = fingerprint(safeMessage, feature, safeUserNote.slice(0, 120));
        if (fp === lastErrorFingerprint && now - lastErrorAt < ERROR_REPORT_LIMITS.throttleMs) {
            return;
        }
        lastErrorFingerprint = fp;
        lastErrorAt = now;

        const formData = new FormData();
        formData.append(ERROR_FORM.fields.message, safeMessage || 'Unknown error');
        if (safeStack) formData.append(ERROR_FORM.fields.stack, safeStack);
        formData.append(ERROR_FORM.fields.url, context.url || window.location.pathname || '');
        if (feature) formData.append(ERROR_FORM.fields.feature, feature);
        if (navigator?.userAgent) formData.append(ERROR_FORM.fields.userAgent, navigator.userAgent);
        const appVersion = scrub(context.appVersion || window.APP_VERSION || '');
        if (appVersion) formData.append(ERROR_FORM.fields.appVersion, appVersion);
        if (safeUserNote) formData.append(ERROR_FORM.fields.userNote, safeUserNote);

        fetch(endpoint, {
            method: 'POST',
            body: formData,
            mode: 'no-cors'
        }).catch(() => { /* ignore */ });
    } catch (reportErr) {
        console.warn('Error reporter failed', reportErr);
    }
}

window.reportError = sendErrorReport;

window.addEventListener('error', (event) => {
    // Cross-origin script failures are reported by browsers as "Script error."
    // with no actionable stack. Skip to reduce noise.
    if ((event?.message || '').trim().toLowerCase() === 'script error.') {
        return;
    }
    const err = event.error || new Error(event.message || 'Unknown window error');
    sendErrorReport(err, {
        feature: 'window.error',
        url: event.filename || window.location.pathname
    });
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unknown rejection'));
    sendErrorReport(reason, {
        feature: 'unhandledrejection',
        url: window.location.pathname
    });
});
