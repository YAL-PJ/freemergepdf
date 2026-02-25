const MEMORY_WARNING_THRESHOLD = 300 * 1024 * 1024; // 300MB total
        const DEVICE_MEMORY_GB = (typeof navigator !== 'undefined' && Number.isFinite(Number(navigator.deviceMemory)))
            ? Number(navigator.deviceMemory)
            : 0;
        const MERGE_HARD_LIMIT_BYTES = DEVICE_MEMORY_GB <= 2
            ? 250 * 1024 * 1024
            : DEVICE_MEMORY_GB <= 4
                ? 400 * 1024 * 1024
                : DEVICE_MEMORY_GB <= 8
                    ? 700 * 1024 * 1024
                    : DEVICE_MEMORY_GB > 8
                        ? 1000 * 1024 * 1024
                        : 700 * 1024 * 1024;
        let expandedFiles = []; // Store file objects for expanded mode
        let advancedMerger = null; // Advanced merger instance
        let advancedMergerPrewarmKey = '';
        let advancedMergerPrewarmPromise = null;
        let advancedPageCountListenerAttached = false;
        let mergeInProgress = false;
        const encryptedWarningShown = { simple: false, expanded: false };
        const encryptionScanResults = new WeakMap();
        const fileIssues = new WeakMap();
        let advancedMergerFiles = [];
        let advancedFileErrorShown = false;
        const simpleSelectedFiles = { file1: null, file2: null };
        const ENCRYPTION_SCAN_BYTES = 65536;

        // ===== MODE TOGGLE =====
        function toggleMode() {
            const simpleMode = document.getElementById('simpleMode');
            const expandedMode = document.getElementById('expandedMode');

            simpleMode.classList.toggle('hidden');
            expandedMode.classList.toggle('active');

            if (expandedMode.classList.contains('active')) {
                // Clear expanded mode files when switching
                expandedFiles = [];
                encryptedWarningShown.expanded = false;
                document.getElementById('pdfList').innerHTML = '';
                updateDocCount();
                updateExpandedMergeButton();
                advancedMergerPrewarmKey = '';
                if (advancedMerger) {
                    advancedMerger.destroy();
                    advancedMerger = null;
                }
                // Page count display reset
                const pageCountEl = document.getElementById('pageCount');
                if (pageCountEl) pageCountEl.textContent = '0';
            }
        }

        // ===== SIMPLE MODE - FILE HANDLING =====
        function setupSimpleFileInputs() {
            const file1Input = document.getElementById('file1');
            const file2Input = document.getElementById('file2');
            const display1 = document.getElementById('display1');
            const display2 = document.getElementById('display2');

            [file1Input, file2Input].forEach((input, index) => {
                const display = index === 0 ? display1 : display2;
                const displayId = index === 0 ? 'display1' : 'display2';

                input.addEventListener('change', async (e) => {
                    const selectedFile = e.target.files[0];
                    if (!selectedFile) {
                        const cachedFile = simpleSelectedFiles[input.id];
                        if (cachedFile) {
                            const dt = new DataTransfer();
                            dt.items.add(cachedFile);
                            input.files = dt.files;
                        }
                        updateSimpleMergeButton();
                        return;
                    }
                    const accepted = await handleSimpleFileSelect(selectedFile, displayId, input.id);
                    if (accepted) {
                        simpleSelectedFiles[input.id] = selectedFile;
                    }
                });

                display.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    display.style.borderColor = '#764ba2';
                    display.style.background = '#e0e7ff';
                });

                display.addEventListener('dragleave', () => {
                    display.style.borderColor = '#667eea';
                    display.style.background = '#f8f9fa';
                });

                display.addEventListener('drop', (e) => {
                    e.preventDefault();
                    display.style.borderColor = '#667eea';
                    display.style.background = '#f8f9fa';
                    if (e.dataTransfer.files.length > 0) {
                        const dt = new DataTransfer();
                        dt.items.add(e.dataTransfer.files[0]);
                        input.files = dt.files;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            });
        }

        async function handleSimpleFileSelect(file, displayId, inputId) {
            if (!file) return false;
            clearError('simpleError');
            schedulePdfLibPrewarm();
            schedulePdfJsPrewarm();

            if (file.type !== 'application/pdf') {
                showError('Please select a PDF file.', 'simpleError');
                document.getElementById(inputId).value = '';
                simpleSelectedFiles[inputId] = null;
                return false;
            }

            if (file.size === 0) {
                showError('Please select a non-empty PDF file.', 'simpleError');
                document.getElementById(inputId).value = '';
                simpleSelectedFiles[inputId] = null;
                return false;
            }

            if (!(await hasPdfHeader(file))) {
                showError('Please select a valid PDF file (missing header).', 'simpleError');
                document.getElementById(inputId).value = '';
                simpleSelectedFiles[inputId] = null;
                return false;
            }

            queueEncryptionScan(file, 'simpleError', 'simple', inputId);

            const display = document.getElementById(displayId);
            display.innerHTML = `
                <div class="file-name">✓ ${file.name}</div>
                <div class="file-size">${formatFileSize(file.size)}</div>
                <button class="file-clear-btn" onclick="clearSimpleFile('${inputId}', '${displayId}')">Clear</button>
            `;
            display.classList.add('has-file');

            updateSimpleMergeButton();
            return true;
        }

        function clearSimpleFile(inputId, displayId) {
            document.getElementById(inputId).value = '';
            simpleSelectedFiles[inputId] = null;
            const display = document.getElementById(displayId);
            display.innerHTML = `
                <div class="file-input-icon">📁</div>
                <div class="file-input-text">Click or drag PDF here</div>
                <div class="file-input-subtext">Any file size</div>
            `;
            display.classList.remove('has-file');
            encryptedWarningShown.simple = false;
            updateSimpleMergeButton();
        }

        function updateSimpleMergeButton() {
            const file1 = document.getElementById('file1').files[0];
            const file2 = document.getElementById('file2').files[0];
            const btn = document.getElementById('simpleMergeBtn');
            const advBtn = document.getElementById('simpleAdvancedBtn');
            
            const files = [file1, file2].filter(Boolean);
            const hasFiles = files.length === 2;
            btn.disabled = !hasFiles;
            advBtn.disabled = !hasFiles;

            const input = document.getElementById('simpleFilename');
            if (hasFiles) {
                let filename;
                if (input) {
                    if (!input.dataset.userEdited) {
                        input.value = generateDefaultFilename(files);
                    }
                    filename = getFinalFilename(input.value, files);
                } else {
                    filename = generateDefaultFilename(files);
                }
                updateSimpleMergeButtonLabel(filename);
            } else {
                if (btn) {
                    btn.textContent = '⚡ Merge PDFs Now';
                }
                if (input && !input.dataset.userEdited) {
                    input.value = '';
                }
            }

            checkMemoryWarning(files, 'simpleWarning');
            // Prime advanced merge thumbnails in the background when both simple files are ready
            if (hasFiles) {
                primeAdvancedMergeIfReady(files);
            }
            attachPageCountListener();
        }

        // ===== EXPANDED MODE - FILE HANDLING =====
        function setupExpandedFileInputs() {
            const dropZone = document.getElementById('dropZone');
            const fileInput = document.getElementById('expandedFileInput');

            fileInput.addEventListener('change', async (e) => {
                await handleExpandedFileSelect(e.target.files);
                e.target.value = '';
            });

            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragover');
            });

            dropZone.addEventListener('drop', async (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                await handleExpandedFileSelect(e.dataTransfer.files);
            });

            dropZone.addEventListener('click', () => {
                fileInput.click();
            });
        }

        async function handleExpandedFileSelect(files) {
            if (files && files.length) {
                clearError('expandedError');
                advancedFileErrorShown = false;
                schedulePdfLibPrewarm();
            schedulePdfJsPrewarm();
            }

            for (let file of files) {
                let issueReason = '';
                if (file.type !== 'application/pdf') {
                    issueReason = 'Not a PDF file';
                } else if (file.size === 0) {
                    issueReason = 'Empty PDF (0 bytes)';
                } else if (!(await hasPdfHeader(file))) {
                    issueReason = 'Missing PDF header';
                }
                if (issueReason) {
                    markFileIssue(file, issueReason);
                    showError(`File added but will be skipped: ${issueReason}.`, 'expandedError');
                } else {
                    clearFileIssue(file);
                }

                expandedFiles.push(file);
                if (!issueReason) {
                    queueEncryptionScan(file, 'expandedError', 'expanded');
                }
            }

            renderPdfList();
            updateDocCount();
            updateExpandedMergeButton();
            primeAdvancedMergeIfReady(expandedFiles);
            attachPageCountListener();
        }

        function renderPdfList() {
            // Remove any gaps/undefined entries to avoid runtime errors
            expandedFiles = expandedFiles.filter((f) => f);
            const list = document.getElementById('pdfList');
            list.innerHTML = '';

            expandedFiles.forEach((file, index) => {
                if (!file || typeof file.name !== 'string') return;
                const issue = getFileIssue(file);
                const card = document.createElement('div');
                card.className = issue ? 'pdf-card pdf-card-invalid' : 'pdf-card';
                card.draggable = true;
                card.dataset.index = index;

                card.innerHTML = `
                    <div class="drag-handle">⋮⋮</div>
                    <div class="pdf-order">${index + 1}</div>
                    <div class="pdf-info">
                        <div class="pdf-name">${file.name}</div>
                        <div class="pdf-size">${formatFileSize(file.size)}</div>
                        ${issue ? `<div class="pdf-issue">Not mergeable: ${issue.reason}</div>` : ''}
                    </div>
                    <button class="pdf-delete" onclick="removeExpandedFile(${index})">✕</button>
                `;

                card.addEventListener('dragstart', (e) => {
                    card.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('index', index);
                });

                card.addEventListener('dragend', () => {
                    card.classList.remove('dragging');
                });

                card.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const draggedIndex = parseInt(e.dataTransfer.getData('index'));
                    if (draggedIndex !== index) {
                        [expandedFiles[draggedIndex], expandedFiles[index]] = [expandedFiles[index], expandedFiles[draggedIndex]];
                        renderPdfList();
                    }
                });

                list.appendChild(card);
            });
        }

        function removeExpandedFile(index) {
            const removed = expandedFiles.splice(index, 1)[0];
            clearFileIssue(removed);
            if (expandedFiles.length === 0) {
                advancedFileErrorShown = false;
            }
            renderPdfList();
            updateDocCount();
            updateExpandedMergeButton();
            primeAdvancedMergeIfReady(expandedFiles);
            attachPageCountListener();
        }

        function updateDocCount() {
            const total = expandedFiles.length;
            const skipped = getUnmergeableCount(expandedFiles);
            let label = total === 0 ? '0 files' : `${total} file${total !== 1 ? 's' : ''}`;
            if (skipped > 0) {
                label += ` (${skipped} skipped)`;
            }
            document.getElementById('docCount').textContent = label;
        }

        function updateExpandedMergeButton() {
            const advBtn = document.getElementById('advancedSortBtn');
            const mergeBtn = document.getElementById('expandedMergeBtn');

            const mergeableFiles = getMergeableFiles(expandedFiles);
            const hasFiles = mergeableFiles.length >= 2;
            if (advBtn) advBtn.disabled = !hasFiles;
            if (mergeBtn) mergeBtn.disabled = !hasFiles;
            
            const input = document.getElementById('expandedFilename');
            if (hasFiles) {
                let filename;
                if (input) {
                    if (!input.dataset.userEdited) {
                        input.value = generateDefaultFilename(mergeableFiles);
                    }
                    filename = getFinalFilename(input.value, mergeableFiles);
                } else {
                    filename = generateDefaultFilename(mergeableFiles);
                }
                updateExpandedMergeButtonLabel(filename);
            } else {
                if (mergeBtn) {
                    mergeBtn.textContent = 'Merge All PDFs';
                }
                if (input && !input.dataset.userEdited) {
                    input.value = '';
                }
            }

            checkMemoryWarning(mergeableFiles, 'expandedWarning');
        }

        // ===== UTILITY FUNCTIONS =====
        function formatFileSize(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }

        function markFileIssue(file, reason) {
            if (!file) return;
            fileIssues.set(file, { reason, canMerge: false });
        }

        function clearFileIssue(file) {
            if (!file) return;
            fileIssues.delete(file);
        }

        function getFileIssue(file) {
            return fileIssues.get(file) || null;
        }

        function isMergeableFile(file) {
            const issue = getFileIssue(file);
            return !issue || issue.canMerge !== false;
        }

        function getMergeableFiles(files = []) {
            return Array.from(files || []).filter((file) => file && typeof file.name === 'string' && isMergeableFile(file));
        }

        function getUnmergeableCount(files = []) {
            return Array.from(files || []).filter((file) => file && typeof file.name === 'string' && !isMergeableFile(file)).length;
        }

        function describeFileIssue(info) {
            const err = info?.error;
            if (isEncryptedPdfErrorSafe(err)) return 'Locked PDF';
            if (isCorruptPdfErrorSafe(err)) return 'Corrupted or invalid PDF';
            if (isMemoryErrorSafe(err)) return 'Too large to preview here';
            if (isFileReadErrorSafe(err)) return 'File unavailable (moved or permission)';
            const msg = `${err?.message || info?.reason || ''}`.trim();
            if (!msg) return 'Could not be processed';
            if (msg.toLowerCase().includes('file index')) return 'Could not be processed';
            return msg.replace(/^Error:\s*/i, '');
        }

        function handleAdvancedFileError(info) {
            const fileIndex = info?.fileIndex;
            let file = null;
            const err = info?.error;
            if (Array.isArray(advancedMergerFiles) && Number.isInteger(fileIndex)) {
                file = advancedMergerFiles[fileIndex] || null;
                if (file) {
                    markFileIssue(file, describeFileIssue(info));
                    advancedMergerFiles[fileIndex] = null;
                }
            }
            if (!file && Array.isArray(expandedFiles) && Number.isInteger(fileIndex)) {
                file = expandedFiles[fileIndex] || null;
                if (file) {
                    markFileIssue(file, describeFileIssue(info));
                }
            }

            renderPdfList();
            updateDocCount();
            updateExpandedMergeButton();
            checkMemoryWarning(getMergeableFiles(expandedFiles), 'advancedMergeWarning');
            if (!advancedFileErrorShown) {
                advancedFileErrorShown = true;
                let msg = 'Some files were skipped.';
                if (isEncryptedPdfErrorSafe(err)) {
                    msg = 'Locked PDF. Unlock to include it.';
                } else if (isCorruptPdfErrorSafe(err)) {
                    msg = 'Not a valid PDF. Try another file.';
                } else if (isMemoryErrorSafe(err)) {
                    msg = 'Too large to preview. Use fewer files/pages.';
                } else if (isFileReadErrorSafe(err)) {
                    msg = "Can't read a file. Re-select it.";
                }
                showError(msg, 'expandedError');
            }
        }

        function handleAdvancedAllFilesFailed() {
            renderPdfList();
            updateDocCount();
            updateExpandedMergeButton();
            showError('All selected files became unavailable. Please reselect them (copy locally if needed).', 'expandedError');
        }

        function clearError(elementId) {
            const element = document.getElementById(elementId);
            if (!element) return;
            element.textContent = '';
            element.classList.remove('show');
            const actionId = elementId === 'expandedError' ? 'expandedErrorAction' : null;
            if (actionId) {
                const action = document.getElementById(actionId);
                if (action) action.classList.remove('show');
            }
        }

        function showError(message, elementId) {
            const element = document.getElementById(elementId);
            element.textContent = message;
            element.classList.add('show');
            flashUploadGlow(elementId);
            const actionId = elementId === 'expandedError' ? 'expandedErrorAction' : null;
            if (actionId) {
                const action = document.getElementById(actionId);
                if (action) action.classList.add('show');
            }
        }

        function getAffiliateInlineHtml() {
            return ' <span class="affiliate-inline">Need signatures or forms? ' +
                '<a href="https://www.jotform.com/ai/agents/?partner=freemergepdf" ' +
                'target="_blank" rel="nofollow sponsored">Try Jotform AI →</a></span>';
        }

        function promptSkipFile(file, error) {
            const name = file && file.name ? `"${file.name}"` : 'this file';
            const reason = error && error.message ? error.message : 'Unknown error';
            return window.confirm(
                `${name} could not be processed.\n` +
                `Reason: ${reason}\n\n` +
                'Click OK to skip this file and continue merging.\n' +
                'Click Cancel to stop the merge.'
            );
        }

        function isPdfLibParseFailure(error) {
            const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
            return text.includes('failed to parse number') ||
                text.includes('parse raw int') ||
                text.includes('crossref') ||
                text.includes('cross reference') ||
                text.includes('xref');
        }

        function isPdfLibPageTreeFailure(error) {
            const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
            return text.includes('traverse is not a function') ||
                text.includes('pages(...).traverse') ||
                text.includes('catalog.pages');
        }

        function isPdfLibRecoverableFailure(error) {
            return isPdfLibParseFailure(error) || isPdfLibPageTreeFailure(error);
        }

        async function loadPdfLibDocument(arrayBuffer) {
            const parseSpeed = (typeof PDFLib !== 'undefined' && PDFLib.ParseSpeeds)
                ? PDFLib.ParseSpeeds.Fastest
                : undefined;
            const attempts = [
                parseSpeed ? { throwOnInvalidObject: false, parseSpeed } : null,
                { throwOnInvalidObject: false },
                parseSpeed ? { parseSpeed } : null
            ].filter(Boolean);

            let lastError = null;
            for (const options of attempts) {
                try {
                    return await PDFLib.PDFDocument.load(arrayBuffer, options);
                } catch (error) {
                    lastError = error;
                    if (!isPdfLibRecoverableFailure(error)) {
                        throw error;
                    }
                }
            }
            try {
                return await PDFLib.PDFDocument.load(arrayBuffer);
            } catch (error) {
                if (!isPdfLibRecoverableFailure(error)) {
                    throw error;
                }
                throw lastError || error || new Error('Failed to load PDF document');
            }
        }

        async function readFileAsArrayBuffer(file) {
            let lastError = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    return await file.arrayBuffer();
                } catch (error) {
                    lastError = error;
                    if (!isFileReadErrorSafe(error) || attempt === 1) {
                        break;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 120));
                }
            }

            if (isFileReadErrorSafe(lastError) && typeof FileReader !== 'undefined') {
                try {
                    return await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
                        reader.onabort = () => {
                            const abortErr = typeof DOMException !== 'undefined'
                                ? new DOMException('The operation was aborted.', 'AbortError')
                                : new Error('The operation was aborted.');
                            reject(reader.error || abortErr);
                        };
                        reader.onload = () => {
                            if (reader.result instanceof ArrayBuffer) {
                                resolve(reader.result);
                                return;
                            }
                            reject(new Error('Unexpected file reader result'));
                        };
                        reader.readAsArrayBuffer(file);
                    });
                } catch (fallbackError) {
                    lastError = fallbackError;
                }
            }

            throw lastError || new Error('Failed to read file');
        }

        function flashUploadGlow(elementId) {
            let targets = [];
            if (elementId === 'simpleError') {
                targets = [document.getElementById('display1'), document.getElementById('display2')];
            } else if (elementId === 'expandedError') {
                targets = [document.getElementById('dropZone')];
            }

            targets.forEach((target) => {
                if (!target) return;
                target.classList.remove('upload-error-glow');
                void target.offsetWidth;
                target.classList.add('upload-error-glow');
                setTimeout(() => target.classList.remove('upload-error-glow'), 900);
            });
        }

        function checkMemoryWarning(files, elementId) {
            const totalSize = files.reduce((sum, f) => sum + (f ? f.size : 0), 0);
            const warning = document.getElementById(elementId);

            if (totalSize > MEMORY_WARNING_THRESHOLD) {
                warning.textContent = '⚠️ Large file size detected. Merge may fail due to memory. Try fewer or smaller PDFs.';
                warning.classList.add('show');
            } else {
                warning.classList.remove('show');
            }
        }

        // ===== ADVANCED MERGE PREWARM HELPERS =====
        const __scriptLoadPromises = new Map();

        function loadScriptOnce(src, id) {
            if (!src) return Promise.reject(new Error('Missing script src'));
            const key = id || src;
            if (__scriptLoadPromises.has(key)) return __scriptLoadPromises.get(key);

            const existing = id ? document.getElementById(id) : document.querySelector(`script[src="${src}"]`);
            if (existing) {
                const resolved = Promise.resolve(true);
                __scriptLoadPromises.set(key, resolved);
                return resolved;
            }

            const promise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                if (id) script.id = id;
                script.src = src;
                script.async = true;
                script.onload = () => resolve(true);
                script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
                document.head.appendChild(script);
            });
            __scriptLoadPromises.set(key, promise);
            return promise;
        }

        function loadScriptWithCacheBust(src) {
            if (!src) return Promise.reject(new Error('Missing script src'));
            const cacheBust = src.includes('?') ? `&cb=${Date.now()}` : `?cb=${Date.now()}`;
            const bustedSrc = `${src}${cacheBust}`;
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = bustedSrc;
                script.async = true;
                script.onload = () => resolve(true);
                script.onerror = () => reject(new Error(`Failed to load script: ${bustedSrc}`));
                document.head.appendChild(script);
            });
        }

        function configurePdfJsVerbosity() {
            try {
                if (typeof pdfjsLib === 'undefined') return;
                if (typeof pdfjsLib.setVerbosityLevel !== 'function') return;
                const level = pdfjsLib.VerbosityLevel?.ERRORS;
                if (typeof level !== 'number') return;
                pdfjsLib.setVerbosityLevel(level);
            } catch (e) {
                // Ignore verbosity setup failures and continue with defaults.
            }
        }

        function getPdfJsDocOptions(arrayBuffer) {
            const level = pdfjsLib?.VerbosityLevel?.ERRORS;
            if (typeof level === 'number') {
                return { data: arrayBuffer, verbosity: level };
            }
            return { data: arrayBuffer };
        }

        async function ensurePdfJsReady() {
            if (typeof pdfjsLib !== 'undefined' && pdfjsLib.getDocument) {
                configurePdfJsVerbosity();
                return true;
            }
            try {
                await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjs-cdn-fallback');
            } catch (err) {
                return false;
            }
            configurePdfJsVerbosity();
            return typeof pdfjsLib !== 'undefined' && pdfjsLib.getDocument;
        }

        async function ensurePdfLibReady() {
            if (typeof PDFLib !== 'undefined' && PDFLib.PDFDocument) return true;
            try {
                await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'pdflib-cdn-fallback');
            } catch (err) {
                return false;
            }
            return typeof PDFLib !== 'undefined' && PDFLib.PDFDocument;
        }

        async function ensurePdfLibReadyWithRetry() {
            const ok = await ensurePdfLibReady();
            if (ok) return true;
            await new Promise(resolve => setTimeout(resolve, 300));
            try {
                await loadScriptWithCacheBust('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js');
            } catch (err) {
                return false;
            }
            return typeof PDFLib !== 'undefined' && PDFLib.PDFDocument;
        }

        async function ensureAdvancedMergerReady() {
            if (typeof AdvancedPDFMerger !== 'undefined') return true;
            const existingAdvancedScript = Array.from(document.scripts || []).find((script) => {
                const src = script?.getAttribute('src') || '';
                return /(?:^|\/)advanced-pdf-merger\.js(?:\?|$)/i.test(src);
            });
            if (existingAdvancedScript) {
                const waitUntil = Date.now() + 3000;
                while (typeof AdvancedPDFMerger === 'undefined' && Date.now() < waitUntil) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (typeof AdvancedPDFMerger !== 'undefined') return true;
            }
            try {
                await loadScriptOnce('advanced-pdf-merger.js?v=10', 'advanced-merger-fallback');
            } catch (err) {
                return false;
            }
            return typeof AdvancedPDFMerger !== 'undefined';
        }

        async function ensureAdvancedDependencies() {
            if (window.__advancedDepsReady) return true;
            const pdfOk = await ensurePdfJsReady();
            const mergerOk = await ensureAdvancedMergerReady();
            window.__advancedDepsReady = pdfOk && mergerOk;
            return window.__advancedDepsReady;
        }


        function schedulePdfLibPrewarm() {
            if (window.__pdfLibPrewarmQueued) return;
            window.__pdfLibPrewarmQueued = true;
            const run = () => { ensurePdfLibReadyWithRetry(); };
            if ('requestIdleCallback' in window) {
                requestIdleCallback(run, { timeout: 1500 });
            } else {
                setTimeout(run, 300);
            }
        }

        function schedulePdfJsPrewarm() {
            if (window.__pdfJsPrewarmQueued) return;
            window.__pdfJsPrewarmQueued = true;
            const run = () => { ensurePdfJsReady(); };
            if ('requestIdleCallback' in window) {
                requestIdleCallback(run, { timeout: 1500 });
            } else {
                setTimeout(run, 300);
            }
        }

        function buildFilesKey(files) {
            return files.map(f => `${f.name}-${f.size}-${f.lastModified || 0}`).join('|');
        }

        function attachPageCountListener() {
            if (advancedPageCountListenerAttached) return;
            const container = document.getElementById('advancedMergeContent');
            if (!container) return;

            container.addEventListener('pagecountchange', (e) => {
                const count = e.detail?.count ?? 0;
                const pageCountEl = document.getElementById('pageCount');
                if (pageCountEl) pageCountEl.textContent = count;
            });

            advancedPageCountListenerAttached = true;
        }

        async function getAdvancedMergerInstance() {
            const depsOk = await ensureAdvancedDependencies();
            if (!depsOk) return null;
            if (!advancedMerger) {
                advancedMerger = new AdvancedPDFMerger({
                    maxPagesInMemory: 100,
                    thumbnailScale: 1.2,
                    jpegQuality: 0.7,
                    maxPreRenderPages: 120,
                    onFileError: handleAdvancedFileError,
                    onAllFilesFailed: handleAdvancedAllFilesFailed
                });
            }
            return advancedMerger;
        }

        async function ensureAdvancedPrepared(files) {
            const mergeableFiles = getMergeableFiles(files);
            if (!mergeableFiles || mergeableFiles.length < 2) return null;

            const key = buildFilesKey(mergeableFiles);
            if (advancedMergerPrewarmPromise) {
                await advancedMergerPrewarmPromise;
            }

            if (advancedMerger && advancedMergerPrewarmKey === key && advancedMerger.pages && advancedMerger.pages.length) {
                advancedMergerFiles = mergeableFiles.slice();
                return advancedMerger;
            }

            // New set of files: reset and warm thumbnails in the background
            if (advancedMerger) {
                advancedMerger.destroy();
                advancedMerger = null;
            }

            const merger = await getAdvancedMergerInstance();
            if (!merger) {
                showError('Advanced merge failed to load. Please refresh the page.', 'expandedError');
                return null;
            }
            advancedMergerPrewarmKey = key;

            const container = document.getElementById('advancedMergeContent');
            if (!container) return null;

            container.innerHTML = '';
            advancedMergerFiles = mergeableFiles.slice();
            advancedMergerPrewarmPromise = merger.initialize(mergeableFiles, '#advancedMergeContent')
                .catch((err) => {
                    console.error('Advanced merge prewarm failed:', err);
                    advancedMergerPrewarmKey = '';
                    advancedMergerFiles = [];
                })
                .finally(() => {
                    advancedMergerPrewarmPromise = null;
                });

            await advancedMergerPrewarmPromise;
            return merger;
        }

        function primeAdvancedMergeIfReady(files) {
            const mergeableFiles = getMergeableFiles(files);
            advancedMergerFiles = mergeableFiles.slice();
            if (mergeableFiles && mergeableFiles.length >= 2) {
                ensureAdvancedPrepared(mergeableFiles);
            }
        }

        /**
         * Generate default filename from uploaded files
         * Ensures filename doesn't exceed OS limits (255 chars)
         */
        function generateDefaultFilename(files) {
            if (files.length === 0) return 'merged.pdf';
            
            // Get names without extension, max 15 chars each
            const names = files.map(f => {
                return f.name.replace(/\.pdf$/i, '').substring(0, 15);
            });

            let filename;
            if (files.length === 1) {
                filename = `${names[0]}_merged.pdf`;
            } else if (files.length === 2) {
                filename = `${names[0]}_${names[1]}_merged.pdf`;
            } else {
                // 3+ files: file1_file2_more_files_merged.pdf
                filename = `${names[0]}_${names[1]}_more_files_merged.pdf`;
            }

            // Safety check: if filename exceeds 200 chars, truncate
            if (filename.length > 200) {
                // Keep first file name + more_files_merged.pdf
                const safeLength = 200 - "_more_files_merged.pdf".length;
                filename = names[0].substring(0, safeLength) + "_more_files_merged.pdf";
            }

            return filename;
        }

        // ===== FILENAME HELPERS (NEW) =====
        function getFinalFilename(rawName, files) {
            const trimmed = (rawName || '').trim();
            let filename = trimmed || generateDefaultFilename(files);
            if (!/\.pdf$/i.test(filename)) {
                filename += '.pdf';
            }
            return filename;
        }

        function updateSimpleMergeButtonLabel(filename) {
            const btn = document.getElementById('simpleMergeBtn');
            if (!btn) return;
            btn.textContent = `⚡ Merge & Download ${filename}`;
        }

        function updateExpandedMergeButtonLabel(filename) {
            const btn = document.getElementById('expandedMergeBtn');
            if (!btn) return;
            btn.textContent = `Merge & Download ${filename}`;
        }

        function setupFilenameInputs() {
            const simpleInput = document.getElementById('simpleFilename');
            if (simpleInput) {
                simpleInput.addEventListener('input', () => {
                    simpleInput.dataset.userEdited = 'true';
                    const file1 = document.getElementById('file1').files[0];
                    const file2 = document.getElementById('file2').files[0];
                    const files = [file1, file2].filter(Boolean);
                    if (!files.length) return;
                    const filename = getFinalFilename(simpleInput.value, files);
                    updateSimpleMergeButtonLabel(filename);
                });
            }

            const expandedInput = document.getElementById('expandedFilename');
            if (expandedInput) {
                expandedInput.addEventListener('input', () => {
                    expandedInput.dataset.userEdited = 'true';
                    const files = getMergeableFiles(expandedFiles || []);
                    if (!files.length) return;
                    const filename = getFinalFilename(expandedInput.value, files);
                    updateExpandedMergeButtonLabel(filename);
                });
            }
        }

        // ===== ADVANCED MERGE FUNCTIONS =====
        async function openAdvancedSortFromSimple() {
            const file1 = document.getElementById('file1').files[0];
            const file2 = document.getElementById('file2').files[0];

            if (!file1 || !file2) {
                showError('Please select 2 PDF files first.', 'simpleError');
                return;
            }

            const mergeableFiles = getMergeableFiles([file1, file2]);
            if (mergeableFiles.length < 2) {
                showError('Select at least 2 mergeable PDFs before using Advanced Merge.', 'simpleError');
                return;
            }

            // Set expandedFiles for advanced merger
            expandedFiles = [file1, file2];
            encryptedWarningShown.expanded = false;
            queueEncryptionScan(file1, 'expandedError', 'expanded');
            queueEncryptionScan(file2, 'expandedError', 'expanded');

            // Set default filename
            const defaultName = generateDefaultFilename(mergeableFiles);
            document.getElementById('customFilename').value = defaultName;

            await ensureAdvancedPrepared(mergeableFiles);
            checkMemoryWarning(mergeableFiles, 'advancedMergeWarning');

            // Open modal once prewarmed (or immediately if already ready)
            document.getElementById('advancedMergeModal').classList.add('active');
            document.getElementById('pageCount').textContent = advancedMerger?.pages?.length || 0;
        }

        async function openAdvancedSort() {
            const isExpanded = document.getElementById('expandedMode').classList.contains('active');
            
            if (!isExpanded) {
                showError('Please switch to expanded mode first (merge multiple files).', 'expandedError');
                return;
            }

            if (expandedFiles.length < 2) {
                showError('Please add at least 2 files to use advanced sorting.', 'expandedError');
                return;
            }

            // Set default filename
            const mergeableFiles = getMergeableFiles(expandedFiles);
            if (mergeableFiles.length < 2) {
                showError('Please select at least 2 mergeable PDF files.', 'expandedError');
                return;
            }

            const defaultName = generateDefaultFilename(mergeableFiles);
            document.getElementById('customFilename').value = defaultName;

            await ensureAdvancedPrepared(mergeableFiles);
            checkMemoryWarning(mergeableFiles, 'advancedMergeWarning');

            document.getElementById('advancedMergeModal').classList.add('active');
            document.getElementById('pageCount').textContent = advancedMerger?.pages?.length || 0;
        }

        function closeAdvancedSort() {
            const modal = document.getElementById('advancedMergeModal');
            modal.classList.remove('active');
        }

        function resetPageOrder() {
            if (advancedMerger) {
                advancedMerger.resetOrder();
            }
        }

        function isCompressEnabledForMode(mode, fallback = true) {
            const toggle = document.getElementById(`${mode}CompressToggle`);
            return toggle ? toggle.checked : fallback;
        }

        function isMoreCompressEnabledForMode(mode) {
            const toggle = document.getElementById(`${mode}RasterToggle`);
            return toggle ? toggle.checked : false;
        }

        function getRasterSettingsForMode(mode) {
            const scaleInput = document.getElementById(`${mode}RasterScale`);
            const qualityInput = document.getElementById(`${mode}RasterQuality`);
            const scale = scaleInput ? parseFloat(scaleInput.value) : 1.0;
            const quality = qualityInput ? parseFloat(qualityInput.value) : 0.6;
            return {
                scale: Number.isFinite(scale) ? scale : 1.0,
                quality: Number.isFinite(quality) ? quality : 0.6
            };
        }

        function updateRasterValue(mode) {
            const qualityInput = document.getElementById(`${mode}RasterQuality`);
            const qualityValue = document.getElementById(`${mode}RasterQualityValue`);
            if (qualityInput && qualityValue) {
                qualityValue.textContent = `${Math.round(parseFloat(qualityInput.value) * 100)}%`;
            }
            const scaleInput = document.getElementById(`${mode}RasterScale`);
            const scaleValue = document.getElementById(`${mode}RasterScaleValue`);
            if (scaleInput && scaleValue) {
                scaleValue.textContent = `${Math.round(parseFloat(scaleInput.value) * 100)}%`;
            }
        }

        function isAdvancedCompressionEnabled() {
            const toggle = document.getElementById('advancedCompressionToggle');
            return toggle ? toggle.checked : false;
        }

        function getAdvancedCompressionMode() {
            if (!isAdvancedCompressionEnabled()) return 'none';
            const selected = document.querySelector('input[name="advancedCompressionMode"]:checked');
            return selected ? selected.value : 'standard';
        }

        function updateAdvancedCompressionToggleLabel() {
            const toggle = document.getElementById('advancedCompressionToggle');
            const label = document.querySelector('label[for="advancedCompressionToggle"]');
            if (!toggle || !label) return;
            const enabled = toggle.checked;
            label.textContent = enabled ? 'Compression On' : 'Compression Off';
            label.classList.toggle('is-on', enabled);
        }

        function updateAdvancedCompressionSettings() {
            const settings = document.getElementById('advancedRasterSettings');
            const options = document.getElementById('advancedCompressionOptions');
            if (!settings || !options) return;
            const enabled = isAdvancedCompressionEnabled();
            options.classList.toggle('active', enabled);
            options.querySelectorAll('input').forEach((input) => {
                input.disabled = !enabled;
            });
            const showSettings = enabled && getAdvancedCompressionMode() === 'images';
            settings.classList.toggle('active', showSettings);
            settings.querySelectorAll('input').forEach((input) => {
                input.disabled = !showSettings;
            });
            updateRasterValue('advanced');
        }

        function setupAdvancedCompressionControls() {
            updateAdvancedCompressionToggleLabel();
            updateAdvancedCompressionSettings();
            const toggle = document.getElementById('advancedCompressionToggle');
            if (toggle) {
                toggle.addEventListener('change', () => {
                    updateAdvancedCompressionToggleLabel();
                    updateAdvancedCompressionSettings();
                });
            }
            document.querySelectorAll('input[name="advancedCompressionMode"]').forEach((input) => {
                input.addEventListener('change', updateAdvancedCompressionSettings);
            });
            const qualityInput = document.getElementById('advancedRasterQuality');
            const scaleInput = document.getElementById('advancedRasterScale');
            if (qualityInput) {
                qualityInput.addEventListener('input', () => updateRasterValue('advanced'));
            }
            if (scaleInput) {
                scaleInput.addEventListener('input', () => updateRasterValue('advanced'));
            }
        }

        function isAdvancedCompressEnabled() {
            return isAdvancedCompressionEnabled();
        }

        function isAdvancedMoreCompressEnabled() {
            return isAdvancedCompressionEnabled() && getAdvancedCompressionMode() === 'images';
        }

        function getAdvancedRasterSettings() {
            return getRasterSettingsForMode('advanced');
        }

        function dataUrlToUint8Array(dataUrl) {
            const base64 = (dataUrl || '').split(',')[1] || '';
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        }

        async function renderPdfJsPageToJpegBytes(page, settings) {
            const viewport = page.getViewport({ scale: settings.scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Could not get canvas context');
            }
            const renderTask = page.render({ canvasContext: context, viewport });
            await renderTask.promise;
            const dataUrl = canvas.toDataURL('image/jpeg', settings.quality);
            return {
                bytes: dataUrlToUint8Array(dataUrl),
                width: viewport.width,
                height: viewport.height
            };
        }

        async function renderPageToJpegBytes(pageData, settings) {
            if (!pageData || !pageData.pdfDoc) {
                throw new Error('Page source not available for compression');
            }
            const page = await pageData.pdfDoc.getPage(pageData.pageIndex + 1);
            return renderPdfJsPageToJpegBytes(page, settings);
        }

        const IMAGE_HEAVY_TEXT_CHARS = 80;
        const IMAGE_HEAVY_TEXT_ITEMS = 12;

        function getImageOpSet() {
            if (typeof pdfjsLib === 'undefined' || !pdfjsLib.OPS) return new Set();
            const ops = pdfjsLib.OPS;
            return new Set([
                ops.paintImageXObject,
                ops.paintJpegXObject,
                ops.paintImageMaskXObject,
                ops.paintInlineImageXObject,
                ops.paintInlineImageXObjectGroup
            ].filter((value) => typeof value === 'number'));
        }

        async function isImageHeavyPdfJsPage(page) {
            try {
                const [textContent, opList] = await Promise.all([
                    page.getTextContent(),
                    page.getOperatorList()
                ]);
                const items = textContent.items || [];
                const textChars = items.reduce((sum, item) => {
                    const text = item?.str || '';
                    return sum + text.trim().length;
                }, 0);
                const textItems = items.length;
                const imageOps = getImageOpSet();
                const imageCount = (opList.fnArray || []).reduce((sum, op) => {
                    return sum + (imageOps.has(op) ? 1 : 0);
                }, 0);
                return imageCount > 0 && textChars <= IMAGE_HEAVY_TEXT_CHARS && textItems <= IMAGE_HEAVY_TEXT_ITEMS;
            } catch (error) {
                return false;
            }
        }

        function ensurePdfJsWorker() {
            if (typeof pdfjsLib === 'undefined' || !pdfjsLib.GlobalWorkerOptions) return;
            const toAbsoluteUrl = (value) => {
                try {
                    return new URL(value, window.location.href).toString();
                } catch (error) {
                    return value;
                }
            };
            const defaultWorkerSrc = toAbsoluteUrl('/pdf.worker.min.js');
            const configuredWorkerSrc = pdfjsLib.GlobalWorkerOptions.workerSrc;
            if (!configuredWorkerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = defaultWorkerSrc;
                return;
            }
            const normalizedWorkerSrc = toAbsoluteUrl(configuredWorkerSrc);
            if (normalizedWorkerSrc !== configuredWorkerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = normalizedWorkerSrc;
            }
        }

        async function finalizeAdvancedMerge() {
            if (!advancedMerger) return;

            const orderedPages = advancedMerger.getPageOrder();
            closeAdvancedSort();
            await mergeWithCustomOrder(orderedPages);
        }

        async function mergeWithCustomOrder(orderedPages) {
            const customFilename = document.getElementById('customFilename').value.trim() || 'merged.pdf';
            const filename = customFilename.endsWith('.pdf') ? customFilename : customFilename + '.pdf';
            const mergeStart = performance.now();
            const compressEnabled = isAdvancedCompressEnabled();
            const moreCompressEnabled = isAdvancedMoreCompressEnabled();
            const useObjectStreams = compressEnabled || moreCompressEnabled;
            const mergeFiles = advancedMergerFiles && advancedMergerFiles.length ? advancedMergerFiles : getMergeableFiles(expandedFiles);
            const stats = getFileStats(mergeFiles);
            const skippedFileIndices = new Set();
            let skippedCount = 0;
            let rasterizedPages = 0;
            let compressionNote = '';
            mergeInProgress = true;
            
            const btn = document.getElementById('expandedMergeBtn');
            btn.classList.add('loading');
            btn.disabled = true;

            // Stop thumbnail rendering to prioritize merge
            if (advancedMerger && typeof advancedMerger.cancelThumbnailRendering === 'function') {
                advancedMerger.cancelThumbnailRendering();
            }

            const statusElement = document.getElementById('expandedStatus') || 
                                document.createElement('div');
            
            if (!statusElement.id) {
                statusElement.id = 'expandedStatus';
                statusElement.className = 'status-area status-processing';
                document.querySelector('.mode-expanded').appendChild(statusElement);
            }

            statusElement.className = 'status-area status-processing';
            statusElement.innerHTML = '<span>⏳ Merging with custom order...</span>';
            if (moreCompressEnabled) {
                statusElement.innerHTML = '<span>Compressing pages...</span>';
            }

            try {
                if (mergeFiles.length < 2) {
                    statusElement.className = 'status-area status-error';
                    statusElement.innerHTML = '<span>Select at least 2 mergeable PDFs.</span>';
                    return;
                }
                if (isMergeTooLarge(stats)) {
                    statusElement.className = 'status-area status-error';
                    statusElement.innerHTML = '<span>' + buildMergeTooLargeMessage(stats) + '</span>';
                    return;
                }
                const pdfDoc = await PDFLib.PDFDocument.create();
                if (hasKnownEncryptedFile(mergeFiles)) {
                    statusElement.className = 'status-area status-error';
                    statusElement.innerHTML = '<span>🔒 Locked PDF. Unlock to merge.</span>';
                    return;
                }
                if (moreCompressEnabled) {
                    const rasterSettings = getAdvancedRasterSettings();
                    const totalPages = orderedPages.length;
                    const loadedPdfs = new Map();
                    ensurePdfJsWorker();

                    for (let i = 0; i < orderedPages.length; i++) {
                        const pageData = orderedPages[i];
                        const fileIndex = pageData.fileIndex;
                        if (skippedFileIndices.has(fileIndex)) continue;

                        const file = mergeFiles[fileIndex];
                        if (!file) {
                            skippedFileIndices.add(fileIndex);
                            skippedCount += 1;
                            continue;
                        }

                        let pdfJsPage = null;
                        try {
                            pdfJsPage = await pageData.pdfDoc.getPage(pageData.pageIndex + 1);
                        } catch (error) {
                            const shouldSkip = promptSkipFile(file, error);
                            if (shouldSkip) {
                                skippedFileIndices.add(fileIndex);
                                skippedCount += 1;
                                markFileIssue(file, 'Skipped due to read error');
                                renderPdfList();
                                updateDocCount();
                                updateExpandedMergeButton();
                                reportMergeError(error, {
                                    mode: 'advanced_sorted',
                                    step: 'mergeWithCustomOrder-rasterize-skip',
                                    fileCount: mergeFiles?.length || 0,
                                    pageCount: orderedPages?.length || 0,
                                    totalBytes: stats.totalBytes,
                                    maxBytes: stats.maxBytes,
                                    durationMs: performance.now() - mergeStart,
                                    source: 'pdfjs-raster',
                                    userNote: `user_action=skip;fileIndex=${fileIndex}`
                                });
                                continue;
                            }
                            throw error;
                        }

                        const shouldRasterize = await isImageHeavyPdfJsPage(pdfJsPage);

                        if (shouldRasterize) {
                            try {
                                const raster = await renderPdfJsPageToJpegBytes(pdfJsPage, rasterSettings);
                                const image = await pdfDoc.embedJpg(raster.bytes);
                                const page = pdfDoc.addPage([raster.width, raster.height]);
                                page.drawImage(image, {
                                    x: 0,
                                    y: 0,
                                    width: raster.width,
                                    height: raster.height
                                });
                                rasterizedPages += 1;
                            } catch (error) {
                                const shouldSkip = promptSkipFile(file, error);
                                if (shouldSkip) {
                                    skippedFileIndices.add(fileIndex);
                                    skippedCount += 1;
                                    markFileIssue(file, 'Skipped due to read error');
                                    renderPdfList();
                                    updateDocCount();
                                    updateExpandedMergeButton();
                                    reportMergeError(error, {
                                        mode: 'advanced_sorted',
                                        step: 'mergeWithCustomOrder-rasterize-skip',
                                        fileCount: mergeFiles?.length || 0,
                                        pageCount: orderedPages?.length || 0,
                                        totalBytes: stats.totalBytes,
                                        maxBytes: stats.maxBytes,
                                        durationMs: performance.now() - mergeStart,
                                        source: 'pdfjs-raster',
                                        userNote: `user_action=skip;fileIndex=${fileIndex}`
                                    });
                                    continue;
                                }
                                throw error;
                            }
                        } else {
                            if (!loadedPdfs.has(fileIndex)) {
                                try {
                                    const arrayBuffer = await readFileAsArrayBuffer(file);
                                    const pdf = await loadPdfLibDocument(arrayBuffer);
                                    loadedPdfs.set(fileIndex, pdf);
                                } catch (error) {
                                    const shouldSkip = promptSkipFile(file, error);
                                    if (shouldSkip) {
                                        skippedFileIndices.add(fileIndex);
                                        skippedCount += 1;
                                        markFileIssue(file, 'Skipped due to read error');
                                        renderPdfList();
                                        updateDocCount();
                                        updateExpandedMergeButton();
                                        reportMergeError(error, {
                                            mode: 'advanced_sorted',
                                            step: 'mergeWithCustomOrder-skip',
                                            fileCount: mergeFiles?.length || 0,
                                            pageCount: orderedPages?.length || 0,
                                            totalBytes: stats.totalBytes,
                                            maxBytes: stats.maxBytes,
                                            durationMs: performance.now() - mergeStart,
                                            source: 'pdf-lib',
                                            userNote: `user_action=skip;fileIndex=${fileIndex}`
                                        });
                                        continue;
                                    }
                                    throw error;
                                }
                            }

                            if (skippedFileIndices.has(fileIndex)) continue;

                            try {
                                const sourcePdf = loadedPdfs.get(fileIndex);
                                if (!sourcePdf) continue;
                                const copiedPages = await pdfDoc.copyPages(sourcePdf, [pageData.pageIndex]);
                                copiedPages.forEach((page) => {
                                    pdfDoc.addPage(page);
                                });
                            } catch (error) {
                                const shouldSkip = promptSkipFile(file, error);
                                if (shouldSkip) {
                                    skippedFileIndices.add(fileIndex);
                                    skippedCount += 1;
                                    markFileIssue(file, 'Skipped due to read error');
                                    renderPdfList();
                                    updateDocCount();
                                    updateExpandedMergeButton();
                                    reportMergeError(error, {
                                        mode: 'advanced_sorted',
                                        step: 'mergeWithCustomOrder-skip',
                                        fileCount: mergeFiles?.length || 0,
                                        pageCount: orderedPages?.length || 0,
                                        totalBytes: stats.totalBytes,
                                        maxBytes: stats.maxBytes,
                                        durationMs: performance.now() - mergeStart,
                                        source: 'pdf-lib',
                                        userNote: `user_action=skip;fileIndex=${fileIndex}`
                                    });
                                    continue;
                                }
                                throw error;
                            }
                        }

                        if ((i + 1) % 10 === 0 || i === totalPages - 1) {
                            statusElement.innerHTML = '<span>Compressing pages... ' + (i + 1) + '/' + totalPages + '</span>';
                        }
                    }

                    if (rasterizedPages === 0) {
                        compressionNote = 'Note: No image-heavy pages found; compression is minimal.';
                    }
                } else {
                    const loadedPdfs = new Map();

                    for (const pageData of orderedPages) {
                        const fileIndex = pageData.fileIndex;
                        if (skippedFileIndices.has(fileIndex)) continue;

                        const file = mergeFiles[fileIndex];
                        if (!file) {
                            skippedFileIndices.add(fileIndex);
                            skippedCount += 1;
                            continue;
                        }

                        if (!loadedPdfs.has(fileIndex)) {
                            try {
                                const arrayBuffer = await readFileAsArrayBuffer(file);
                                const pdf = await loadPdfLibDocument(arrayBuffer);
                                loadedPdfs.set(fileIndex, pdf);
                            } catch (error) {
                                const shouldSkip = promptSkipFile(file, error);
                                if (shouldSkip) {
                                    skippedFileIndices.add(fileIndex);
                                    skippedCount += 1;
                                    markFileIssue(file, 'Skipped due to read error');
                                    renderPdfList();
                                    updateDocCount();
                                    updateExpandedMergeButton();
                                    reportMergeError(error, {
                                        mode: 'advanced_sorted',
                                        step: 'mergeWithCustomOrder-skip',
                                        fileCount: mergeFiles?.length || 0,
                                        pageCount: orderedPages?.length || 0,
                                        totalBytes: stats.totalBytes,
                                        maxBytes: stats.maxBytes,
                                        durationMs: performance.now() - mergeStart,
                                        source: 'pdf-lib',
                                        userNote: `user_action=skip;fileIndex=${fileIndex}`
                                    });
                                    continue;
                                }
                                throw error;
                            }
                        }

                        if (skippedFileIndices.has(fileIndex)) continue;

                        try {
                            const sourcePdf = loadedPdfs.get(fileIndex);
                            if (!sourcePdf) continue;
                            const copiedPages = await pdfDoc.copyPages(sourcePdf, [pageData.pageIndex]);
                            
                            copiedPages.forEach((page) => {
                                pdfDoc.addPage(page);
                            });
                        } catch (error) {
                            const shouldSkip = promptSkipFile(file, error);
                            if (shouldSkip) {
                                skippedFileIndices.add(fileIndex);
                                skippedCount += 1;
                                markFileIssue(file, 'Skipped due to read error');
                                renderPdfList();
                                updateDocCount();
                                updateExpandedMergeButton();
                                reportMergeError(error, {
                                    mode: 'advanced_sorted',
                                    step: 'mergeWithCustomOrder-skip',
                                    fileCount: mergeFiles?.length || 0,
                                    pageCount: orderedPages?.length || 0,
                                    totalBytes: stats.totalBytes,
                                    maxBytes: stats.maxBytes,
                                    durationMs: performance.now() - mergeStart,
                                    source: 'pdf-lib',
                                    userNote: `user_action=skip;fileIndex=${fileIndex}`
                                });
                                continue;
                            }
                            throw error;
                        }
                    }
                }

                if (pdfDoc.getPageCount() === 0) {
                    statusElement.className = 'status-area status-error';
                    statusElement.innerHTML = '<span>No mergeable pages were left after skipping files.</span>';
                    return;
                }

                if (pdfDoc.getPageCount() === 0) {
                    const msg = 'No mergeable pages were left after skipping files.';
                    showError(msg, isExpanded ? 'expandedError' : 'simpleError');
                    if (statusElement) {
                        statusElement.className = 'status-area status-error';
                        statusElement.innerHTML = '<span>' + msg + '</span>';
                    }
                    return;
                }

                const pdfBytes = await pdfDoc.save({ useObjectStreams });
                downloadPDF(pdfBytes, filename);

                const successMsg = skippedCount > 0
                    ? `Merged with ${skippedCount} skipped file${skippedCount !== 1 ? 's' : ''}. Download started.`
                    : 'Success! Download started.';
                statusElement.className = 'status-area status-success';
                const noteText = compressionNote ? ' ' + compressionNote : '';
                statusElement.innerHTML = '<span>' + successMsg + noteText + getAffiliateInlineHtml() + '</span>';

                if (typeof gtag !== 'undefined') {
                    gtag('event', 'pdf_merge_success', {
                        'mode': 'advanced_sorted',
                        'file_count': mergeFiles.length,
                        'page_count': pdfDoc.getPageCount()
                    });
                }
            } catch (error) {
                const isEncrypted = isEncryptedPdfErrorSafe(error);
                const isMemory = isMemoryErrorSafe(error);
                const isFileRead = isFileReadErrorSafe(error);
                let friendlyMsg = `Error: ${error.message}`;
                if (isEncrypted) {
                    friendlyMsg = 'Locked PDF. Unlock to merge.';
                } else if (isMemory) {
                    friendlyMsg = 'The merge ran out of memory. Try fewer or smaller PDFs.';
                } else if (isFileRead) {
                    friendlyMsg = 'Could not read one of the files. It may have been moved, renamed, or is in a sync/network folder. Copy it locally and reselect.';
                }
                statusElement.className = 'status-area status-error';
                statusElement.innerHTML = '<span>' + friendlyMsg + '</span>';

                if (typeof gtag !== 'undefined') {
                    gtag('event', 'pdf_merge_error', {
                        'mode': 'advanced_sorted',
                        'error_message': error.message
                    });
                }

                console.error('Merge error:', error);
                reportMergeError(error, {
                    mode: 'advanced_sorted',
                    step: 'mergeWithCustomOrder',
                    fileCount: mergeFiles?.length || 0,
                    pageCount: orderedPages?.length || 0,
                    totalBytes: stats.totalBytes,
                    maxBytes: stats.maxBytes,
                    durationMs: performance.now() - mergeStart,
                    source: 'pdf-lib'
                });
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
                mergeInProgress = false;
            }
        }

        // ===== MERGE FUNCTION =====
        async function mergePDFs() {
          const mergeStart = performance.now();
          let stats = { totalBytes: 0, maxBytes: 0, fileCount: 0 };
          mergeInProgress = true;
          try {
            const isExpanded = document.getElementById('expandedMode').classList.contains('active');
            const pdfLibOk = await ensurePdfLibReadyWithRetry();
            if (!pdfLibOk) {
                showError('PDF engine failed to load. Refresh the page.', isExpanded ? 'expandedError' : 'simpleError');
                mergeInProgress = false;
                return;
            }
            const allFiles = isExpanded 
                ? expandedFiles 
                : [document.getElementById('file1').files[0], document.getElementById('file2').files[0]].filter(Boolean);
            const files = getMergeableFiles(allFiles);

            if (files.length < 2) {
                showError('Select at least 2 mergeable PDFs.', isExpanded ? 'expandedError' : 'simpleError');
                mergeInProgress = false;
                return;
            }

            // Stop any background thumbnail rendering to prioritize merge
            if (advancedMerger && typeof advancedMerger.cancelThumbnailRendering === 'function') {
                advancedMerger.cancelThumbnailRendering();
            }

            const btn = isExpanded ? document.getElementById('expandedMergeBtn') : document.getElementById('simpleMergeBtn');
            btn.classList.add('loading');
            btn.disabled = true;

            const statusElement = isExpanded
                ? document.getElementById('expandedStatus') || document.createElement('div')
                : document.getElementById('simpleStatus');
            if (isExpanded && statusElement && !statusElement.id) {
                statusElement.id = 'expandedStatus';
                statusElement.className = 'status-area status-processing';
                document.querySelector('.mode-expanded').appendChild(statusElement);
            }
            if (statusElement) {
                statusElement.className = 'status-area status-processing';
                statusElement.innerHTML = '<span>⏳ Processing...</span>';
            }

            try {
                let skippedCount = 0;
                let compressionNote = '';
                stats = getFileStats(files);
                const modeKey = isExpanded ? 'expanded' : 'simple';
                const compressEnabled = isCompressEnabledForMode(modeKey, true);
                const moreCompressEnabled = isMoreCompressEnabledForMode(modeKey);
                const useObjectStreams = compressEnabled || moreCompressEnabled;
                const rasterSettings = getRasterSettingsForMode(modeKey);
                if (statusElement && moreCompressEnabled) {
                    statusElement.className = 'status-area status-processing';
                    statusElement.innerHTML = '<span>Compressing pages...</span>';
                }
                // Generate filename based on mode and input
                let filename;
                if (isExpanded) {
                    const input = document.getElementById('expandedFilename');
                    filename = getFinalFilename(input ? input.value : '', files);
                } else {
                    const input = document.getElementById('simpleFilename');
                    filename = getFinalFilename(input ? input.value : '', files);
                }
                
                if (isMergeTooLarge(stats)) {
                    const msg = buildMergeTooLargeMessage(stats);
                    showError(msg, isExpanded ? 'expandedError' : 'simpleError');
                    if (statusElement) {
                        statusElement.className = 'status-area status-error';
                        statusElement.innerHTML = '<span>' + msg + '</span>';
                    }
                    return;
                }
                const pdfDoc = await PDFLib.PDFDocument.create();
                if (hasKnownEncryptedFile(files)) {
                    const msg = 'Locked PDF. Unlock to merge.';
                    showError(msg, isExpanded ? 'expandedError' : 'simpleError');
                    if (statusElement) {
                        statusElement.className = 'status-area status-error';
                        statusElement.innerHTML = '<span>🔒 Locked PDF. Unlock to merge.</span>';
                    }
                    return;
                }

                if (moreCompressEnabled) {
                    let processedPages = 0;
                    let totalPages = 0;
                    let rasterizedCount = 0;
                    ensurePdfJsWorker();

                    for (const file of files) {
                        let pdfJsDoc = null;
                        let pdfLibDoc = null;
                        try {
                            const arrayBuffer = await readFileAsArrayBuffer(file);
                            pdfJsDoc = await pdfjsLib.getDocument(getPdfJsDocOptions(arrayBuffer)).promise;
                            pdfLibDoc = await loadPdfLibDocument(arrayBuffer);
                            totalPages += pdfJsDoc.numPages;
                        } catch (error) {
                            const shouldSkip = promptSkipFile(file, error);
                            if (shouldSkip) {
                                skippedCount += 1;
                                markFileIssue(file, 'Skipped due to read error');
                                if (isExpanded) {
                                    renderPdfList();
                                    updateDocCount();
                                    updateExpandedMergeButton();
                                }
                                reportMergeError(error, {
                                    mode: isExpanded ? 'expanded' : 'simple',
                                    step: 'mergePDFs-rasterize-skip',
                                    fileCount: files?.length || 0,
                                    totalBytes: stats.totalBytes,
                                    maxBytes: stats.maxBytes,
                                    durationMs: performance.now() - mergeStart,
                                    source: 'pdfjs-raster',
                                    userNote: 'user_action=skip'
                                });
                                continue;
                            }
                            throw error;
                        }

                        let skipCurrentFile = false;
                        for (let pageIndex = 0; pageIndex < pdfJsDoc.numPages; pageIndex++) {
                            let page = null;
                            try {
                                page = await pdfJsDoc.getPage(pageIndex + 1);
                                const shouldRasterize = await isImageHeavyPdfJsPage(page);
                                if (shouldRasterize) {
                                    const raster = await renderPdfJsPageToJpegBytes(page, rasterSettings);
                                    const image = await pdfDoc.embedJpg(raster.bytes);
                                    const newPage = pdfDoc.addPage([raster.width, raster.height]);
                                    newPage.drawImage(image, {
                                        x: 0,
                                        y: 0,
                                        width: raster.width,
                                        height: raster.height
                                    });
                                    rasterizedCount += 1;
                                } else {
                                    const copiedPages = await pdfDoc.copyPages(pdfLibDoc, [pageIndex]);
                                    copiedPages.forEach((copiedPage) => {
                                        pdfDoc.addPage(copiedPage);
                                    });
                                }
                            } catch (error) {
                                const shouldSkip = promptSkipFile(file, error);
                                if (shouldSkip) {
                                    skippedCount += 1;
                                    markFileIssue(file, 'Skipped due to read error');
                                    if (isExpanded) {
                                        renderPdfList();
                                        updateDocCount();
                                        updateExpandedMergeButton();
                                    }
                                    reportMergeError(error, {
                                        mode: isExpanded ? 'expanded' : 'simple',
                                        step: 'mergePDFs-rasterize-skip',
                                        fileCount: files?.length || 0,
                                        totalBytes: stats.totalBytes,
                                        maxBytes: stats.maxBytes,
                                        durationMs: performance.now() - mergeStart,
                                        source: 'pdfjs-raster',
                                        userNote: 'user_action=skip'
                                    });
                                    skipCurrentFile = true;
                                    break;
                                }
                                throw error;
                            } finally {
                                processedPages += 1;
                                if (statusElement && totalPages > 0 && (processedPages % 10 === 0 || processedPages === totalPages)) {
                                    statusElement.innerHTML = '<span>Compressing pages... ' + processedPages + '/' + totalPages + '</span>';
                                }
                            }
                        }

                        if (typeof pdfJsDoc?.cleanup === 'function') {
                            pdfJsDoc.cleanup();
                        }
                        if (typeof pdfJsDoc?.destroy === 'function') {
                            pdfJsDoc.destroy();
                        }

                        if (skipCurrentFile) {
                            continue;
                        }
                    }

                    if (rasterizedCount === 0) {
                        compressionNote = 'Note: No image-heavy pages found; compression is minimal.';
                    }
                } else {
                    // Pipeline file loading: while current file is being copied,
                    // the next file is already reading/parsing in the background.
                    const loadPdfForMerge = async (file) => {
                        const arrayBuffer = await readFileAsArrayBuffer(file);
                        const pdf = await loadPdfLibDocument(arrayBuffer);
                        return pdf;
                    };
                    const loadPdfForMergeWrapped = (file) => (
                        loadPdfForMerge(file).then(
                            (pdf) => ({ pdf, error: null }),
                            (error) => ({ pdf: null, error })
                        )
                    );

                    let currentLoadPromise = files.length > 0 ? loadPdfForMergeWrapped(files[0]) : null;

                    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                        const file = files[fileIndex];
                        const nextLoadPromise = (fileIndex + 1) < files.length
                            ? loadPdfForMergeWrapped(files[fileIndex + 1])
                            : null;
                        try {
                            const loaded = currentLoadPromise
                                ? await currentLoadPromise
                                : { pdf: null, error: new Error('Failed to load file') };
                            if (loaded.error) {
                                throw loaded.error;
                            }
                            const pdf = loaded.pdf;
                            if (!pdf) {
                                throw new Error('Failed to parse PDF');
                            }
                            const copiedPages = await pdfDoc.copyPages(pdf, pdf.getPageIndices());
                            copiedPages.forEach((page) => {
                                pdfDoc.addPage(page);
                            });
                        } catch (error) {
                            if (isPdfLibRecoverableFailure(error)) {
                                try {
                                    ensurePdfJsWorker();
                                    const arrayBuffer = await readFileAsArrayBuffer(file);
                                    const pdfJsDoc = await pdfjsLib.getDocument(getPdfJsDocOptions(arrayBuffer)).promise;
                                    for (let pageIndex = 0; pageIndex < pdfJsDoc.numPages; pageIndex++) {
                                        const page = await pdfJsDoc.getPage(pageIndex + 1);
                                        const raster = await renderPdfJsPageToJpegBytes(page, rasterSettings);
                                        const image = await pdfDoc.embedJpg(raster.bytes);
                                        const newPage = pdfDoc.addPage([raster.width, raster.height]);
                                        newPage.drawImage(image, {
                                            x: 0,
                                            y: 0,
                                            width: raster.width,
                                            height: raster.height
                                        });
                                    }
                                    if (typeof pdfJsDoc?.cleanup === 'function') {
                                        pdfJsDoc.cleanup();
                                    }
                                    if (typeof pdfJsDoc?.destroy === 'function') {
                                        pdfJsDoc.destroy();
                                    }
                                    compressionNote = 'Note: Some damaged PDFs were rasterized to complete merge.';
                                    continue;
                                } catch (rasterFallbackError) {
                                    error = rasterFallbackError;
                                }
                            }

                            const shouldSkip = promptSkipFile(file, error);
                            if (shouldSkip) {
                                skippedCount += 1;
                                markFileIssue(file, 'Skipped due to read error');
                                if (isExpanded) {
                                    renderPdfList();
                                    updateDocCount();
                                    updateExpandedMergeButton();
                                }
                                reportMergeError(error, {
                                    mode: isExpanded ? 'expanded' : 'simple',
                                    step: 'mergePDFs-skip',
                                    fileCount: files?.length || 0,
                                    totalBytes: stats.totalBytes,
                                    maxBytes: stats.maxBytes,
                                    durationMs: performance.now() - mergeStart,
                                    source: 'pdf-lib',
                                    userNote: 'user_action=skip'
                                });
                                continue;
                            }
                            throw error;
                        } finally {
                            currentLoadPromise = nextLoadPromise;
                        }
                    }
                }

                const pdfBytes = await pdfDoc.save({ useObjectStreams });
                downloadPDF(pdfBytes, filename);

                if (statusElement) {
                    const successMsg = skippedCount > 0
                        ? `Merged with ${skippedCount} skipped file${skippedCount !== 1 ? 's' : ''}. Download started.`
                        : 'Success! Download started.';
                    statusElement.className = 'status-area status-success';
                    const noteText = compressionNote ? ' ' + compressionNote : '';
                    statusElement.innerHTML = '<span>' + successMsg + noteText + getAffiliateInlineHtml() + '</span>';
                }

                if (typeof gtag !== 'undefined') {
                    gtag('event', 'pdf_merge_success', {
                        'mode': isExpanded ? 'expanded' : 'simple',
                        'file_count': files.length,
                        'page_count': pdfDoc.getPageCount()
                    });
                }
            } catch (error) {
                const friendlyMsg = buildMergeFailureMessage(error, {
                    fileCount: files?.length || 0,
                    totalBytes: stats.totalBytes
                }, isExpanded ? 'expanded' : 'simple');

                reportMergeError(error, {
                    mode: isExpanded ? 'expanded' : 'simple',
                    step: 'mergePDFs',
                    fileCount: files?.length || 0,
                    totalBytes: stats.totalBytes,
                    maxBytes: stats.maxBytes,
                    durationMs: performance.now() - mergeStart,
                    source: 'pdf-lib'
                });
                showError(friendlyMsg, isExpanded ? 'expandedError' : 'simpleError');
                
                if (statusElement) {
                    statusElement.className = 'status-area status-error';
                    statusElement.innerHTML = '<span>' + friendlyMsg + '</span>';
                }

                if (typeof gtag !== 'undefined') {
                    gtag('event', 'pdf_merge_error', {
                        'mode': isExpanded ? 'expanded' : 'simple',
                        'error_message': error.message
                    });
                }
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
                mergeInProgress = false;
            }
          } catch (error) {
            mergeInProgress = false;
            reportMergeError(error, {
              mode: 'unknown',
              step: 'mergePDFs-outer',
              fileCount: stats?.fileCount || 0,
              totalBytes: stats?.totalBytes || 0,
              maxBytes: stats?.maxBytes || 0,
              durationMs: performance.now() - mergeStart,
              source: 'pdf-lib'
            });
            gtag('event', 'pdf_merge_failed', {
              error_message: error?.message || 'Unknown error',
              error_type: error?.name || 'Error',
              timestamp: new Date().toISOString()
            });
            
            console.error('Merge failed:', error);
            alert('Merge failed: ' + (error?.message || 'Unknown error'));
            throw error;
          }
        }

        function isEncryptedPdfErrorSafe(err) {
            const msg = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
            return msg.includes('encrypted') ||
                msg.includes('password-protected') ||
                msg.includes('password protected') ||
                msg.includes('no password') ||
                msg.includes('password required') ||
                msg.includes('password');
        }

        function isFileReadErrorSafe(err) {
            const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
            return text.includes('notreadableerror') ||
                text.includes('could not be read') ||
                text.includes('permission') ||
                text.includes('securityerror') ||
                text.includes('notfounderror') ||
                text.includes('could not be found') ||
                text.includes('not found') ||
                text.includes('aborterror') ||
                text.includes('the operation was aborted') ||
                text.includes('aborted');
        }

        function isMemoryErrorSafe(err) {
            const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
            return text.includes('array buffer allocation failed') ||
                text.includes('out of memory') ||
                text.includes('rangeerror');
        }

        function isCorruptPdfErrorSafe(err) {
            const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
            return text.includes('invalid pdf structure') ||
                text.includes('no pdf header') ||
                text.includes('failed to parse') ||
                text.includes('traverse is not a function') ||
                text.includes('xref') ||
                text.includes('corrupt');
        }

        function buildMergeFailureMessage(error, stats = {}, mode = 'simple') {
            const isEncrypted = isEncryptedPdfErrorSafe(error);
            const isMemory = isMemoryErrorSafe(error);
            const isFileRead = isFileReadErrorSafe(error);
            const isCorrupt = isCorruptPdfErrorSafe(error);
            const fileCount = Number.isFinite(stats?.fileCount) ? stats.fileCount : null;
            const totalBytes = Number.isFinite(stats?.totalBytes) ? stats.totalBytes : null;
            const sizeHint = totalBytes ? ` (${formatFileSize(totalBytes)})` : '';

            if (isEncrypted) {
                return 'Locked PDF. Unlock and try again.';
            }
            if (isCorrupt) {
                return 'Not a valid PDF. Try another file.';
            }
            if (isMemory) {
                return `Too large to merge${sizeHint}. Try fewer files/pages.`;
            }
            if (isFileRead) {
                return "Can't read a file. Re-select files.";
            }
            const countNote = fileCount ? ` (${fileCount} files)` : '';
            return `Merge failed${countNote}. Try again.`;
        }

        function classifyMergeErrorKind(err) {
            if (isEncryptedPdfErrorSafe(err)) return 'encrypted';
            if (isCorruptPdfErrorSafe(err)) return 'corrupt';
            if (isFileReadErrorSafe(err)) return 'file_read';
            if (isMemoryErrorSafe(err)) return 'memory';
            return 'unexpected';
        }

        function reportMergeError(err, meta = {}) {
            if (typeof window.reportError !== 'function') return;
            try {
                const userNote = String(meta.userNote || '');
                // Skip telemetry for deliberate user skip actions; these are handled flows.
                if (userNote.includes('user_action=skip')) return;
                const throttles = window.__MERGE_ERROR_THROTTLE || (window.__MERGE_ERROR_THROTTLE = {});
                const key = `${meta.mode || 'n/a'}|${meta.step || 'n/a'}|${err?.message || ''}`;
                const now = Date.now();
                const last = throttles[key] || 0;
                if (now - last < 2000) return; // throttle duplicates within 2s
                throttles[key] = now;

                const note = [
                    `mode=${meta.mode || 'n/a'}`,
                    `step=${meta.step || 'n/a'}`,
                    `files=${Number.isFinite(meta.fileCount) ? meta.fileCount : 'n/a'}`,
                    typeof meta.pageCount === 'number' ? `pages=${meta.pageCount}` : null,
                    `error=${err?.name || 'Error'}`,
                    `kind=${classifyMergeErrorKind(err)}`,
                    `source=${meta.source || detectErrorSource(err)}`,
                    Number.isFinite(meta.totalBytes) ? `totalBytes=${meta.totalBytes}` : null,
                    Number.isFinite(meta.maxBytes) ? `maxBytes=${meta.maxBytes}` : null,
                    Number.isFinite(meta.durationMs) ? `durationMs=${Math.round(meta.durationMs)}` : null,
                    meta.libraryVersion ? `libVer=${meta.libraryVersion}` : null,
                    userNote ? `note=${userNote}` : null
                ].filter(Boolean).join(';');

                window.reportError(err, {
                    feature: 'pdf_merge',
                    userNote: note
                });
            } catch (reportErr) {
                console.warn('reportMergeError failed', reportErr);
            }
        }

        function detectErrorSource(err) {
            const txt = `${err?.stack || ''} ${err?.message || ''}`.toLowerCase();
            if (txt.includes('pdf-lib')) return 'pdf-lib';
            if (txt.includes('pdfjs') || txt.includes('pdf.js')) return 'pdf.js';
            return 'unknown';
        }

        function getFileStats(files = []) {
            try {
                const list = Array.from(files || []).filter(Boolean);
                const totalBytes = list.reduce((sum, f) => sum + (typeof f.size === 'number' ? f.size : 0), 0);
                const maxBytes = list.reduce((max, f) => {
                    const size = typeof f.size === 'number' ? f.size : 0;
                    return size > max ? size : max;
                }, 0);
                return { totalBytes, maxBytes, fileCount: list.length };
            } catch (e) {
                return { totalBytes: 0, maxBytes: 0, fileCount: 0 };
            }
        }

        function isMergeTooLarge(stats) {
            return Number.isFinite(stats?.totalBytes) && stats.totalBytes > MERGE_HARD_LIMIT_BYTES;
        }

        function buildMergeTooLargeMessage(stats) {
            const total = formatFileSize(stats?.totalBytes || 0);
            return `Total file size (${total}) is too large to merge in the browser. Try fewer or smaller PDFs.`;
        }

        async function hasPdfHeader(file) {
            try {
                const header = await file.slice(0, 5).arrayBuffer();
                const text = new TextDecoder('ascii').decode(header);
                return text.startsWith('%PDF-');
            } catch (e) {
                return false;
            }
        }

        function queueEncryptionScan(file, targetId, mode, inputId) {
            if (!file || mergeInProgress) return;
            if (encryptionScanResults.has(file)) return;

            setTimeout(async () => {
                if (mergeInProgress) return;
                const isEncrypted = await scanEncryptedPdf(file);
                encryptionScanResults.set(file, isEncrypted);
                if (!isEncrypted || mergeInProgress) return;

                if (mode === 'expanded' && !expandedFiles.includes(file)) return;
                if (mode === 'simple') {
                    const current = document.getElementById(inputId)?.files?.[0];
                    if (current !== file) return;
                }

                markFileIssue(file, 'Locked PDF');
                if (mode === 'expanded') {
                    renderPdfList();
                    updateDocCount();
                    updateExpandedMergeButton();
                    primeAdvancedMergeIfReady(expandedFiles);
                }
                if (encryptedWarningShown[mode]) return;
                encryptedWarningShown[mode] = true;
                showError('Locked PDF. Unlock to merge.', targetId);
            }, 0);
        }

        async function scanEncryptedPdf(file) {
            try {
                const first = await file.slice(0, ENCRYPTION_SCAN_BYTES).arrayBuffer();
                if (bufferHasEncrypt(first)) return true;
                if (file.size > ENCRYPTION_SCAN_BYTES) {
                    const start = Math.max(0, file.size - ENCRYPTION_SCAN_BYTES);
                    const last = await file.slice(start).arrayBuffer();
                    if (bufferHasEncrypt(last)) return true;
                }
            } catch (e) {
                return false;
            }
            return false;
        }

        function bufferHasEncrypt(buffer) {
            try {
                const text = new TextDecoder('ascii').decode(buffer);
                return text.includes('/Encrypt');
            } catch (e) {
                return false;
            }
        }

        function hasKnownEncryptedFile(files = []) {
            try {
                return Array.from(files || []).some((file) => file && encryptionScanResults.get(file) === true);
            } catch (e) {
                return false;
            }
        }

        function downloadPDF(pdfBytes, filename) {
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
        }

        // Inline HTML onclick handlers need these on window even if script scope changes.
        Object.assign(window, {
            toggleMode,
            clearSimpleFile,
            removeExpandedFile,
            openAdvancedSortFromSimple,
            openAdvancedSort,
            closeAdvancedSort,
            resetPageOrder,
            finalizeAdvancedMerge,
            mergePDFs
        });

        // ===== MODAL BACKDROP CLOSE =====
        document.addEventListener('DOMContentLoaded', () => {
            setupSimpleFileInputs();
            setupExpandedFileInputs();
            setupFilenameInputs();
            setupAdvancedCompressionControls();

            const modal = document.getElementById('advancedMergeModal');
            
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        closeAdvancedSort();
                    }
                });

                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && modal.classList.contains('active')) {
                        closeAdvancedSort();
                    }
                });
            }
        });
