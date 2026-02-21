// ===== FEEDBACK WIDGET CONFIG =====
const FEEDBACK_CONFIG = {
    formId: '1FAIpQLSc00uL8Gz8wu6swd9oqTerLE-Nh-MUTlD35X_whxqF9D5uPcg',
    emailFieldId: 'entry.158214733',
    messageFieldId: 'entry.1937424023',
    userNameFieldId: 'entry.35381629',
    privateFieldId: 'entry.1220259167',
    parentIdFieldId: 'entry.541827047'
};

// Publicly published CSV of form responses (read-only)
const FEEDBACK_PUBLIC_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYkc_ORMeBD68CZErjqvblL73Ph4wuwGlDyP9kyidZpTEUyTGMhJkWehM4S-W3lNtht7nClqozYt1x/pub?gid=1596363765&single=true&output=csv';
let feedbackExpanded = false;
const replyExpandedMap = new Map();

function setupFeedbackWidget() {
    const feedbackButton = document.getElementById('feedbackButton');
    const feedbackCloseBtn = document.getElementById('feedbackCloseBtn');
    const feedbackOverlay = document.getElementById('feedbackOverlay');
    const feedbackSidebar = document.getElementById('feedbackSidebar');
    const feedbackResizeHandle = document.getElementById('feedbackResizeHandle');
    const feedbackForm = document.getElementById('feedbackForm');
    const feedbackFormBottom = document.getElementById('feedbackFormBottom');
    const messageInput = document.getElementById('feedbackMessage');
    const messageInputBottom = document.getElementById('feedbackMessageBottom');
    const showToggle = document.getElementById('feedbackShowToggle');
    const showToggleBottom = document.getElementById('feedbackShowToggleBottom');

    // Keep sidebar closed by default to avoid layout shift on load.

    // SIDEBAR FORM (wide screens)
    if (feedbackButton) {
        feedbackButton.addEventListener('click', () => {
            feedbackSidebar.classList.toggle('closed');
            feedbackOverlay.classList.toggle('show');
            document.body.classList.toggle('feedback-open');
        });
    }

    if (feedbackCloseBtn) {
        feedbackCloseBtn.addEventListener('click', () => {
            feedbackSidebar.classList.add('closed');
            feedbackOverlay.classList.remove('show');
            document.body.classList.remove('feedback-open');
        });
    }

    if (feedbackOverlay) {
        feedbackOverlay.addEventListener('click', () => {
            feedbackSidebar.classList.add('closed');
            feedbackOverlay.classList.remove('show');
            document.body.classList.remove('feedback-open');
        });
    }

    setupSidebarResize(feedbackSidebar, feedbackResizeHandle);

    if (showToggle) {
        showToggle.addEventListener('click', () => {
            feedbackExpanded = !feedbackExpanded;
            renderFeedbackHistory(lastLoadedHistory || []);
        });
    }

    if (showToggleBottom) {
        showToggleBottom.addEventListener('click', () => {
            feedbackExpanded = !feedbackExpanded;
            renderFeedbackHistory(lastLoadedHistory || []);
        });
    }

    if (feedbackForm) {
        feedbackForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitFeedback('sidebar');
        });
        addCtrlEnterSubmit(messageInput, feedbackForm);
    }

    // BOTTOM FORM (narrow screens)
    if (feedbackFormBottom) {
        feedbackFormBottom.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitFeedback('bottom');
        });
        addCtrlEnterSubmit(messageInputBottom, feedbackFormBottom);
    }

    fetchPublicFeedback();
}

