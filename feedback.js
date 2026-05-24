// ===== FEEDBACK WIDGET CONFIG =====
// After deploying google-apps-script/feedback-backend.gs, paste the Web app URL below.
const FEEDBACK_ENDPOINT = '';
const APP_ID = 'freemergepdf';
const OWNER_NAME = 'Yanis (creator)';

let feedbackExpanded = false;
let lastLoadedHistory = [];

function setupFeedbackWidget() {
    const feedbackButton = document.getElementById('feedbackButton');
    const feedbackCloseBtn = document.getElementById('feedbackCloseBtn');
    const feedbackOverlay = document.getElementById('feedbackOverlay');
    const feedbackSidebar = document.getElementById('feedbackSidebar');
    const feedbackResizeHandle = document.getElementById('feedbackResizeHandle');
    const feedbackForm = document.getElementById('feedbackForm');
    const feedbackFormBottom = document.querySelector('form#feedbackFormBottom') || document.getElementById('feedbackFormBottom');
    const messageInput = document.getElementById('feedbackMessage');
    const messageInputBottom = document.getElementById('feedbackMessageBottom');
    const showToggle = document.getElementById('feedbackShowToggle');
    const showToggleBottom = document.getElementById('feedbackShowToggleBottom');

    if (feedbackButton && feedbackSidebar && feedbackOverlay) {
        feedbackButton.addEventListener('click', () => {
            feedbackSidebar.classList.toggle('closed');
            feedbackOverlay.classList.toggle('show');
            document.body.classList.toggle('feedback-open');
        });
    }
    if (feedbackCloseBtn && feedbackSidebar && feedbackOverlay) {
        feedbackCloseBtn.addEventListener('click', () => {
            feedbackSidebar.classList.add('closed');
            feedbackOverlay.classList.remove('show');
            document.body.classList.remove('feedback-open');
        });
    }
    if (feedbackOverlay) {
        feedbackOverlay.addEventListener('click', () => {
            feedbackSidebar && feedbackSidebar.classList.add('closed');
            feedbackOverlay.classList.remove('show');
            document.body.classList.remove('feedback-open');
        });
    }
    setupSidebarResize(feedbackSidebar, feedbackResizeHandle);

    if (showToggle) showToggle.addEventListener('click', () => { feedbackExpanded = !feedbackExpanded; renderFeedbackHistory(lastLoadedHistory); });
    if (showToggleBottom) showToggleBottom.addEventListener('click', () => { feedbackExpanded = !feedbackExpanded; renderFeedbackHistory(lastLoadedHistory); });

    if (feedbackForm) {
        feedbackForm.addEventListener('submit', (e) => { e.preventDefault(); submitFeedback('sidebar'); });
        addCtrlEnterSubmit(messageInput, feedbackForm);
    }
    if (feedbackFormBottom && feedbackFormBottom.tagName === 'FORM') {
        feedbackFormBottom.addEventListener('submit', (e) => { e.preventDefault(); submitFeedback('bottom'); });
        addCtrlEnterSubmit(messageInputBottom, feedbackFormBottom);
    }

    fetchFeedback();
}

async function submitFeedback(source) {
    const isSidebar = source === 'sidebar';
    const emailInput = document.getElementById(isSidebar ? 'feedbackEmail' : 'feedbackEmailBottom');
    const userNameInput = document.getElementById(isSidebar ? 'feedbackUserName' : 'feedbackUserNameBottom');
    const messageInput = document.getElementById(isSidebar ? 'feedbackMessage' : 'feedbackMessageBottom');
    const privateInput = document.getElementById(isSidebar ? 'feedbackPrivate' : 'feedbackPrivateBottom');
    const honeypotInput = document.getElementById(isSidebar ? 'feedbackWebsite' : 'feedbackWebsiteBottom');
    const sendBtn = document.getElementById(isSidebar ? 'feedbackSendBtn' : 'feedbackSendBtnBottom');
    const errorEl = document.getElementById(isSidebar ? 'feedbackError' : 'feedbackErrorBottom');
    const successEl = document.getElementById(isSidebar ? 'feedbackSuccess' : 'feedbackSuccessBottom');

    if (sendBtn && sendBtn.disabled) return;
    if (honeypotInput && honeypotInput.value && honeypotInput.value.trim()) return;

    const email = (emailInput && emailInput.value || '').trim();
    const userName = (userNameInput && userNameInput.value || '').trim();
    const message = (messageInput && messageInput.value || '').trim();
    const isPrivate = !!(privateInput && privateInput.checked);

    errorEl && errorEl.classList.remove('show');
    successEl && successEl.classList.remove('show');

    if (!email || !message) return showError('Please fill in email and message', source);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Please enter a valid email', source);
    if (message.length < 5) return showError('Please write at least 5 characters', source);
    if (!FEEDBACK_ENDPOINT) return showError('Feedback endpoint not configured yet', source);

    if (sendBtn) { sendBtn.disabled = true; sendBtn.classList.add('loading'); sendBtn.textContent = 'Sending...'; }

    try {
        const res = await fetch(FEEDBACK_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ app: APP_ID, name: userName, email, message, isPrivate })
        });
        const json = await res.json().catch(() => ({}));
        if (json && json.ok === false) throw new Error(json.error || 'submit failed');

        successEl && successEl.classList.add('show');
        if (emailInput) emailInput.value = '';
        if (userNameInput) userNameInput.value = '';
        if (messageInput) messageInput.value = '';
        if (privateInput) privateInput.checked = false;

        refreshFeedbackListAfterSubmit();

        if (typeof gtag !== 'undefined') {
            gtag('event', 'feedback_submitted', { source, email_provided: true, message_length: message.length });
        }
        if (isSidebar) {
            setTimeout(() => {
                const sb = document.getElementById('feedbackSidebar');
                const ov = document.getElementById('feedbackOverlay');
                sb && sb.classList.add('closed');
                ov && ov.classList.remove('show');
                document.body.classList.remove('feedback-open');
            }, 2500);
        }
    } catch (err) {
        console.error('Feedback submission error', err);
        showError('Failed to send feedback. Please try again.', source);
    } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('loading'); sendBtn.textContent = 'Send Feedback'; }
    }
}

