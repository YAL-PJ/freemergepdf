// Lightweight background error reporter posting to the private Apps Script backend with Google Form fallback
const ERROR_APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzgIwblyMQv4O8GypUMT7xfj8Xkv6W2oyCFxZVcUExwpWhHr_7WWXQlvi2tfzjXisu4Ww/exec';

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
    throttleMs: 8000,
    // Safe PDF metadata is appended after the caller's breadcrumb, so the note can
    // grow past the 500-char base cap by at most this much.
    pdfMetaNoteLength: 320
};

let lastErrorFingerprint = '';
let lastErrorAt = 0;

function isSameOriginUrl(url) {
    try {
        if (!url) return true;
        const parsed = new URL(url, window.location.href);
        return parsed.origin === window.location.origin;
    } catch (_) {
        return true;
    }
}

function shouldIgnoreKnownNoise(err, context = {}) {
    const message = String(err?.message || '').toLowerCase();
    const stack = String(err?.stack || '').toLowerCase();
    const url = String(context?.url || '').toLowerCase();
    const feature = String(context?.feature || '').toLowerCase();
    const joined = `${message} ${stack} ${url}`;

    // Third-party widget/ad-tech failures are noisy and not actionable for core PDF flows.
    if (joined.includes('uid2 sdk failed to load')) return true;
    if (joined.includes('cdn.prod.uidapi.com')) return true;
    if (joined.includes('faves.grow.me')) return true;
    if (joined.includes('scripts.scriptwrapper.com')) return true;
    if (joined.includes('scripts.journeymv.com')) return true;
    if (joined.includes('securepubads.g.doubleclick.net')) return true;
    if (joined.includes('api.rlcdn.com')) return true;
    if (joined.includes('id5-sync.com')) return true;
    if (joined.includes('rubiconproject.com')) return true;
    if (joined.includes('spotxchange.com')) return true;
    if (joined.includes('journeymv.com')) return true;
    if (joined.includes('smilewanted.com')) return true;
    if (joined.includes('amazon-adsystem.com')) return true;
    if (joined.includes('/tags/optable/')) return true;

    // Third-party prebid connector can fail on some Safari/iPad environments; not actionable for core PDF flows.
    if (joined.includes('api.receptivity.io') && message.includes("can't find variable: webassembly")) return true;
    if (joined.includes('rxconnector.js') && message.includes("can't find variable: webassembly")) return true;
    if (joined.includes('attestation check for topics')) return true;
    if (joined.includes('getuid?gdpr=') && joined.includes('failed to load resource: the server responded with a status of 400')) return true;
    if (joined.includes('google-analytics.com/g/collect') && message.includes('failed to fetch')) return true;
    if (feature === 'unhandledrejection' && message.includes('failed validating event')) return true;
    if (feature === 'unhandledrejection' && message.includes('failed parsing identifiers')) return true;
    if (feature === 'unhandledrejection' && message.includes('signal is aborted without reason')) return true;
    if (feature === 'unhandledrejection' && !stack && (message === 'load failed' || message === 'fetch is aborted')) return true;
    if (message.includes('importing a module script failed')) return true;
    if (message.includes('unknown rejection') && stack.includes('webkit-masked-url://hidden/')) return true;
    if (feature === 'unhandledrejection' && stack.includes('webkit-masked-url://hidden/')) return true;
    if (feature === 'unhandledrejection' && /^error:\s*[a-z]{1,3}$/i.test(message)) return true;
    if (feature === 'unhandledrejection' && message.includes('object not found matching id:')) return true;
    if (feature === 'unhandledrejection' && message.includes('no listener: tabs:outgoing.message.ready')) return true;

    // Browser-injected snippets can throw "n0_ is not defined" from anonymous injFunc wrappers.
    // This does not originate from our application bundle and is not actionable.
    if (message.includes('n0_ is not defined') && stack.includes('at injfunc (<anonymous>')) return true;

    // Browser wallet/extension script failures are outside app control.
    if (joined.includes('failed to connect to metamask')) return true;
    if (joined.includes('chrome-extension://')) return true;
    if (joined.includes('moz-extension://')) return true;
    if (joined.includes('safari-web-extension://')) return true;
    if (joined.includes('chrome.runtime.lasterror')) return true;
    if (stack.includes('/scripts/inpage.js') && stack.includes('extension://')) return true;

    // Best-effort analytics/beacon calls can fail under blockers/offline/CORS and are not actionable.
    if (message.includes('failed to fetch') && stack.includes('postuserdata')) return true;
    if (feature === 'unhandledrejection' && message.includes('failed to fetch') && stack.includes('<anonymous>')) return true;

    return false;
}

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

function buildErrorReportPayload(err, context = {}) {
    const { message, stack } = normalizeError(err);
    const safeMessage = scrub(message).slice(0, 500);
    const safeStack = scrub(stack).slice(0, ERROR_REPORT_LIMITS.stackLength);
    const feature = scrub(context.feature || '');
    const safeUserNote = scrub(context.userNote || '').slice(0, 500);
    const appVersion = scrub(context.appVersion || window.APP_VERSION || '');

    return {
        action: 'error_report',
        app: 'freemergepdf',
        message: safeMessage || 'Unknown error',
        stack: safeStack,
        url: context.url || window.location.pathname || '',
        feature,
        userAgent: navigator?.userAgent || '',
        appVersion,
        userNote: safeUserNote
    };
}