async function submitFeedback(source) {
    const isSidebar = source === 'sidebar';
    
    const emailInput = isSidebar ? document.getElementById('feedbackEmail') : document.getElementById('feedbackEmailBottom');
    const userNameInput = isSidebar ? document.getElementById('feedbackUserName') : document.getElementById('feedbackUserNameBottom');
    const messageInput = isSidebar ? document.getElementById('feedbackMessage') : document.getElementById('feedbackMessageBottom');
    const privateInput = isSidebar ? document.getElementById('feedbackPrivate') : document.getElementById('feedbackPrivateBottom');
    const sendBtn = isSidebar ? document.getElementById('feedbackSendBtn') : document.getElementById('feedbackSendBtnBottom');
    const errorEl = isSidebar ? document.getElementById('feedbackError') : document.getElementById('feedbackErrorBottom');
    const successEl = isSidebar ? document.getElementById('feedbackSuccess') : document.getElementById('feedbackSuccessBottom');

    if (sendBtn?.disabled) return;

    const email = emailInput.value.trim();
    const userName = userNameInput.value.trim();
    const message = messageInput.value.trim();
    const isPrivate = privateInput.checked;

    // Clear previous messages
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    // Validation
    if (!email || !message) {
        showFeedbackError('Please fill in all fields', source);
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showFeedbackError('Please enter a valid email', source);
        return;
    }

    if (message.length < 5) {
        showFeedbackError('Please write at least 5 characters', source);
        return;
    }

    // Disable button and show loading
    sendBtn.disabled = true;
    sendBtn.classList.add('loading');
    sendBtn.textContent = 'Sending...';

    try {
        // Create form data for Google Forms
        const formData = new FormData();
        formData.append(FEEDBACK_CONFIG.emailFieldId, email);
        formData.append(FEEDBACK_CONFIG.messageFieldId, message);
        if (userName) {
            formData.append(FEEDBACK_CONFIG.userNameFieldId, userName);
        }
        if (isPrivate) {
            formData.append(FEEDBACK_CONFIG.privateFieldId, 'Private Feedback');
        }

        // Submit to Google Form
        const response = await fetch(
            `https://docs.google.com/forms/d/e/${FEEDBACK_CONFIG.formId}/formResponse`,
            {
                method: 'POST',
                body: formData,
                mode: 'no-cors'
            }
        );

        // Show success message
        successEl.classList.add('show');
        
        // Clear form
        emailInput.value = '';
        userNameInput.value = '';
        messageInput.value = '';
        privateInput.checked = false;

        refreshFeedbackListAfterSubmit();

        // Track in Google Analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'feedback_submitted', {
                'source': source,
                'email': email.split('@')[0], // Only track domain for privacy
                'message_length': message.length
            });
        }

        // Close sidebar if on sidebar version
        if (isSidebar) {
            setTimeout(() => {
                document.getElementById('feedbackSidebar').classList.add('closed');
                document.getElementById('feedbackOverlay').classList.remove('show');
                document.body.classList.remove('feedback-open');
            }, 3000);
        }

    } catch (error) {
        console.error('Feedback submission error:', error);
        showFeedbackError('Failed to send feedback. Please try again.', source);
    } finally {
        sendBtn.disabled = false;
        sendBtn.classList.remove('loading');
        sendBtn.textContent = 'Send Feedback';
    }
}

function showFeedbackError(message, source) {
    const isSidebar = source === 'sidebar';
    const errorEl = isSidebar ? document.getElementById('feedbackError') : document.getElementById('feedbackErrorBottom');
    errorEl.textContent = message;
    errorEl.classList.add('show');
    setTimeout(() => errorEl.classList.remove('show'), 4000);
}

function refreshFeedbackListAfterSubmit() {
    // Google Forms can take a moment to publish to the sheet; refresh a couple of times
    setTimeout(fetchPublicFeedback, 2000);
    setTimeout(fetchPublicFeedback, 7000);
}

async function fetchPublicFeedback() {
    try {
        const res = await fetch(FEEDBACK_PUBLIC_CSV_URL, { cache: 'no-store' });
        const text = await res.text();
        const parsed = transformFeedbackCsv(text);
        lastLoadedHistory = parsed;
        renderFeedbackHistory(parsed);
    } catch (err) {
        console.warn('Unable to load public feedback', err);
        renderFeedbackHistory([], true);
    }
}

function transformFeedbackCsv(csvText) {
    const rows = parseCsv(csvText);
    if (rows.length <= 1) return [];

    // Skip header row
    return rows.slice(1)
        .map((row, idx) => {
            const [timestamp, email, message, userName, privateFlag, parentId] = row;
            const parsedDate = parseTimestamp(timestamp);
            return {
                timestamp,
                email,
                message,
                userName,
                privateFlag,
                parentId,
                parsedDate,
                derivedId: String(idx + 2) // sheet row number (data starts at row 2)
            };
        })
        .filter((entry) => entry.message && entry.message.trim() && !isPrivateEntry(entry));
}