function showError(message, source) {
    const isSidebar = source === 'sidebar';
    const errorEl = document.getElementById(isSidebar ? 'feedbackError' : 'feedbackErrorBottom');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.add('show');
    setTimeout(() => errorEl.classList.remove('show'), 4000);
}

function refreshFeedbackListAfterSubmit() {
    setTimeout(fetchFeedback, 1500);
    setTimeout(fetchFeedback, 5000);
}

async function fetchFeedback() {
    if (!FEEDBACK_ENDPOINT) { renderFeedbackHistory([], true); return; }
    try {
        const res = await fetch(`${FEEDBACK_ENDPOINT}?app=${encodeURIComponent(APP_ID)}`, { cache: 'no-store' });
        const items = await res.json();
        lastLoadedHistory = Array.isArray(items) ? items : [];
        renderFeedbackHistory(lastLoadedHistory);
    } catch (err) {
        console.warn('Unable to load feedback', err);
        renderFeedbackHistory([], true);
    }
}

function renderFeedbackHistory(history, hadError = false) {
    const visible = (history || []).filter(e => e && e.message).slice().sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
    });
    const limit = feedbackExpanded ? visible.length : 2;
    const slice = visible.slice(0, limit);
    const hiddenCount = Math.max(0, visible.length - slice.length);

    const targets = [
        { listEl: document.getElementById('feedbackHistoryList'), emptyEl: document.getElementById('feedbackHistoryEmpty'), toggleEl: document.getElementById('feedbackShowToggle') },
        { listEl: document.getElementById('feedbackHistoryListBottom'), emptyEl: document.getElementById('feedbackHistoryEmptyBottom'), toggleEl: document.getElementById('feedbackShowToggleBottom') }
    ];

    targets.forEach(({ listEl, emptyEl, toggleEl }) => {
        if (!listEl || !emptyEl) return;
        listEl.innerHTML = '';
        if (!visible.length) {
            emptyEl.style.display = 'block';
            emptyEl.textContent = hadError ? 'Unable to load feedback right now.' : 'No feedback yet. Share your first note!';
            listEl.style.display = 'none';
            if (toggleEl) toggleEl.style.display = 'none';
            return;
        }
        emptyEl.style.display = 'none';
        listEl.style.display = 'flex';
        slice.forEach(entry => listEl.appendChild(renderEntry(entry)));
        if (toggleEl) {
            const showToggle = hiddenCount > 0 || feedbackExpanded;
            toggleEl.style.display = showToggle ? 'block' : 'none';
            toggleEl.textContent = feedbackExpanded ? 'Show less' : `Show ${hiddenCount} more`;
        }
    });
}

function renderEntry(entry) {
    const item = document.createElement('li');
    item.className = 'feedback-history-item';

    const messageEl = document.createElement('div');
    messageEl.className = 'feedback-history-message';
    messageEl.textContent = entry.message;
    item.appendChild(messageEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'feedback-history-meta';
    metaEl.textContent = formatMeta(entry);
    item.appendChild(metaEl);

    if (entry.ownerReply) {
        const reply = document.createElement('div');
        reply.className = 'feedback-history-owner-reply';
        const tag = document.createElement('span');
        tag.className = 'feedback-history-owner-tag';
        tag.textContent = 'Reply from ' + OWNER_NAME;
        const body = document.createElement('div');
        body.className = 'feedback-history-owner-body';
        body.textContent = entry.ownerReply;
        reply.appendChild(tag);
        reply.appendChild(body);
        item.appendChild(reply);
    }
    return item;
}

function formatMeta(entry) {
    const parsed = entry.timestamp ? new Date(entry.timestamp) : null;
    const date = parsed && !isNaN(parsed.getTime())
        ? parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
    const name = entry.name && entry.name.trim() ? entry.name.trim() : 'Someone';
    return [name, date].filter(Boolean).join(' • ');
}

function setupSidebarResize(sidebar, handle) {
    if (!sidebar || !handle) return;
    const root = document.documentElement;
    const minWidth = 260;
    const maxWidth = 520;
    const setSidebarWidth = (w) => {
        const clamped = Math.min(maxWidth, Math.max(minWidth, w));
        root.style.setProperty('--feedback-sidebar-width', `${clamped}px`);
    };
    const existing = parseInt(getComputedStyle(root).getPropertyValue('--feedback-sidebar-width'), 10);
    if (Number.isFinite(existing) && existing > 0) setSidebarWidth(existing);
    else setSidebarWidth(sidebar.getBoundingClientRect().width);

    let dragging = false;
    const onMouseMove = (e) => {
        if (!dragging) return;
        const rect = sidebar.getBoundingClientRect();
        setSidebarWidth(e.clientX - rect.left);
    };
    const stopDrag = () => {
        dragging = false;
        handle.classList.remove('active');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', stopDrag);
    };
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        handle.classList.add('active');
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', stopDrag);
    });
}

function addCtrlEnterSubmit(textarea, form) {
    if (!textarea || !form) return;
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
    });
}

document.addEventListener('DOMContentLoaded', setupFeedbackWidget);
