// Year in footer
const yearSpan = document.getElementById('yearSpan');
if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
}

function scrollToTopAndFocus() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
        const btn = document.getElementById('simpleMergeBtn');
        if (btn) btn.focus();
    }, 600);
}

let expandedFiles = [];

// ===== MODE SWITCHING =====
function switchMode(mode) {
    const simpleMode = document.getElementById('simpleMode');
    const expandedMode = document.getElementById('expandedMode');
    const simpleBtn = document.getElementById('simpleModeBtn');
    const expandedBtn = document.getElementById('expandedModeBtn');

    if (mode === 'simple') {
        simpleMode.classList.add('active');
        expandedMode.classList.remove('active');
        simpleBtn.classList.add('active');
        expandedBtn.classList.remove('active');
        simpleBtn.setAttribute('aria-selected', 'true');
        expandedBtn.setAttribute('aria-selected', 'false');
    } else {
        simpleMode.classList.remove('active');
        expandedMode.classList.add('active');
        simpleBtn.classList.remove('active');
        expandedBtn.classList.add('active');
        simpleBtn.setAttribute('aria-selected', 'false');
        expandedBtn.setAttribute('aria-selected', 'true');
    }
}

function toggleMode() {
    switchMode('expanded');
    const file1 = document.getElementById('file1').files[0];
    const file2 = document.getElementById('file2').files[0];

    if (file1) expandedFiles.push(file1);
    if (file2) expandedFiles.push(file2);

    renderExpandedFileList();
    updateExpandedMergeButton();
}

// ===== SIMPLE MODE FILE HANDLING =====
function handleSimpleFileSelect(file, displayId, inputId) {
    const display = document.getElementById(displayId);

    if (!file || file.type !== 'application/pdf') {
        showError('Please select a valid PDF file.', 'simpleError');
        return;
    }

    const errorElement = document.getElementById('simpleError');
    errorElement.classList.remove('show');

    display.innerHTML = `
        <div class="file-display-inner">
            <div class="file-display-icon">📄</div>
            <div class="file-display-details">
                <div class="file-display-name">${file.name}</div>
                <div class="file-display-meta">
                    <span>${formatFileSize(file.size)}</span>
                </div>
            </div>
            <button class="file-remove-btn" onclick="clearSimpleFile('${displayId}', '${inputId}')">✕</button>
        </div>
    `;
    display.classList.add('has-file');
    updateSimpleMergeButton();
}

function clearSimpleFile(displayId, inputId) {
    const display = document.getElementById(displayId);
    const input = document.getElementById(inputId);

    if (input) {
        input.value = '';
    }
    display.innerHTML = `
        <div class="file-input-icon">📄</div>
        <div class="file-input-text">Click or drag PDF here</div>
        <div class="file-input-subtext">Any file size</div>
    `;
    display.classList.remove('has-file');
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

    if (hasFiles) {
        const input = document.getElementById('simpleFilename');
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
    } else if (btn) {
        btn.textContent = '⚡ Merge & Download';
    }

    checkMemoryWarning(files, 'simpleWarning');
}

function setupSimpleFileInputs() {
    const file1Input = document.getElementById('file1');
    const file2Input = document.getElementById('file2');
    const display1 = document.getElementById('display1');
    const display2 = document.getElementById('display2');

    [file1Input, file2Input].forEach((input, index) => {
        const display = index === 0 ? display1 : display2;
        const displayId = index === 0 ? 'display1' : 'display2';

        input.addEventListener('change', (e) => {
            handleSimpleFileSelect(e.target.files[0], displayId, input.id);
        });

        display.addEventListener('dragover', (e) => {
            e.preventDefault();
            display.style.borderColor = '#2563eb';
            display.style.backgroundColor = 'rgba(37, 99, 235, 0.04)';
        });

        display.addEventListener('dragleave', () => {
            display.style.borderColor = 'var(--border-subtle)';
            display.style.backgroundColor = 'transparent';
        });

        display.addEventListener('drop', (e) => {
            e.preventDefault();
            display.style.borderColor = 'var(--border-subtle)';
            display.style.backgroundColor = 'transparent';

            if (e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                input.files = e.dataTransfer.files;
                handleSimpleFileSelect(file, displayId, input.id);
            }
        });

        display.addEventListener('click', () => {
            input.click();
        });

        display.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.click();
            }
        });
    });
}

// ===== EXPANDED MODE FILE HANDLING =====
function setupExpandedFileInputs() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('expandedFileInput');

    fileInput.addEventListener('change', (e) => {
        handleExpandedFileSelect(e.target.files);
        e.target.value = '';
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleExpandedFileSelect(e.dataTransfer.files);
    });

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });
}