// Basic CSV parser that handles quoted fields
function parseCsv(text) {
    const rows = [];
    let current = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"' && inQuotes && nextChar === '"') {
            value += '"';
            i++; // skip escaped quote
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            current.push(value);
            value = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (value !== '' || current.length) {
                current.push(value);
                rows.push(current);
                current = [];
                value = '';
            }
        } else {
            value += char;
        }
    }

    if (value !== '' || current.length) {
        current.push(value);
        rows.push(current);
    }

    return rows;
}

function formatFeedbackMeta(entry) {
    const parsedDate = parseTimestamp(entry.timestamp);
    const dateText = parsedDate ? parsedDate.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }) : (entry.timestamp || 'Date unavailable');
    const namePart = entry.userName && entry.userName.trim() ? entry.userName.trim() : maskEmail(entry.email || '');
    return namePart ? `${namePart} • ${dateText}` : dateText;
}

function maskEmail(email) {
    if (!email || !email.includes('@')) return email || '';
    const [user, domain] = email.split('@');
    const safeUser = user.length <= 2 ? user : `${user.slice(0, 2)}***`;
    return `${safeUser}@${domain}`;
}

function isPrivateEntry(entry) {
    if (!entry || entry.privateFlag == null) return false;
    const val = String(entry.privateFlag).trim().toLowerCase();
    return val === 'private feedback' || val === 'yes' || val === 'true';
}

function renderFeedbackHistory(history, hadError = false) {
    const ordered = orderEntries(history);
    const threads = buildThreads(ordered);
    const showAll = feedbackExpanded;
    const targets = [
        {
            listEl: document.getElementById('feedbackHistoryList'),
            emptyEl: document.getElementById('feedbackHistoryEmpty'),
            toggleEl: document.getElementById('feedbackShowToggle')
        },
        {
            listEl: document.getElementById('feedbackHistoryListBottom'),
            emptyEl: document.getElementById('feedbackHistoryEmptyBottom'),
            toggleEl: document.getElementById('feedbackShowToggleBottom')
        }
    ];

    const visibleRoots = showAll ? threads.roots : threads.roots.slice(0, 2);
    const hasMore = threads.roots.length > visibleRoots.length;

    targets.forEach(({ listEl, emptyEl, toggleEl }) => {
        if (!listEl || !emptyEl) return;

        listEl.innerHTML = '';

        if (!threads.roots.length) {
            emptyEl.style.display = 'block';
            emptyEl.textContent = hadError ? 'Unable to load feedback right now.' : 'No feedback yet. Share your first note!';
            listEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        listEl.style.display = 'flex';

        visibleRoots.forEach((entry) => {
            const item = renderThreadEntry(entry, threads.repliesByParent, threads.keyForEntry, false);
            listEl.appendChild(item);
        });

        if (toggleEl) {
            toggleEl.style.display = hasMore ? 'block' : 'none';
            toggleEl.textContent = showAll ? 'Show less' : 'Show more';
        }
    });
}

function parseTimestamp(value) {
    if (!value) return null;
    const trimmed = String(value).trim();

    // Match formats like 30/11/2025 13:07:48
    const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
        const [, dd, mm, yyyy, hh, min, ss] = match;
        const d = new Date(
            Number(yyyy),
            Number(mm) - 1,
            Number(dd),
            Number(hh),
            Number(min),
            ss ? Number(ss) : 0
        );
        return isNaN(d.getTime()) ? null : d;
    }

    const fallback = new Date(trimmed);
    return isNaN(fallback.getTime()) ? null : fallback;
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

    // Initialize from current width if no variable set
    const existing = parseInt(getComputedStyle(root).getPropertyValue('--feedback-sidebar-width'), 10);
    if (Number.isFinite(existing) && existing > 0) {
        setSidebarWidth(existing);
    } else {
        setSidebarWidth(sidebar.getBoundingClientRect().width);
    }

    let dragging = false;

    const onMouseMove = (e) => {
        if (!dragging) return;
        const rect = sidebar.getBoundingClientRect();
        const newWidth = e.clientX - rect.left;
        setSidebarWidth(newWidth);
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
            triggerFormSubmit(form);
        }
    });
}

