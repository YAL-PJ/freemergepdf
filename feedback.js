// ===== FEEDBACK WIDGET CONFIG =====
const FEEDBACK_CONFIG = {
    formId: '1FAIpQLSc00uL8Gz8wu6swd9oqTerLE-Nh-MUTlD35X_whxqF9D5uPcg',
    emailFieldId: 'entry.158214733',
    messageFieldId: 'entry.1937424023'
};

function setupFeedbackWidget() {
    const feedbackButton = document.getElementById('feedbackButton');
    const feedbackCloseBtn = document.getElementById('feedbackCloseBtn');
    const feedbackOverlay = document.getElementById('feedbackOverlay');
    const feedbackSidebar = document.getElementById('feedbackSidebar');
    const feedbackForm = document.getElementById('feedbackForm');
    const feedbackFormBottom = document.getElementById('feedbackFormBottom');

    // On initial page load, sidebar is open - add the body class immediately
    document.body.classList.add('feedback-open');

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

    if (feedbackForm) {
        feedbackForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitFeedback('sidebar');
        });
    }

    // BOTTOM FORM (narrow screens)
    if (feedbackFormBottom) {
        feedbackFormBottom.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitFeedback('bottom');
        });
    }
}

async function submitFeedback(source) {
    const isSidebar = source === 'sidebar';
    
    const emailInput = isSidebar ? document.getElementById('feedbackEmail') : document.getElementById('feedbackEmailBottom');
    const messageInput = isSidebar ? document.getElementById('feedbackMessage') : document.getElementById('feedbackMessageBottom');
    const sendBtn = isSidebar ? document.getElementById('feedbackSendBtn') : document.getElementById('feedbackSendBtnBottom');
    const errorEl = isSidebar ? document.getElementById('feedbackError') : document.getElementById('feedbackErrorBottom');
    const successEl = isSidebar ? document.getElementById('feedbackSuccess') : document.getElementById('feedbackSuccessBottom');

    const email = emailInput.value.trim();
    const message = messageInput.value.trim();

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
        messageInput.value = '';

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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', setupFeedbackWidget);