function handleExpandedFileSelect(files) {
    const errorElement = document.getElementById('expandedError');
    errorElement.classList.remove('show');

    for (let file of files) {
        if (file.type !== 'application/pdf') {
            showError('Skipped non-PDF file: ' + file.name, 'expandedError');
            continue;
        }

        expandedFiles.push(file);
    }

    renderExpandedFileList();
    updateExpandedMergeButton();
}

function renderExpandedFileList() {
    const fileList = document.getElementById('fileList');
    const fileCountLabel = document.getElementById('fileCountLabel');
    const summaryFileCount = document.getElementById('summaryFileCount');
    const summaryFileSize = document.getElementById('summaryFileSize');

    fileList.innerHTML = '';

    let totalSize = 0;
    expandedFiles.forEach((file, index) => {
        totalSize += file.size;
        const li = document.createElement('li');
        li.className = 'file-list-item';
        li.innerHTML = `
            <div class="file-list-info">
                <span class="file-list-name">${file.name}</span>
                <span class="file-list-size">${formatFileSize(file.size)}</span>
            </div>
            <button class="file-remove-btn small" onclick="removeExpandedFile(${index})">✕</button>
        `;
        fileList.appendChild(li);
    });

    fileCountLabel.textContent = `${expandedFiles.length} file${expandedFiles.length === 1 ? '' : 's'}`;
    summaryFileCount.textContent = expandedFiles.length.toString();
    summaryFileSize.textContent = (totalSize / (1024 * 1024)).toFixed(1) + ' MB';
}

function removeExpandedFile(index) {
    expandedFiles.splice(index, 1);
    renderExpandedFileList();
    updateExpandedMergeButton();
}

function updateExpandedMergeButton() {
    const advBtn = document.getElementById('advancedSortBtn');
    const mergeBtn = document.getElementById('expandedMergeBtn');

    const hasFiles = expandedFiles.length >= 2;

    advBtn.disabled = !hasFiles;
    mergeBtn.disabled = !hasFiles;

    if (hasFiles) {
        const input = document.getElementById('expandedFilename');
        let filename;

        if (input) {
            if (!input.dataset.userEdited) {
                input.value = generateDefaultFilename(expandedFiles);
            }
            filename = getFinalFilename(input.value, expandedFiles);
        } else {
            filename = generateDefaultFilename(expandedFiles);
        }

        updateExpandedMergeButtonLabel(filename);
    } else if (mergeBtn) {
        mergeBtn.textContent = 'Merge & Download';
    }

    checkMemoryWarning(expandedFiles, 'expandedWarning');
}

// ===== UTILITIES =====
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showError(message, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
}

function checkMemoryWarning(files, elementId) {
    const warning = document.getElementById(elementId);
    if (!warning) return;

    const totalSize = files.reduce((sum, f) => sum + (f ? f.size : 0), 0);

    if (totalSize > 150 * 1024 * 1024) {
        warning.textContent = 'Large file size detected. Merge may take a moment and require significant memory.';
        warning.classList.add('show');
    } else {
        warning.classList.remove('show');
    }
}

function generateDefaultFilename(files) {
    if (files.length === 0) return 'merged.pdf';
    
    const names = files.map(f => {
        return f.name.replace(/\.pdf$/i, '').substring(0, 15);
    });

    let filename;
    if (files.length === 1) {
        filename = `${names[0]}_merged.pdf`;
    } else if (files.length === 2) {
        filename = `${names[0]}_${names[1]}_merged.pdf`;
    } else {
        filename = `${names[0]}_${names[1]}_more_files_merged.pdf`;
    }

    if (filename.length > 200) {
        const safeLength = 200 - "_more_files_merged.pdf".length;
        filename = names[0].substring(0, safeLength) + "_more_files_merged.pdf";
    }

    return filename;
}

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

// ===== ADVANCED MERGE ENTRY POINTS =====
function openAdvancedSortFromSimple() {
    const file1 = document.getElementById('file1').files[0];
    const file2 = document.getElementById('file2').files[0];

    if (!file1 || !file2) {
        alert('Please select 2 PDF files first');
        return;
    }

    expandedFiles = [file1, file2];
    openAdvancedSort();
}

function openAdvancedSortDirect() {
    if (expandedFiles.length < 1) {
        alert('Please add at least one PDF file first in "Merge Many PDFs" mode.');
        switchMode('expanded');
        return;
    }
    openAdvancedSort();
}