function triggerFormSubmit(form) {
    if (!form) return;
    if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
    } else {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
}

function normalizeKey(val) {
    return String(val || '').trim();
}

function getEntryKey(entry) {
    // Prefer derived row id, otherwise timestamp
    return normalizeKey(entry.derivedId || entry.timestamp || '');
}

function orderEntries(entries) {
    return entries.slice().sort((a, b) => {
        const ta = a.parsedDate ? a.parsedDate.getTime() : 0;
        const tb = b.parsedDate ? b.parsedDate.getTime() : 0;
        return tb - ta;
    });
}

function buildThreads(entries) {
    const repliesByParent = {};
    const roots = [];
    const keyForEntry = (entry) => getEntryKey(entry);
    const normalizeParent = (pid) => normalizeKey(pid);

    entries.forEach((entry) => {
        const pid = normalizeParent(entry.parentId);
        if (pid) {
            if (!repliesByParent[pid]) repliesByParent[pid] = [];
            repliesByParent[pid].push(entry);
        } else {
            roots.push(entry);
        }
    });

    return { roots, repliesByParent, keyForEntry };
}

function renderThreadEntry(entry, repliesByParent, keyForEntry, forceShowAllReplies) {
    const item = document.createElement('li');
    item.className = 'feedback-history-item';

    const messageEl = document.createElement('div');
    messageEl.className = 'feedback-history-message';
    messageEl.textContent = entry.message;

    const metaEl = document.createElement('div');
    metaEl.className = 'feedback-history-meta';
    metaEl.textContent = formatFeedbackMeta(entry);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'feedback-actions';
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'feedback-reply-btn';
    replyBtn.textContent = 'Reply';
    actionsEl.appendChild(replyBtn);

    const replyForm = createReplyForm(entry);
    replyBtn.addEventListener('click', () => {
        replyForm.style.display = replyForm.style.display === 'flex' ? 'none' : 'flex';
    });

    item.appendChild(messageEl);
    item.appendChild(metaEl);
    item.appendChild(actionsEl);
    item.appendChild(replyForm);

    const entryKey = keyForEntry(entry);
    const replies = entryKey ? repliesByParent[entryKey] || [] : [];
    const expandState = replyExpandedMap.get(entryKey) || false;
    const showReplies = forceShowAllReplies || expandState ? replies : replies.slice(0, 1);

    if (entryKey && showReplies.length) {
        const repliesWrapper = document.createElement('div');
        repliesWrapper.className = 'feedback-replies';
        showReplies.forEach((reply) => {
            const replyItem = renderThreadEntry(reply, repliesByParent, keyForEntry, forceShowAllReplies);
            repliesWrapper.appendChild(replyItem);
        });
        item.appendChild(repliesWrapper);

        if (replies.length > showReplies.length && !forceShowAllReplies) {
            const repliesToggle = document.createElement('button');
            repliesToggle.type = 'button';
            repliesToggle.className = 'feedback-replies-toggle';
            repliesToggle.textContent = expandState ? 'Hide replies' : `View ${replies.length - showReplies.length} more replies`;
            repliesToggle.addEventListener('click', () => {
                replyExpandedMap.set(entryKey, !expandState);
                renderFeedbackHistory(lastLoadedHistory || []);
            });
            item.appendChild(repliesToggle);
        }
    }

    return item;
}

