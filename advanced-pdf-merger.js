/**
 * AdvancedPDFMerger
 * Modular system for extracting, displaying, and reordering PDF pages with drag-and-drop
 * Clean, efficient, and robust
 */

const __reportedErrorKeys = new Set();

const safeReportError = (err, context = {}) => {
  if (typeof window === 'undefined' || typeof window.reportError !== 'function') return;
  try {
    const noteKey = String(context?.userNote || '').slice(0, 120);
    const key = `${context?.feature || 'unknown'}|${err?.name || 'Error'}|${err?.message || ''}|${noteKey}`;
    if (__reportedErrorKeys.has(key)) return;
    if (__reportedErrorKeys.size > 200) __reportedErrorKeys.clear();
    __reportedErrorKeys.add(key);
    window.reportError(err, context);
  } catch (reportErr) {
    console.warn('reportError failed', reportErr);
  }
};

const formatWorkerStateNote = (state = {}) => {
  const note = [
    state.workerDisabled ? 'worker=disabled' : 'worker=enabled',
    state.workerFallbackUsed ? 'workerFallback=cdn' : 'workerFallback=local',
    state.workerWrapperEnabled ? 'workerWrapper=on' : 'workerWrapper=off',
    state.workerPreflighted ? 'workerPreflight=yes' : 'workerPreflight=no',
    state.workerSrc ? `workerSrc=${state.workerSrc}` : null,
    state.workerBaseSrc ? `workerBase=${state.workerBaseSrc}` : null
  ].filter(Boolean).join(';');
  return note ? `;${note}` : '';
};

const resolveAbsoluteUrl = (value) => {
  if (!value || typeof value !== 'string') return value;
  if (/^(blob:|data:|https?:|file:)/i.test(value)) return value;
  try {
    const base = (typeof window !== 'undefined' && window.location && window.location.href)
      ? window.location.href
      : (typeof self !== 'undefined' && self.location && self.location.href ? self.location.href : undefined);
    if (!base) return value;
    return new URL(value, base).toString();
  } catch (e) {
    return value;
  }
};

const getErrorText = (err) => `${err?.name || ''} ${err?.message || ''}`.toLowerCase();

const isEncryptedPdfErrorInMerger = (err) => {
  const text = getErrorText(err);
  return text.includes('encrypted') || text.includes('password');
};

const isMemoryError = (err) => {
  const text = getErrorText(err);
  return text.includes('array buffer allocation failed') ||
    text.includes('out of memory') ||
    text.includes('rangeerror');
};

const isCorruptPdfError = (err) => {
  const text = getErrorText(err);
  return text.includes('invalid pdf structure') ||
    text.includes('no pdf header') ||
    text.includes('failed to parse') ||
    text.includes('traverse is not a function') ||
    text.includes('pages(...).traverse') ||
    text.includes('xref') ||
    text.includes('corrupt');
};

const isFileAccessError = (err) => {
  const text = getErrorText(err);
  return text.includes('notreadable') ||
    text.includes('could not be read') ||
    text.includes('permission') ||
    text.includes('securityerror') ||
    text.includes('notfounderror') ||
    text.includes('could not be found') ||
    text.includes('not found') ||
    text.includes('aborterror') ||
    text.includes('abort') ||
    text.includes('aborted');
};

const delayMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WORKER_CIRCUIT_BREAKER_KEY = 'pdf-worker-disabled';

class AdvancedPDFMerger {
  constructor(options = {}) {
    // Configuration
    this.config = {
      maxPagesInMemory: 100,
      thumbnailScale: 1.2,    // lighter thumbnails for faster render
      jpegQuality: 0.7,       // lighter thumbnails for faster render
      maxPreRenderPages: 120, // cap background pre-rendering to avoid memory spikes
      ...options
    };

    // State
    this.files = [];
    this.pages = [];
    this.originalPages = [];
    this.fileOrder = [];
    this.originalFileOrder = [];
    this.pageMap = new Map(); // For efficient lookups
    this.draggedIndex = null;
    this.draggedFileOrderIndex = null;
    this.thumbnailCache = new Map();
    this.failedFileIndices = new Set();

    // Color palette for file identification
    this.fileColors = [
      '#3b82f6', // Blue
      '#10b981', // Green
      '#f59e0b', // Amber
      '#ef4444', // Red
      '#8b5cf6', // Purple
      '#6366f1'  // Indigo
    ];

    // DOM references
    this.containerEl = null;
    this.legendEl = null;
    this.legendItemsEl = null;
    this.gridEl = null;
    this.fileGridEl = null;
    this.statusEl = null;
    this.scrollContainer = null;
    this.preRenderStarted = false;
    this.cancelRender = false;
    this.dropIndicator = null;
    this.fileDropIndicator = null;
    this.tabsEl = null;
    this.viewsEl = null;
    this.pagesViewEl = null;
    this.filesViewEl = null;
    this.activeView = 'pages';
    this.workerDisabled = this.isWorkerCircuitBroken();
    this.workerBaseSrc = resolveAbsoluteUrl('/pdf.worker.min.js?v=4');
    this.workerSrc = this.workerBaseSrc;
    this.workerFallbackSrc = resolveAbsoluteUrl('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');
    this.workerFallbackUsed = false;
    this.workerWrapperEnabled = false;
    this.workerWrapperUrl = '';
    this.workerPreflighted = false;
    if (this.workerDisabled) {
      this.workerFallbackUsed = true;
      this.workerSrc = this.workerFallbackSrc;
    }
  }