function openAdvancedSort() {
    if (!expandedFiles || expandedFiles.length === 0) {
        alert('Please add at least one PDF file first.');
        return;
    }

    const modal = document.getElementById('advancedMergeModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    const container = document.getElementById('advancedMergeContainer');
    container.innerHTML = '';

    loadPagesForAdvancedMerge(expandedFiles, container);
}

function closeAdvancedSort() {
    const modal = document.getElementById('advancedMergeModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

async function loadPagesForAdvancedMerge(files, container) {
    container.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner" aria-hidden="true"></div>
            <p>Loading pages...</p>
        </div>
    `;

    try {
        // This uses the AdvancedPDFMerger logic from advanced-pdf-merger.js
        await initializeAdvancedMerge(files, container);
    } catch (error) {
        console.error('Error loading pages for advanced merge:', error);
        container.innerHTML = `<p class="error-message show">Error loading pages: ${error.message}</p>`;
    }
}

async function mergePages() {
    try {
        const orderedPages = collectAdvancedMergeOrder();
        const customName = document.getElementById('customFilename').value.trim();
        
        if (!orderedPages || orderedPages.length === 0) {
            alert('No pages to merge. Please make sure you have selected pages.');
            return;
        }

        const pdfDoc = await PDFLib.PDFDocument.create();

        const fileMap = new Map();
        orderedPages.forEach(item => {
            if (!fileMap.has(item.fileIndex)) {
                fileMap.set(item.fileIndex, expandedFiles[item.fileIndex]);
            }
        });

        const pdfDocs = {};
        for (let [index, file] of fileMap.entries()) {
            const arrayBuffer = await file.arrayBuffer();
            pdfDocs[index] = await PDFLib.PDFDocument.load(arrayBuffer);
        }

        for (let pageInfo of orderedPages) {
            const sourceDoc = pdfDocs[pageInfo.fileIndex];
            const [copiedPage] = await pdfDoc.copyPages(sourceDoc, [pageInfo.pageIndex]);
            pdfDoc.addPage(copiedPage);
        }

        const mergedPdfBytes = await pdfDoc.save();
        const filename = customName || generateDefaultFilename(expandedFiles);
        const finalFilename = filename.toLowerCase().endsWith('.pdf') ? filename : filename + '.pdf';

        downloadPDF(mergedPdfBytes, finalFilename);
        closeAdvancedSort();
    } catch (error) {
        console.error('Error merging pages:', error);
        alert('Error merging pages: ' + error.message);
    }
}

// ===== BASIC MERGE (SIMPLE + EXPANDED) =====
async function mergePDFs() {
  try {
    const isExpanded = document.getElementById('expandedMode').classList.contains('active');
    const files = isExpanded 
        ? expandedFiles 
        : [document.getElementById('file1').files[0], document.getElementById('file2').files[0]].filter(Boolean);

    if (files.length < 2) return;

    const btn = isExpanded ? document.getElementById('expandedMergeBtn') : document.getElementById('simpleMergeBtn');
    btn.classList.add('loading');
    btn.disabled = true;

    const statusElement = isExpanded ? null : document.getElementById('simpleStatus');
    if (statusElement) {
        statusElement.className = 'status-area status-processing';
        statusElement.innerHTML = '<span>⏳ Processing...</span>';
    }

    try {
        let filename;
        if (isExpanded) {
            const input = document.getElementById('expandedFilename');
            filename = getFinalFilename(input ? input.value : '', files);
        } else {
            const input = document.getElementById('simpleFilename');
            filename = getFinalFilename(input ? input.value : '', files);
        }
        
        const pdfDoc = await PDFLib.PDFDocument.create();

        for (const file of files) {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await PDFLib.PDFDocument.load(arrayBuffer);
            const copiedPages = await pdfDoc.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => {
                pdfDoc.addPage(page);
            });
        }

        const pdfBytes = await pdfDoc.save();
        downloadPDF(pdfBytes, filename);

        if (statusElement) {
            statusElement.className = 'status-area status-success';
            statusElement.innerHTML = '<span>✓ Success! Download started</span>';
        }

        if (typeof gtag !== 'undefined') {
            gtag('event', 'pdf_merge_success', {
                'mode': isExpanded ? 'expanded' : 'simple',
                'file_count': files.length,
                'page_count': pdfDoc.getPageCount()
            });
        }
    } catch (error) {
        showError('Error merging PDFs: ' + error.message, isExpanded ? 'expandedError' : 'simpleError');
        
        if (statusElement) {
            statusElement.className = 'status-area status-error';
            statusElement.innerHTML = '<span>✖ Error: ' + error.message + '</span>';
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
    }
  } catch (outerError) {
    console.error('Unexpected error in mergePDFs:', outerError);
  }
}

// ===== DOWNLOAD HELPERS =====
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

// ===== FILENAME INPUT HANDLERS =====
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

            const files = expandedFiles || [];
            if (!files.length) return;

            const filename = getFinalFilename(expandedInput.value, files);
            updateExpandedMergeButtonLabel(filename);
        });
    }
}

// ===== MODAL BACKDROP & ESC CLOSE =====
document.addEventListener('DOMContentLoaded', () => {
    setupSimpleFileInputs();
    setupExpandedFileInputs();
    setupFilenameInputs();

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