/**
 * Append best-effort, non-identifying PDF structure metadata to the report's userNote.
 *
 * Callers opt in by passing `files` (a File/FileList/array) in the error context. The
 * files themselves NEVER leave the browser — only the structural facts listed in
 * pdf-metadata.js (version, size, page count, encrypted/linearized, object count,
 * AcroForm presence, producer/creator software names). File bytes, page text, images
 * and the /Title, /Author, /Subject and /Keywords info fields are deliberately never
 * read into the payload, because those carry real user data.
 *
 * This resolves rather than rejects under every failure mode: no extractor loaded, a
 * malformed PDF, a revoked file handle or a slow read all fall through to the original
 * payload. Reporting an error must never itself throw.
 */
function appendSafePdfMetadata(payload, context = {}) {
    try {
        const files = context.files;
        if (!files) return Promise.resolve(payload);
        const extractor = typeof window !== 'undefined' ? window.PdfSafeMetadata : null;
        if (!extractor || typeof extractor.collectSafePdfMetadata !== 'function') {
            return Promise.resolve(payload);
        }
        const list = (typeof files.length === 'number' && typeof files !== 'string') ? files : [files];

        return Promise.resolve(extractor.collectSafePdfMetadata(list))
            .then((metaList) => {
                const note = scrub(extractor.formatPdfMetadataNote(metaList) || '')
                    .slice(0, ERROR_REPORT_LIMITS.pdfMetaNoteLength);
                if (!note) return payload;
                payload.userNote = payload.userNote ? `${payload.userNote};${note}` : note;
                return payload;
            })
            .catch(() => payload);
    } catch (_) {
        return Promise.resolve(payload);
    }
}

function submitErrorReportToAppsScript(payload) {
    if (!ERROR_APPS_SCRIPT_ENDPOINT) return Promise.reject(new Error('Missing error endpoint'));

    return fetch(ERROR_APPS_SCRIPT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    }).then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.ok === false) {
            throw new Error(json.error || `Error endpoint returned ${res.status}`);
        }
        return { ok: true, target: 'apps-script' };
    });
}

function submitErrorReportToGoogleForm(payload) {
    const endpoint = `https://docs.google.com/forms/d/e/${ERROR_FORM.formId}/formResponse`;
    const formData = new FormData();
    formData.append(ERROR_FORM.fields.message, payload.message);
    if (payload.stack) formData.append(ERROR_FORM.fields.stack, payload.stack);
    formData.append(ERROR_FORM.fields.url, payload.url);
    if (payload.feature) formData.append(ERROR_FORM.fields.feature, payload.feature);
    if (payload.userAgent) formData.append(ERROR_FORM.fields.userAgent, payload.userAgent);
    if (payload.appVersion) formData.append(ERROR_FORM.fields.appVersion, payload.appVersion);
    if (payload.userNote) formData.append(ERROR_FORM.fields.userNote, payload.userNote);

    return fetch(endpoint, {
        method: 'POST',
        body: formData,
        mode: 'no-cors'
    }).then(() => ({ ok: true, target: 'google-form-fallback' }));
}

function sendErrorReport(err, context = {}) {
    try {
        if (shouldIgnoreKnownNoise(err, context)) return Promise.resolve({ ok: true, ignored: true });

        const payload = buildErrorReportPayload(err, context);
        const now = Date.now();
        const fp = fingerprint(payload.message, payload.feature, payload.userNote.slice(0, 120));
        if (fp === lastErrorFingerprint && now - lastErrorAt < ERROR_REPORT_LIMITS.throttleMs) {
            return Promise.resolve({ ok: true, throttled: true });
        }
        lastErrorFingerprint = fp;
        lastErrorAt = now;

        return appendSafePdfMetadata(payload, context)
            .then((finalPayload) => submitErrorReportToAppsScript(finalPayload)
                .catch(() => submitErrorReportToGoogleForm(finalPayload)))
            .catch((reportErr) => {
                console.warn('Error reporter failed', reportErr);
                return { ok: false, error: String(reportErr) };
            });
    } catch (reportErr) {
        console.warn('Error reporter failed', reportErr);
        return Promise.resolve({ ok: false, error: String(reportErr) });
    }
}

window.reportError = sendErrorReport;

// Exposed for the Playwright harness in tests/ so the payload can be asserted
// without posting anything to the reporting backend.
window.__errorReportingInternals = {
    buildErrorReportPayload,
    appendSafePdfMetadata
};

window.addEventListener('error', (event) => {
    // Cross-origin script failures are reported by browsers as "Script error."
    // with no actionable stack. Skip to reduce noise.
    if ((event?.message || '').trim().toLowerCase() === 'script error.') {
        return;
    }
    if (event?.filename && !isSameOriginUrl(event.filename)) {
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