  isWorkerCircuitBroken() {
    try {
      if (typeof sessionStorage === 'undefined') return false;
      return sessionStorage.getItem(WORKER_CIRCUIT_BREAKER_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  tripWorkerCircuitBreaker() {
    this.workerDisabled = true;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(WORKER_CIRCUIT_BREAKER_KEY, '1');
      }
    } catch (e) {
      // Ignore storage failures.
    }
  }

  /**
   * Initialize with uploaded files
   */
  async initialize(uploadedFiles, containerSelector) {
    this.containerEl = document.querySelector(containerSelector);
    if (!this.containerEl) {
      console.error('Container not found:', containerSelector);
      return false;
    }

    // Find the scrollable container (the modal content), fallback to the grid container itself
    this.scrollContainer = this.containerEl.closest('.advanced-merge-content') || this.containerEl;
    this.cancelRender = false;

    try {
      await this.preflightWorker();
      this.showStatus('Extracting pages from PDFs...');
      
      // Store files and extract pages
      this.files = Array.from(uploadedFiles || []).filter((file) => file && typeof file.name === 'string');
      this.fileOrder = this.files.map((_, index) => index);
      this.originalFileOrder = [...this.fileOrder];
      this.activeView = 'pages';
      this.failedFileIndices.clear();
      const extracted = await this.extractAllPages();
      if (extracted === false) {
        this.showStatus('All selected files became unavailable. Please reselect them (copy locally if needed).', 'error');
        return false;
      }
      // Warm the thumbnail cache in the background (lightweight + capped)
      this.startBackgroundThumbnailPreRender();
      
      // Render UI
      this.render();
      this.showStatus(`${this.pages.length} pages ready for reordering`);
      
      return true;
    } catch (error) {
      const friendly = this.formatUserError(error);
      this.showStatus(friendly, 'error');
      console.error('AdvancedPDFMerger init error:', error);
      safeReportError(error, {
        feature: 'AdvancedPDFMerger.initialize',
        userNote: `files=${uploadedFiles?.length || 0};totalBytes=${getFilesTotalBytes(uploadedFiles)}`
      });
      return false;
    }
  }

  onAllFilesFailed() {
    if (typeof this.config.onAllFilesFailed === 'function') {
      this.config.onAllFilesFailed();
    }
  }

  /**
   * Convert internal errors to user-facing messages (no PII/file names)
   */
  formatUserError(err) {
    const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
    const isEncrypted = text.includes('encrypted') || text.includes('password');
    const isMemory = text.includes('array buffer allocation failed') ||
      text.includes('out of memory') ||
      text.includes('rangeerror');
    const isCorrupt = text.includes('invalid pdf structure') ||
      text.includes('no pdf header') ||
      text.includes('failed to parse') ||
      text.includes('traverse is not a function') ||
      text.includes('pages(...).traverse') ||
      text.includes('xref') ||
      text.includes('corrupt');
    const isFileAccess =
      text.includes('notreadable') ||
      text.includes('could not be read') ||
      text.includes('permission') ||
      text.includes('securityerror') ||
      text.includes('notfounderror') ||
      text.includes('could not be found') ||
      text.includes('not found') ||
      text.includes('abort') ||
      text.includes('aborted');

    if (isEncrypted) {
      return 'Locked PDF. Unlock it and try again.';
    }

    if (isCorrupt) {
      return 'Not a valid PDF. Try another file.';
    }

    if (isMemory) {
      return 'Too large to preview. Try fewer files/pages.';
    }

    if (isFileAccess) {
      return 'Can’t read this file. Re‑select it.';
    }

    return `Error: ${err?.message || 'Something went wrong'}`;
  }

  classifyFileErrorKind(err) {
    if (isEncryptedPdfErrorInMerger(err)) return 'encrypted';
    if (isCorruptPdfError(err)) return 'corrupt';
    if (isFileAccessError(err)) return 'file_access';
    if (isMemoryError(err)) return 'memory';
    return 'unexpected';
  }

  async readFileArrayBuffer(file) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await file.arrayBuffer();
      } catch (error) {
        lastError = error;
        if (!isFileAccessError(error) || attempt === 1) {
          break;
        }
        await delayMs(120);
      }
    }

    if (isFileAccessError(lastError) && typeof FileReader !== 'undefined') {
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

  setWorkerSrc(baseSrc) {
    const resolvedBaseSrc = resolveAbsoluteUrl(baseSrc);
    this.workerBaseSrc = resolvedBaseSrc;
    if (this.workerWrapperUrl && this.workerWrapperUrl.startsWith('blob:') &&
        typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(this.workerWrapperUrl);
      this.workerWrapperUrl = '';
    }
    if (this.workerWrapperEnabled) {
      this.workerWrapperUrl = this.buildWorkerWrapperUrl(resolvedBaseSrc);
      this.workerSrc = this.workerWrapperUrl;
      return;
    }
    this.workerSrc = resolvedBaseSrc;
  }

  enableWorkerWrapper() {
    if (this.workerWrapperEnabled) return;
    this.workerWrapperEnabled = true;
    this.setWorkerSrc(this.workerBaseSrc);
  }

  configurePdfJsWorker() {
    if (typeof pdfjsLib === 'undefined') return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = this.workerSrc;
    pdfjsLib.disableWorker = !!this.workerDisabled;
    if (typeof pdfjsLib.setVerbosityLevel === 'function') {
      const level = pdfjsLib.VerbosityLevel?.ERRORS;
      if (typeof level === 'number') {
        pdfjsLib.setVerbosityLevel(level);
      }
    }
  }

  resetPdfJsWorkerState() {
    if (typeof pdfjsLib === 'undefined') return;
    try {
      if (pdfjsLib.GlobalWorkerOptions && 'workerPort' in pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerPort = null;
      }
    } catch (e) {
      // Ignore reset failures.
    }
    try {
      const PDFWorker = pdfjsLib.PDFWorker;
      if (PDFWorker && typeof PDFWorker._resetGlobalState === 'function') {
        PDFWorker._resetGlobalState();
        return;
      }
      if (PDFWorker && Object.prototype.hasOwnProperty.call(PDFWorker, '_setupFakeWorkerGlobal')) {
        PDFWorker._setupFakeWorkerGlobal = null;
      }
    } catch (e) {
      // Ignore reset failures.
    }
  }

  async preflightWorker() {
    if (this.workerPreflighted) return;
    this.workerPreflighted = true;
    if (this.workerDisabled) {
      if (!this.workerFallbackUsed && this.workerBaseSrc !== this.workerFallbackSrc) {
        this.workerFallbackUsed = true;
        this.setWorkerSrc(this.workerFallbackSrc);
      }
      this.configurePdfJsWorker();
      return;
    }
    if (this.isLegacySafari()) {
      this.enableWorkerWrapper();
    }

    const baseOk = await this.probeWorkerSource(this.workerBaseSrc);
    if (baseOk) {
      this.setWorkerSrc(this.workerBaseSrc);
      this.configurePdfJsWorker();
      return;
    }

    const fallbackOk = await this.probeWorkerSource(this.workerFallbackSrc);
    if (fallbackOk) {
      this.workerFallbackUsed = true;
      this.setWorkerSrc(this.workerFallbackSrc);
      this.configurePdfJsWorker();
      return;
    }

    this.workerDisabled = true;
    this.tripWorkerCircuitBreaker();
    // Keep a known-good URL here so fake-worker mode won't keep retrying local path.
    this.setWorkerSrc(this.workerFallbackSrc);
    this.resetPdfJsWorkerState();
    this.configurePdfJsWorker();
  }

  async probeWorkerSource(url) {
    const resolvedUrl = resolveAbsoluteUrl(url);
    const reachable = await this.checkWorkerUrl(resolvedUrl);
    if (!reachable) return false;

    // If Worker API is unavailable, rely on fetch probe only.
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' ||
        typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return true;
    }

    // Detect importScripts/runtime failures up-front to avoid noisy fake-worker errors.
    let wrapperUrl = '';
    let worker = null;
    try {
      const escaped = JSON.stringify(resolvedUrl);
      const code = `self.onmessage=function(){};importScripts(${escaped});self.postMessage('ok');`;
      wrapperUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      const ok = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          try { if (worker) worker.terminate(); } catch (e) {}
          resolve(false);
        }, 1800);
        worker = new Worker(wrapperUrl);
        worker.onmessage = () => {
          clearTimeout(timeout);
          try { worker.terminate(); } catch (e) {}
          resolve(true);
        };
        worker.onerror = (event) => {
          try { event?.preventDefault?.(); } catch (e) {}
          clearTimeout(timeout);
          try { worker.terminate(); } catch (e) {}
          resolve(false);
        };
      });
      return ok;
    } catch (err) {
      return false;
    } finally {
      if (wrapperUrl) {
        try { URL.revokeObjectURL(wrapperUrl); } catch (e) {}
      }
    }
  }

  async checkWorkerUrl(url) {
    if (!url) return false;
    if (url.startsWith('blob:')) return true;
    if (typeof fetch !== 'function') return true;

    let controller = null;
    let timeoutId = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 1500);
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });

      if (timeoutId) clearTimeout(timeoutId);
      if (!response.ok) return false;

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html')) return false;
      if (contentType.includes('javascript')) return true;
      if (contentType && !contentType.startsWith('text/')) return true;

      const text = await response.text();
      const trimmed = text.trimStart();
      if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || trimmed.startsWith('<')) return false;
      return true;
    } catch (err) {
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  shouldDisableWorker(err) {
    const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
    return text.includes('importscripts') ||
      text.includes('failed to load') ||
      text.includes('worker') && text.includes('failed') ||
      text.includes('networkerror') ||
      text.includes('setting up fake worker failed') ||
      text.includes('cannot load script') ||
      text.includes('unexpected token');
  }

  async loadPdfDocument(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('pdf.js is not available');
    }
    const verbosityLevel = pdfjsLib?.VerbosityLevel?.ERRORS;
    const docOptions = (typeof verbosityLevel === 'number')
      ? { data: arrayBuffer, verbosity: verbosityLevel }
      : { data: arrayBuffer };
    if (this.isLegacySafari()) {
      this.enableWorkerWrapper();
    }
    this.configurePdfJsWorker();
    try {
      return await pdfjsLib.getDocument(docOptions).promise;
    } catch (error) {
      if (!this.workerDisabled && this.shouldDisableWorker(error)) {
        if (this.isWorkerFetchFailure(error) && !this.workerFallbackUsed && this.workerBaseSrc !== this.workerFallbackSrc) {
          this.workerFallbackUsed = true;
          this.setWorkerSrc(this.workerFallbackSrc);
          this.resetPdfJsWorkerState();
          this.configurePdfJsWorker();
          try {
            return await pdfjsLib.getDocument(docOptions).promise;
          } catch (fallbackError) {
            if (!this.shouldDisableWorker(fallbackError)) {
              throw fallbackError;
            }
          }
        }

        this.tripWorkerCircuitBreaker();
        this.setWorkerSrc(this.workerFallbackSrc);
        this.resetPdfJsWorkerState();
        this.configurePdfJsWorker();
        return await pdfjsLib.getDocument(docOptions).promise;
      }
      throw error;
    }
  }

  isWorkerFetchFailure(err) {
    const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
    return text.includes('unexpected token') ||
      text.includes('text/html') ||
      text.includes('workermessagehandler') ||
      text.includes('setting up fake worker failed') ||
      text.includes('cannot load script');
  }

  isLegacySafari() {
    try {
      const ua = navigator.userAgent || '';
      if (!/safari/i.test(ua) || /chrome|crios|fxios|edgios|opr|opera/i.test(ua)) return false;
      const versionMatch = ua.match(/version\/(\d+)\./i);
      const version = versionMatch ? parseInt(versionMatch[1], 10) : 0;
      return version > 0 && version < 16;
    } catch (e) {
      return false;
    }
  }

  buildWorkerWrapperUrl(workerSrc) {
    const target = resolveAbsoluteUrl(workerSrc || '/pdf.worker.min.js?v=4');
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return target;
    }
    const wrapper = `
      (function() {
        function atPolyfill(idx) {
          var len = this.length >>> 0;
          var i = Number(idx) || 0;
          if (i < 0) i = len + i;
          return this[i];
        }
        function defineAt(proto) {
          if (!proto || proto.at) return;
          try {
            Object.defineProperty(proto, 'at', {
              value: atPolyfill,
              writable: true,
              configurable: true
            });
          } catch (e) {
            proto.at = atPolyfill;
          }
        }
        defineAt(Array.prototype);
        defineAt(String.prototype);
        if (typeof Int8Array !== 'undefined') defineAt(Int8Array.prototype);
        if (typeof Uint8Array !== 'undefined') defineAt(Uint8Array.prototype);
        if (typeof Uint8ClampedArray !== 'undefined') defineAt(Uint8ClampedArray.prototype);
        if (typeof Int16Array !== 'undefined') defineAt(Int16Array.prototype);
        if (typeof Uint16Array !== 'undefined') defineAt(Uint16Array.prototype);
        if (typeof Int32Array !== 'undefined') defineAt(Int32Array.prototype);
        if (typeof Uint32Array !== 'undefined') defineAt(Uint32Array.prototype);
        if (typeof Float32Array !== 'undefined') defineAt(Float32Array.prototype);
        if (typeof Float64Array !== 'undefined') defineAt(Float64Array.prototype);
        var src = ${JSON.stringify(target)};
        if (typeof importScripts === 'function') {
          importScripts(src);
          return;
        }
        if (typeof document !== 'undefined') {
          var script = document.createElement('script');
          script.src = src;
          script.async = false;
          var parent = document.head || document.body || document.documentElement;
          if (parent) parent.appendChild(script);
        }
      })();
    `;
    return URL.createObjectURL(new Blob([wrapper], { type: 'application/javascript' }));
  }

  /**
   * Extract all pages from all uploaded files using PDF.js
   * Efficient: stores minimal data, renders thumbnails on-demand
   */
  async extractAllPages() {
    this.pages = [];
    this.originalPages = [];
    this.thumbnailCache.clear();
    this.failedFileIndices.clear();
    let readFailures = 0;

    // Set up PDF.js worker (self-hosted)
    this.configurePdfJsWorker();

    for (let fileIndex = 0; fileIndex < this.files.length; fileIndex++) {
      const file = this.files[fileIndex];
      
      try {
        const arrayBuffer = await this.readFileArrayBuffer(file);
        
        // Load PDF using PDF.js
        const pdf = await this.loadPdfDocument(arrayBuffer);
        const pageCount = pdf.numPages;

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
          const pageId = `${fileIndex}-${pageIndex}`;
          const pageData = {
            id: pageId,
            fileIndex,
            fileName: file.name,
            pageNumber: pageIndex + 1,
            totalPagesInFile: pageCount,
            pdfDoc: pdf,  // Store PDF.js document
            pageIndex: pageIndex
          };

          this.pages.push(pageData);
          this.pageMap.set(pageId, pageData);
        }
      } catch (error) {
        this.failedFileIndices.add(fileIndex);
        readFailures += 1;
        const reason = this.formatUserError(error);
        if (typeof this.config.onFileError === 'function') {
          this.config.onFileError({ fileIndex, error, reason });
        }
        if (!this.config.suppressFileErrors) {
          const workerNote = formatWorkerStateNote(this);
          const errorKind = this.classifyFileErrorKind(error);
          // Known per-file failures are handled in-product by skipping that file.
          // Avoid flooding telemetry with expected user-file issues.
          const shouldReport = !['file_access', 'corrupt', 'encrypted'].includes(errorKind);
          if (shouldReport) {
            safeReportError(error, {
              feature: 'AdvancedPDFMerger.extractAllPages',
              userNote: `fileIndex=${fileIndex};kind=${errorKind}${workerNote}`
            });
          }
        }
        console.error(`Error extracting pages from file index ${fileIndex}:`, error);
        continue;
      }
    }

    if (this.pages.length === 0) {
      if (readFailures > 0) {
        const err = new Error('No pages could be extracted from the selected files.');
        err.name = 'NoPagesExtractedError';
        this.onAllFilesFailed();
        return false;
      }
      throw new Error('No pages could be extracted from the selected files.');
    }

    // Keep an immutable snapshot to restore deleted pages on reset
    this.originalPages = this.pages.map(p => ({ ...p }));
  }

  /**
   * Render thumbnail for a page using PDF.js
   * Cached for efficiency
   */
  async renderThumbnail(pageData) {
    const cacheKey = pageData.id;

    // Return from cache if available
    if (this.thumbnailCache.has(cacheKey)) {
      return this.thumbnailCache.get(cacheKey);
    }

    try {
      // Get PDF document using PDF.js
      const pdf = pageData.pdfDoc; // This should be the PDF.js document
      
      if (!pdf) {
        throw new Error('PDF document not available');
      }

      // Get the page from PDF.js
      const page = await pdf.getPage(pageData.pageIndex + 1); // PDF.js uses 1-based indexing
      
      if (!page) {
        throw new Error('Page not found');
      }

      // Create viewport with scale
      let scale = this.config.thumbnailScale;
      const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent || '');
      if (isIOS) {
        scale = Math.min(scale, 0.85);
      }
      const viewport = page.getViewport({ scale: scale });

      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Render page to canvas
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Could not get canvas context');
      }

      // Create render task
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport
      });

      // Wait for rendering to complete
      await renderTask.promise;

      // Convert to image data URL
      const imageUrl = canvas.toDataURL('image/jpeg', this.config.jpegQuality);

      // Cache it
      this.thumbnailCache.set(cacheKey, imageUrl);

      return imageUrl;
    } catch (error) {
      // iOS Safari can intermittently throw drawImage TypeError for inline images.
      // Retry once at a lower scale before falling back to placeholder.
      try {
        const text = `${error?.name || ''} ${error?.message || ''} ${error?.stack || ''}`.toLowerCase();
        const looksLikeImagePaintFailure = text.includes('drawimage') ||
          text.includes('_scaleimage') ||
          text.includes('paintinlineimagexobject') ||
          text.includes('paintimagexobject');
        if (looksLikeImagePaintFailure && pageData?.pdfDoc) {
          const page = await pageData.pdfDoc.getPage(pageData.pageIndex + 1);
          const retryScale = 0.55;
          const viewport = page.getViewport({ scale: retryScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const context = canvas.getContext('2d');
          if (context) {
            await page.render({ canvasContext: context, viewport }).promise;
            const imageUrl = canvas.toDataURL('image/jpeg', 0.6);
            this.thumbnailCache.set(cacheKey, imageUrl);
            return imageUrl;
          }
        }
      } catch (retryError) {
        // Ignore retry failure and report original error below.
      }
      console.error(`Error rendering thumbnail for ${pageData.id}:`, error);
      const workerNote = formatWorkerStateNote(this);
      safeReportError(error, {
        feature: 'AdvancedPDFMerger.renderThumbnail',
        userNote: `page=${pageData?.id || 'unknown'}${workerNote}`
      });
      return this.createPlaceholderThumbnail();
    }
  }

  /**
   * Create placeholder when thumbnail fails
   */
  createPlaceholderThumbnail() {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 280;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, 200, 280);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Rendering...', 100, 145);
    
    return canvas.toDataURL();
  }

  /**
   * Create a draggable file card DOM element
   */
  createFileCard(fileIndex, orderIndex) {
    const file = this.files[fileIndex];
    if (!file) return null;

    const card = document.createElement('div');
    card.className = 'file-card';
    card.draggable = true;
    card.dataset.fileIndex = fileIndex;
    card.dataset.orderIndex = orderIndex;

    const color = this.fileColors[fileIndex % this.fileColors.length];
    card.style.borderColor = color;

    const pageCount = this.countPagesForFile(fileIndex);
    const failed = this.failedFileIndices.has(fileIndex);
    const suffix = failed ? ' (skipped)' : '';

    card.innerHTML = `
      <div class="file-card-content">
        <div class="file-card-order">${orderIndex + 1}</div>
        <div class="file-card-title">${this.truncateFileName(file.name, 26)}</div>
        <div class="file-card-meta">${this.formatPageCount(pageCount)}${suffix}</div>
      </div>
    `;

    card.addEventListener('dragstart', (e) => this.handleFileDragStart(e));
    card.addEventListener('dragover', (e) => this.handleFileDragOver(e));
    card.addEventListener('drop', (e) => this.handleFileDrop(e));
    card.addEventListener('dragend', () => this.handleFileDragEnd());

    return card;
  }

  /**
   * Create a draggable page card DOM element
   */
  createPageCard(pageData, index, thumbnail) {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.draggable = true;
    card.dataset.pageId = pageData.id;
    card.dataset.index = index;

    // Get color for this file
    const color = this.fileColors[pageData.fileIndex % this.fileColors.length];

    // Build HTML
    card.innerHTML = `
      <div class="page-card-content" style="background-image: url('${thumbnail}')">
        <div class="page-number">Page ${pageData.pageNumber}</div>
        <div class="file-name">${this.truncateFileName(pageData.fileName)}</div>
        <button class="page-card-delete" aria-label="Remove page" title="Remove page">×</button>
      </div>
    `;

    // Apply color border
    card.style.borderColor = color;

    // Drag event listeners
    card.addEventListener('dragstart', (e) => this.handleDragStart(e));
    card.addEventListener('dragover', (e) => this.handleDragOver(e));
    card.addEventListener('drop', (e) => this.handleDrop(e));
    card.addEventListener('dragend', () => this.handleDragEnd());

    // Touch support for mobile
    this.addTouchSupport(card);

    // Delete button
    const deleteBtn = card.querySelector('.page-card-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const currentIndex = this.getCardIndex(card);
        this.deletePage(currentIndex);
      });
    }

    return card;
  }

  /**
   * Get numeric order index from file card element
   */
  getFileCardOrderIndex(card) {
    if (!card) return null;
    const val = parseInt(card.dataset.orderIndex, 10);
    return Number.isNaN(val) ? null : val;
  }

  /**
   * Handle file drag start
   */
  handleFileDragStart(e) {
    const card = e.target.closest('.file-card');
    this.draggedFileOrderIndex = this.getFileCardOrderIndex(card);
    this.draggedIndex = null;
    this.hideDropIndicator();
    e.dataTransfer.effectAllowed = 'move';
    if (card) {
      card.style.opacity = '0.6';
    }
  }

  /**
   * Handle file drag over
   */
  handleFileDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const targetCard = e.target.closest('.file-card');
    targetCard?.classList.add('drag-over');
    this.handleFileDropIndicator(e, targetCard);
    this.handleAutoScroll(e);
  }

  /**
   * Handle file drop - Insert dragged file at target position
   */
  handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const targetCard = e.target.closest('.file-card');
    targetCard?.classList.remove('drag-over');
    this.hideFileDropIndicator();

    if (this.draggedFileOrderIndex === null || this.draggedFileOrderIndex === undefined) {
      return;
    }

    const targetIndex = this.getFileCardOrderIndex(targetCard);
    if (targetIndex === null || targetIndex === undefined) {
      return;
    }

    if (this.draggedFileOrderIndex === targetIndex) {
      return;
    }

    if (this.draggedFileOrderIndex < 0 || this.draggedFileOrderIndex >= this.fileOrder.length) {
      this.draggedFileOrderIndex = null;
      return;
    }

    if (targetIndex < 0 || targetIndex >= this.fileOrder.length) {
      this.draggedFileOrderIndex = null;
      return;
    }

    const draggedFileIndex = this.fileOrder[this.draggedFileOrderIndex];
    this.fileOrder.splice(this.draggedFileOrderIndex, 1);

    let insertIndex = targetIndex;
    insertIndex = Math.max(0, Math.min(insertIndex, this.fileOrder.length));
    this.fileOrder.splice(insertIndex, 0, draggedFileIndex);
    this.draggedFileOrderIndex = null;

    this.applyFileOrder();
  }

  /**
   * Handle file drag end
   */
  handleFileDragEnd() {
    if (this.filesViewEl) {
      this.filesViewEl.querySelectorAll('.file-card').forEach(card => {
        card.style.opacity = '1';
        card.classList.remove('drag-over');
      });
    }
    this.draggedFileOrderIndex = null;
    this.hideFileDropIndicator();
  }

  /**
   * Handle drag start
   */
  handleDragStart(e) {
    const card = e.target.closest('.page-card');
    this.draggedIndex = this.getCardIndex(card);
    this.draggedFileOrderIndex = null;
    this.hideFileDropIndicator();
    e.dataTransfer.effectAllowed = 'move';
    e.target.closest('.page-card').style.opacity = '0.6';
  }

  /**
   * Handle drag over
   */
  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const targetCard = e.target.closest('.page-card');
    targetCard?.classList.add('drag-over');
    this.handleDropIndicator(e, targetCard);
    this.handleAutoScroll(e);
  }

  /**
   * Handle drop - Insert dragged page at target position
   */
  handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const targetCard = e.target.closest('.page-card');
    targetCard?.classList.remove('drag-over');
    this.hideDropIndicator();

    // Validate indices
    if (this.draggedIndex === null || this.draggedIndex === undefined) {
      console.warn('No dragged index set');
      return;
    }

    const targetIndex = this.getCardIndex(targetCard);
    if (targetIndex === null || targetIndex === undefined) {
      console.warn('No target index');
      return;
    }

    // Don't drop on itself
    if (this.draggedIndex === targetIndex) {
      return;
    }

    // Validate indices are in range
    if (this.draggedIndex < 0 || this.draggedIndex >= this.pages.length) {
      console.warn('Invalid dragged index:', this.draggedIndex);
      this.draggedIndex = null;
      return;
    }

    if (targetIndex < 0 || targetIndex >= this.pages.length) {
      console.warn('Invalid target index:', targetIndex);
      return;
    }

    // Save the dragged page
    const draggedPage = this.pages[this.draggedIndex];

    // Remove from old position
    this.pages.splice(this.draggedIndex, 1);

    // Calculate new insert position
    let insertIndex = targetIndex;
    insertIndex = Math.max(0, Math.min(insertIndex, this.pages.length));

    // Insert at new position
    this.pages.splice(insertIndex, 0, draggedPage);

    // Clear drag state
    this.draggedIndex = null;

    // Reorder existing cards without full re-render
    this.syncGridToPages();
  }

  /**
   * Handle drag end
   */
  handleDragEnd() {
    document.querySelectorAll('.page-card').forEach(card => {
      card.style.opacity = '1';
      card.classList.remove('drag-over');
    });
    this.draggedIndex = null;
    this.hideDropIndicator();
    this.hideFileDropIndicator();
  }

  /**
   * Delete a page and refresh the grid
   */
  deletePage(index) {
    if (index < 0 || index >= this.pages.length) return;
    const page = this.pages[index];
    if (page) {
      this.pageMap.delete(page.id);
    }
    this.pages.splice(index, 1);
    if (this.gridEl) {
      const card = this.gridEl.querySelector(`.page-card[data-page-id="${page?.id}"]`);
      card?.remove();
      this.syncGridToPages();
    }
    this.updateFileCardCounts();
    this.syncLegendToOrder();
    this.showStatus('Page removed');
    this.notifyPageCountChange();
    this.hideDropIndicator();
  }

  /**
   * Auto-scroll the modal content when dragging near edges
   */
  handleAutoScroll(e) {
    const container = this.scrollContainer;
    if (!container || !e.clientY) return;

    const rect = container.getBoundingClientRect();
    const margin = 80; // px from edge to trigger scroll
    const speed = 20;  // px per dragover event
    const y = e.clientY;

    if (y < rect.top + margin && container.scrollTop > 0) {
      container.scrollTop = Math.max(0, container.scrollTop - speed);
    } else if (y > rect.bottom - margin) {
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (container.scrollTop < maxScroll) {
        container.scrollTop = Math.min(maxScroll, container.scrollTop + speed);
      }
    }
  }

  /**
   * Add touch support for mobile drag-and-drop
   */
  addTouchSupport(card) {
    let touchStartX = 0;
    let touchStartY = 0;

    card.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      this.draggedIndex = this.getCardIndex(card);
      card.style.opacity = '0.6';
    });

    card.addEventListener('touchend', () => {
      card.style.opacity = '1';
    });
  }

  /**
   * Render the entire UI
   */
  async render() {
    // Clear container
    this.containerEl.innerHTML = '';

    // Tabs for switching between page and file views
    this.renderTabs();

    // Create legend
    this.renderLegend();

    // Create view containers
    this.renderViews();

    // Create grids
    await this.renderGrid();
    this.renderFileGrid();

    // Ensure correct view is visible
    this.setActiveView(this.activeView, { suppressFocus: true });
  }

  /**
   * Render tabs to switch between page and file views
   */
  renderTabs() {
    const tabs = document.createElement('div');
    tabs.className = 'page-sorter-tabs';
    tabs.setAttribute('role', 'tablist');

    const pagesTab = document.createElement('button');
    pagesTab.type = 'button';
    pagesTab.className = 'page-sorter-tab';
    pagesTab.textContent = 'Pages';
    pagesTab.dataset.view = 'pages';
    pagesTab.id = 'pageSorterTabPages';
    pagesTab.setAttribute('role', 'tab');
    pagesTab.setAttribute('aria-controls', 'pageSorterPagesView');
    pagesTab.addEventListener('click', () => this.setActiveView('pages'));

    const filesTab = document.createElement('button');
    filesTab.type = 'button';
    filesTab.className = 'page-sorter-tab';
    filesTab.textContent = 'Files';
    filesTab.dataset.view = 'files';
    filesTab.id = 'pageSorterTabFiles';
    filesTab.setAttribute('role', 'tab');
    filesTab.setAttribute('aria-controls', 'pageSorterFilesView');
    filesTab.addEventListener('click', () => this.setActiveView('files'));

    tabs.appendChild(pagesTab);
    tabs.appendChild(filesTab);

    this.tabsEl = tabs;
    this.containerEl.appendChild(tabs);
  }

  /**
   * Render containers for pages and files views
   */
  renderViews() {
    const views = document.createElement('div');
    views.className = 'page-sorter-views';

    const pagesView = document.createElement('div');
    pagesView.className = 'page-sorter-view page-sorter-view-pages';
    pagesView.id = 'pageSorterPagesView';
    pagesView.setAttribute('role', 'tabpanel');
    pagesView.setAttribute('aria-labelledby', 'pageSorterTabPages');

    const filesView = document.createElement('div');
    filesView.className = 'page-sorter-view page-sorter-view-files';
    filesView.id = 'pageSorterFilesView';
    filesView.setAttribute('role', 'tabpanel');
    filesView.setAttribute('aria-labelledby', 'pageSorterTabFiles');

    const filesHint = document.createElement('div');
    filesHint.className = 'file-sorter-hint';
    filesHint.textContent = 'Drag files to move all their pages together.';
    filesView.appendChild(filesHint);

    views.appendChild(pagesView);
    views.appendChild(filesView);

    this.viewsEl = views;
    this.pagesViewEl = pagesView;
    this.filesViewEl = filesView;
    this.containerEl.appendChild(views);
  }

  /**
   * Switch between pages and files views without re-rendering cards
   */
  setActiveView(view, options = {}) {
    const nextView = view === 'files' ? 'files' : 'pages';
    this.activeView = nextView;

    if (this.pagesViewEl) {
      this.pagesViewEl.classList.toggle('active', nextView === 'pages');
      this.pagesViewEl.setAttribute('aria-hidden', nextView === 'pages' ? 'false' : 'true');
    }
    if (this.filesViewEl) {
      this.filesViewEl.classList.toggle('active', nextView === 'files');
      this.filesViewEl.setAttribute('aria-hidden', nextView === 'files' ? 'false' : 'true');
    }

    if (this.tabsEl) {
      const tabs = Array.from(this.tabsEl.querySelectorAll('.page-sorter-tab'));
      tabs.forEach((tab) => {
        const isActive = tab.dataset.view === nextView;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        tab.tabIndex = isActive ? 0 : -1;
      });
    }

    this.updateHeaderHint(nextView);

    if (!options.suppressFocus && this.tabsEl) {
      const activeTab = this.tabsEl.querySelector('.page-sorter-tab.active');
      activeTab?.focus({ preventScroll: true });
    }
  }

  updateHeaderHint(view) {
    const hint = document.querySelector('.advanced-merge-header-info');
    if (!hint) return;
    hint.textContent = view === 'files'
      ? 'Drag files to move all their pages together'
      : 'Drag to reorder pages from different files';
  }

  /**
   * Render file color legend
   */
  renderLegend() {
    const legend = document.createElement('div');
    legend.className = 'page-sorter-legend';

    const title = document.createElement('div');
    title.className = 'legend-title';
    title.textContent = 'Source Files:';
    legend.appendChild(title);

    const items = document.createElement('div');
    items.className = 'legend-items';
    this.legendItemsEl = items;

    legend.appendChild(items);
    this.containerEl.appendChild(legend);
    this.legendEl = legend;
    this.syncLegendToOrder();
  }

  /**
   * Update legend entries to match current file order
   */
  syncLegendToOrder() {
    if (!this.legendItemsEl) return;
    this.legendItemsEl.innerHTML = '';

    this.fileOrder.forEach((fileIndex) => {
      const file = this.files[fileIndex];
      if (!file || typeof file.name !== 'string') return;
      const item = document.createElement('div');
      item.className = 'legend-item';

      const color = this.fileColors[fileIndex % this.fileColors.length];
      const colorDot = document.createElement('div');
      colorDot.className = 'legend-color';
      colorDot.style.backgroundColor = color;

      const label = document.createElement('span');
      const pageCount = this.countPagesForFile(fileIndex);
      const failed = this.failedFileIndices.has(fileIndex);
      const suffix = failed ? ' (skipped)' : '';
      label.textContent = `${this.truncateFileName(file.name)} (${this.formatPageCount(pageCount)}${suffix})`;

      item.appendChild(colorDot);
      item.appendChild(label);
      this.legendItemsEl.appendChild(item);
    });
  }

  /**
   * Render grid of page cards with lazy thumbnail loading
   */
  async renderGrid() {
    if (!this.pagesViewEl) return;

    // Remove any existing grid
    const existingGrid = this.pagesViewEl.querySelector('.page-sorter-grid');
    if (existingGrid) {
      existingGrid.remove();
    }

    const grid = document.createElement('div');
    grid.className = 'page-sorter-grid';
    this.gridEl = grid;

    // Drop indicator for visual insertion cue
    this.dropIndicator = document.createElement('div');
    this.dropIndicator.className = 'drop-indicator hidden';
    grid.appendChild(this.dropIndicator);

    // Show status while rendering
    this.showStatus(`Loading ${this.pages.length} pages...`);

    // Create all cards with placeholders immediately (lazy loading)
    for (let i = 0; i < this.pages.length; i++) {
      const pageData = this.pages[i];
      const card = this.createPageCard(pageData, i, this.createPlaceholderThumbnail());
      card.dataset.renderingIndex = i;
      grid.appendChild(card);
    }

    this.pagesViewEl.appendChild(grid);

    // Now render thumbnails in the background, one by one
    this.cancelRender = false;
    this.renderThumbnailsInBackground(grid);

    this.notifyPageCountChange();
  }

  /**
   * Render grid of file cards for file-level reordering
   */
  renderFileGrid() {
    if (!this.filesViewEl) return;

    const existingGrid = this.filesViewEl.querySelector('.file-sorter-grid');
    if (existingGrid) {
      existingGrid.remove();
    }

    const grid = document.createElement('div');
    grid.className = 'file-sorter-grid';
    this.fileGridEl = grid;

    this.fileDropIndicator = document.createElement('div');
    this.fileDropIndicator.className = 'drop-indicator hidden';
    grid.appendChild(this.fileDropIndicator);

    this.fileOrder.forEach((fileIndex, orderIndex) => {
      const card = this.createFileCard(fileIndex, orderIndex);
      if (card) {
        grid.appendChild(card);
      }
    });

    this.filesViewEl.appendChild(grid);
  }

  /**
   * Apply the current file order to the page list (grouped by file)
   */
  applyFileOrder() {
    const pagesByFile = new Map();
    this.pages.forEach((page) => {
      if (!pagesByFile.has(page.fileIndex)) {
        pagesByFile.set(page.fileIndex, []);
      }
      pagesByFile.get(page.fileIndex).push(page);
    });

    const newPages = [];
    this.fileOrder.forEach((fileIndex) => {
      const group = pagesByFile.get(fileIndex);
      if (group && group.length) {
        newPages.push(...group);
      }
    });

    if (newPages.length !== this.pages.length) {
      const groupedIds = new Set(newPages.map(page => page.id));
      this.pages.forEach((page) => {
        if (!groupedIds.has(page.id)) {
          newPages.push(page);
        }
      });
    }

    this.pages = newPages;
    this.syncGridToPages();
    this.syncFileGridToOrder();
    this.syncLegendToOrder();
    this.showStatus('File order updated');
  }

  /**
   * Reorder existing file cards without re-rendering
   */
  syncFileGridToOrder() {
    if (!this.fileGridEl) return;
    const cards = Array.from(this.fileGridEl.querySelectorAll('.file-card'));
    const cardMap = new Map(cards.map(card => [card.dataset.fileIndex, card]));

    this.fileGridEl.querySelectorAll('.file-card').forEach(card => card.remove());
    if (this.fileDropIndicator && !this.fileDropIndicator.isConnected) {
      this.fileGridEl.appendChild(this.fileDropIndicator);
    }

    this.fileOrder.forEach((fileIndex, orderIndex) => {
      const card = cardMap.get(String(fileIndex));
      if (card) {
        card.dataset.orderIndex = orderIndex;
        const orderLabel = card.querySelector('.file-card-order');
        if (orderLabel) {
          orderLabel.textContent = `${orderIndex + 1}`;
        }
        this.fileGridEl.appendChild(card);
      }
    });

    this.updateFileCardCounts();
  }

  /**
   * Update file card page counts without rebuilding the grid
   */
  updateFileCardCounts() {
    if (!this.fileGridEl) return;
    const cards = Array.from(this.fileGridEl.querySelectorAll('.file-card'));
    cards.forEach((card) => {
      const fileIndex = parseInt(card.dataset.fileIndex, 10);
      if (!Number.isFinite(fileIndex)) return;
      const count = this.countPagesForFile(fileIndex);
      const failed = this.failedFileIndices.has(fileIndex);
      const meta = card.querySelector('.file-card-meta');
      if (meta) {
        const suffix = failed ? ' (skipped)' : '';
        meta.textContent = `${this.formatPageCount(count)}${suffix}`;
      }
    });
  }

  /**
   * Render thumbnails in background without blocking UI
   */
  async renderThumbnailsInBackground(grid) {
    for (let i = 0; i < this.pages.length; i++) {
      if (this.cancelRender) break;
      const pageData = this.pages[i];
      const card = this.gridEl?.querySelector(`.page-card[data-page-id="${pageData.id}"]`);
      if (!card) continue;

      try {
        const thumbnail = await this.renderThumbnail(pageData);
        
        // Update the card's background image
        const cardContent = card.querySelector('.page-card-content');
        if (cardContent) {
          cardContent.style.backgroundImage = `url('${thumbnail}')`;
          
          // Optional: fade in effect
          cardContent.style.opacity = '0.7';
          setTimeout(() => {
            cardContent.style.opacity = '1';
          }, 100);
        }
      } catch (error) {
        console.error(`Error rendering thumbnail ${i}:`, error);
      }

      // Update status every 10 pages
      if ((i + 1) % 10 === 0) {
        this.showStatus(`Rendering pages... ${i + 1}/${this.pages.length}`);
      }

      // Yield to browser to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.showStatus('');
  }

  /**
   * Get current page order
   * Returns array of original page data in new order
   */
  getPageOrder() {
    return this.pages;
  }

  /**
   * Reset to original order
   */
  resetOrder() {
    // Restore the original snapshot (including previously deleted pages)
    this.pages = this.originalPages.map(p => ({ ...p }));
    this.fileOrder = [...this.originalFileOrder];

    // Rebuild page map
    this.pageMap.clear();
    this.pages.forEach(p => this.pageMap.set(p.id, p));

    // Rebuild the grid
    this.renderGrid();
    this.syncFileGridToOrder();
    this.syncLegendToOrder();
    this.showStatus('Order reset to original');
    this.notifyPageCountChange();
  }

  /**
   * Utility: Truncate file name for display
   */
  truncateFileName(name, maxLength = 20) {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 3) + '...';
  }

  /**
   * Utility: Count pages for a file
   */
  countPagesForFile(fileIndex) {
    return this.pages.filter(p => p.fileIndex === fileIndex).length;
  }

  /**
   * Utility: Format page count label
   */
  formatPageCount(count) {
    const safeCount = Number.isFinite(count) ? count : 0;
    return `${safeCount} page${safeCount === 1 ? '' : 's'}`;
  }

  /**
   * Show status message
   */
  showStatus(message, type = 'info') {
    if (!this.statusEl) {
      this.statusEl = document.createElement('div');
      this.statusEl.className = 'page-sorter-status';
      this.containerEl.insertBefore(this.statusEl, this.containerEl.firstChild);
    }

    this.statusEl.textContent = message;
    this.statusEl.className = `page-sorter-status ${type}`;

    if (type !== 'error') {
      setTimeout(() => {
        this.statusEl.textContent = '';
      }, 3000);
    }
  }

  /**
   * Cleanup (free memory)
   */
  destroy() {
    this.cancelRender = true;
    this.pages = [];
    this.originalPages = [];
    this.files = [];
    this.fileOrder = [];
    this.originalFileOrder = [];
    this.pageMap.clear();
    this.thumbnailCache.clear();
    this.containerEl.innerHTML = '';
    this.legendEl = null;
    this.legendItemsEl = null;
    this.gridEl = null;
    this.fileGridEl = null;
    this.tabsEl = null;
    this.viewsEl = null;
    this.pagesViewEl = null;
    this.filesViewEl = null;
    this.dropIndicator = null;
    this.fileDropIndicator = null;
    this.draggedIndex = null;
    this.draggedFileOrderIndex = null;
    this.activeView = 'pages';
    this.notifyPageCountChange();
  }

  /**
   * Pre-render a limited number of thumbnails in the background after upload
   * to speed up initial advanced sort experience without heavy memory use.
   */
  async startBackgroundThumbnailPreRender() {
    if (this.preRenderStarted || !this.pages.length) return;
    this.preRenderStarted = true;
    this.cancelRender = false;

    const limit = Math.min(this.config.maxPreRenderPages, this.pages.length);

    for (let i = 0; i < limit; i++) {
      if (this.cancelRender) break;
      try {
        await this.renderThumbnail(this.pages[i]);
      } catch (error) {
        console.warn('Background thumbnail render failed for page', i, error);
      }
      // Yield to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  /**
   * Stop any ongoing thumbnail rendering (used when merging immediately)
   */
  cancelThumbnailRendering() {
    this.cancelRender = true;
  }

  /**
   * Notify host (modal) about page count changes
   */
  notifyPageCountChange() {
    if (!this.containerEl) return;
    const event = new CustomEvent('pagecountchange', {
      detail: { count: this.pages.length }
    });
    this.containerEl.dispatchEvent(event);
  }

  /**
   * Get numeric index from card element
   */
  getCardIndex(card) {
    if (!card) return null;
    const val = parseInt(card.dataset.index, 10);
    return Number.isNaN(val) ? null : val;
  }

  /**
   * Reorder existing DOM cards to match this.pages without re-rendering
   */
  syncGridToPages() {
    if (!this.gridEl) return;
    const cards = Array.from(this.gridEl.querySelectorAll('.page-card'));
    const cardMap = new Map(cards.map(card => [card.dataset.pageId, card]));

    // Clear and re-append in new order
    this.gridEl.querySelectorAll('.page-card').forEach(card => card.remove());
    // Keep indicator element if present
    if (this.dropIndicator && !this.dropIndicator.isConnected) {
      this.gridEl.appendChild(this.dropIndicator);
    }

    this.pages.forEach((pageData, idx) => {
      const card = cardMap.get(pageData.id);
      if (card) {
        card.dataset.index = idx;
        this.gridEl.appendChild(card);
      }
    });

    this.notifyPageCountChange();
  }

  /**
   * Show drop indicator near the target card
   */
  handleDropIndicator(e, targetCard) {
    if (!this.dropIndicator || !targetCard || !this.gridEl) return;

    const cardLeft = targetCard.offsetLeft;
    const cardTop = targetCard.offsetTop;
    const cardWidth = targetCard.offsetWidth;
    const cardHeight = targetCard.offsetHeight;
    const indicatorWidth = 4;
    const targetIndex = this.getCardIndex(targetCard);
    const isAfter = this.draggedIndex !== null && this.draggedIndex < targetIndex;

    const styles = window.getComputedStyle(this.gridEl);
    const gap = parseFloat(styles.columnGap || '0') || 0;
    const offset = gap / 2;

    const baseLeft = isAfter ? (cardLeft + cardWidth) : cardLeft;
    const left = baseLeft + (isAfter ? offset : -offset) - indicatorWidth / 2;
    const top = cardTop;

    this.dropIndicator.style.height = `${cardHeight}px`;
    this.dropIndicator.style.width = `${indicatorWidth}px`;
    this.dropIndicator.style.transform = `translate(${left}px, ${top}px)`;
    this.dropIndicator.classList.remove('hidden');
  }

  /**
   * Show drop indicator for file cards
   */
  handleFileDropIndicator(e, targetCard) {
    if (!this.fileDropIndicator || !targetCard || !this.fileGridEl) return;

    const cardLeft = targetCard.offsetLeft;
    const cardTop = targetCard.offsetTop;
    const cardWidth = targetCard.offsetWidth;
    const cardHeight = targetCard.offsetHeight;
    const indicatorWidth = 4;
    const targetIndex = this.getFileCardOrderIndex(targetCard);
    if (targetIndex === null || targetIndex === undefined) return;
    const isAfter = this.draggedFileOrderIndex !== null && this.draggedFileOrderIndex < targetIndex;

    const styles = window.getComputedStyle(this.fileGridEl);
    const gap = parseFloat(styles.columnGap || '0') || 0;
    const offset = gap / 2;

    const baseLeft = isAfter ? (cardLeft + cardWidth) : cardLeft;
    const left = baseLeft + (isAfter ? offset : -offset) - indicatorWidth / 2;
    const top = cardTop;

    this.fileDropIndicator.style.height = `${cardHeight}px`;
    this.fileDropIndicator.style.width = `${indicatorWidth}px`;
    this.fileDropIndicator.style.transform = `translate(${left}px, ${top}px)`;
    this.fileDropIndicator.classList.remove('hidden');
  }

  /**
   * Hide the drop indicator
   */
  hideDropIndicator() {
    if (this.dropIndicator) {
      this.dropIndicator.classList.add('hidden');
    }
  }

  /**
   * Hide the file drop indicator
   */
  hideFileDropIndicator() {
    if (this.fileDropIndicator) {
      this.fileDropIndicator.classList.add('hidden');
    }
  }

  // Helper to compute total bytes of uploaded files without exposing names
  // Defined as a static to avoid recreating per call
}

function getFilesTotalBytes(files = []) {
  try {
    return Array.from(files || []).reduce((sum, f) => {
      const size = typeof f?.size === 'number' ? f.size : 0;
      return sum + size;
    }, 0);
  } catch (e) {
    return 0;
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdvancedPDFMerger;
}