function createReplyForm(parentEntry) {
    const form = document.createElement('form');
    form.className = 'feedback-reply-form';
    const replyKey = String(parentEntry?.id || parentEntry?.createdAt || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');

    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.id = `replyEmail_${replyKey}`;
    emailInput.name = 'replyEmail';
    emailInput.placeholder = 'your@email.com';
    emailInput.className = 'feedback-input';
    emailInput.setAttribute('aria-label', 'Reply email');

    const userNameInput = document.createElement('input');
    userNameInput.type = 'text';
    userNameInput.id = `replyUserName_${replyKey}`;
    userNameInput.name = 'replyUserName';
    userNameInput.placeholder = 'Your name (optional)';
    userNameInput.className = 'feedback-input';
    userNameInput.setAttribute('aria-label', 'Reply user name');

    const messageInput = document.createElement('textarea');
    messageInput.id = `replyMessage_${replyKey}`;
    messageInput.name = 'replyMessage';
    messageInput.className = 'feedback-input feedback-textarea';
    messageInput.placeholder = 'Reply...';
    messageInput.setAttribute('aria-label', 'Reply message');

    const privateLabel = document.createElement('label');
    privateLabel.className = 'feedback-toggle';
    const privateInput = document.createElement('input');
    privateInput.type = 'checkbox';
    privateInput.id = `replyPrivate_${replyKey}`;
    privateInput.name = 'replyPrivate';
    privateInput.setAttribute('aria-label', 'Make this reply private');
    const privateSpan = document.createElement('span');
    privateSpan.textContent = 'Make this reply private';
    privateLabel.appendChild(privateInput);
    privateLabel.appendChild(privateSpan);

    const statusEl = document.createElement('div');
    statusEl.className = 'feedback-reply-status';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'feedback-reply-send';
    submitBtn.textContent = 'Reply';

    addCtrlEnterSubmit(messageInput, form);

    form.appendChild(emailInput);
    form.appendChild(userNameInput);
    form.appendChild(messageInput);
    form.appendChild(submitBtn);
    form.appendChild(privateLabel);
    form.appendChild(statusEl);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitReply({
            parentEntry,
            emailInput,
            userNameInput,
            messageInput,
            privateInput,
            statusEl,
            submitBtn
        });
    });

    return form;
}

async function submitReply({ parentEntry, emailInput, userNameInput, messageInput, privateInput, statusEl, submitBtn }) {
    const email = emailInput.value.trim();
    const userName = userNameInput.value.trim();
    const message = messageInput.value.trim();
    const isPrivate = privateInput.checked;
    const parentId = getEntryKey(parentEntry);

    if (submitBtn?.disabled) return;

    statusEl.textContent = '';
    statusEl.className = 'feedback-reply-status';

    if (!email || !message) {
        statusEl.textContent = 'Please enter email and message';
        statusEl.classList.add('error');
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        statusEl.textContent = 'Please enter a valid email';
        statusEl.classList.add('error');
        return;
    }
    if (!parentId) {
        statusEl.textContent = 'Unable to link reply to parent.';
        statusEl.classList.add('error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    submitBtn.textContent = 'Sending...';
    statusEl.textContent = '';
    statusEl.classList.remove('error');

    try {
        const formData = new FormData();
        formData.append(FEEDBACK_CONFIG.emailFieldId, email);
        formData.append(FEEDBACK_CONFIG.messageFieldId, message);
        formData.append(FEEDBACK_CONFIG.parentIdFieldId, parentId);
        if (userName) formData.append(FEEDBACK_CONFIG.userNameFieldId, userName);
        if (isPrivate) formData.append(FEEDBACK_CONFIG.privateFieldId, 'Private Feedback');

        await fetch(`https://docs.google.com/forms/d/e/${FEEDBACK_CONFIG.formId}/formResponse`, {
            method: 'POST',
            body: formData,
            mode: 'no-cors'
        });

        if (typeof gtag !== 'undefined') {
            gtag('event', 'feedback_reply_submitted', {
                parent_id: parentId,
                email: email.split('@')[0],
                message_length: message.length
            });
        }

        emailInput.value = '';
        userNameInput.value = '';
        messageInput.value = '';
        privateInput.checked = false;
        statusEl.textContent = 'Reply sent!';
        statusEl.classList.add('success');
        refreshFeedbackListAfterSubmit();
    } catch (err) {
        console.error('Reply submission error', err);
        statusEl.textContent = 'Failed to send reply. Please try again.';
        statusEl.classList.add('error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitBtn.textContent = 'Reply';
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', setupFeedbackWidget);
