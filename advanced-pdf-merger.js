/**
 * AdvancedPDFMerger
 * Modular system for extracting, displaying, and reordering PDF pages with drag-and-drop
 * Clean, efficient, and robust
 */

const safeReportError = (err, context = {}) => {
  if (typeof window === 'undefined' || typeof window.reportError !== 'function') return;
  try {
    window.reportError(err, context);
  } catch (reportErr) {
    console.warn('reportError failed', reportErr);
  }
};

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
    this.pageMap = new Map(); // For efficient lookups
    this.draggedIndex = null;
    this.thumbnailCache = new Map();

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
    this.gridEl = null;
    this.statusEl = null;
    this.scrollContainer = null;
    this.preRenderStarted = false;
    this.cancelRender = false;
    this.dropIndicator = null;
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
      this.showStatus('Extracting pages from PDFs...');
      
      // Store files and extract pages
      this.files = uploadedFiles;
      await this.extractAllPages();
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

  /**
   * Convert internal errors to user-facing messages (no PII/file names)
   */
  formatUserError(err) {
    const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
    const isFileAccess =
      text.includes('notreadable') ||
      text.includes('could not be read') ||
      text.includes('permission') ||
      text.includes('securityerror');

    if (isFileAccess) {
      return 'Could not read this file. Please copy it to your local drive (e.g., Desktop), close other apps using it (sync/preview/AV), and select it again.';
    }

    return `Error: ${err?.message || 'Something went wrong'}`;
  }

  /**
   * Extract all pages from all uploaded files using PDF.js
   * Efficient: stores minimal data, renders thumbnails on-demand
   */
  async extractAllPages() {
    this.pages = [];
    this.originalPages = [];
    this.thumbnailCache.clear();

    // Set up PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    for (let fileIndex = 0; fileIndex < this.files.length; fileIndex++) {
      const file = this.files[fileIndex];
      
      try {
        const arrayBuffer = await file.arrayBuffer();
        
        // Load PDF using PDF.js
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
        const sanitizedMessage = `Failed to process file index ${fileIndex}: ${error?.message || 'Unknown error'}`;
        const sanitizedError = new Error(sanitizedMessage);
        console.error(`Error extracting pages from file index ${fileIndex}:`, error);
        throw sanitizedError;
      }
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
      const scale = this.config.thumbnailScale;
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
      console.error(`Error rendering thumbnail for ${pageData.id}:`, error);
      safeReportError(error, {
        feature: 'AdvancedPDFMerger.renderThumbnail',
        userNote: `page=${pageData?.id || 'unknown'}`
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
   * Handle drag start
   */
  handleDragStart(e) {
    const card = e.target.closest('.page-card');
    this.draggedIndex = this.getCardIndex(card);
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
    let insertIndex;
    if (this.draggedIndex < targetIndex) {
      // Dragging right: target index shifted left after removal
      insertIndex = targetIndex - 1;
    } else {
      // Dragging left: target index unchanged
      insertIndex = targetIndex;
    }

    // Ensure insertIndex is valid
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

    // Create legend
    this.renderLegend();

    // Create grid
    await this.renderGrid();
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

    this.files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'legend-item';

      const color = this.fileColors[index % this.fileColors.length];
      const colorDot = document.createElement('div');
      colorDot.className = 'legend-color';
      colorDot.style.backgroundColor = color;

      const label = document.createElement('span');
      label.textContent = `${this.truncateFileName(file.name)} (${this.countPagesForFile(index)} pages)`;

      item.appendChild(colorDot);
      item.appendChild(label);
      items.appendChild(item);
    });

    legend.appendChild(items);
    this.containerEl.appendChild(legend);
  }

  /**
   * Render grid of page cards with lazy thumbnail loading
   */
  async renderGrid() {
    // Remove any existing grid
    const existingGrid = this.containerEl.querySelector('.page-sorter-grid');
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

    this.containerEl.appendChild(grid);

    // Now render thumbnails in the background, one by one
    this.cancelRender = false;
    this.renderThumbnailsInBackground(grid);

    this.notifyPageCountChange();
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

    // Rebuild page map
    this.pageMap.clear();
    this.pages.forEach(p => this.pageMap.set(p.id, p));

    // Rebuild the grid
    this.renderGrid();
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
    this.pageMap.clear();
    this.thumbnailCache.clear();
    this.containerEl.innerHTML = '';
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
   * Hide the drop indicator
   */
  hideDropIndicator() {
    if (this.dropIndicator) {
      this.dropIndicator.classList.add('hidden');
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
