/**
 * AdvancedPDFMerger
 * Modular system for extracting, displaying, and reordering PDF pages with drag-and-drop
 * Clean, efficient, and robust
 */

class AdvancedPDFMerger {
  constructor(options = {}) {
    // Configuration
    this.config = {
      maxPagesInMemory: 100,
      thumbnailScale: 1.5,
      jpegQuality: 0.8,
      ...options
    };

    // State
    this.files = [];
    this.pages = [];
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

    try {
      this.showStatus('Extracting pages from PDFs...');
      
      // Store files and extract pages
      this.files = uploadedFiles;
      await this.extractAllPages();
      
      // Render UI
      this.render();
      this.showStatus(`${this.pages.length} pages ready for reordering`);
      
      return true;
    } catch (error) {
      this.showStatus(`Error: ${error.message}`, 'error');
      console.error('AdvancedPDFMerger init error:', error);
      return false;
    }
  }

  /**
   * Extract all pages from all uploaded files using PDF.js
   * Efficient: stores minimal data, renders thumbnails on-demand
   */
  async extractAllPages() {
    this.pages = [];
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
        console.error(`Error extracting pages from ${file.name}:`, error);
        throw new Error(`Failed to process ${file.name}: ${error.message}`);
      }
    }
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
    ctx.fillText('Unable to', 100, 130);
    ctx.fillText('render', 100, 150);
    
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
      </div>
    `;

    // Apply color border
    card.style.borderColor = color;

    // Drag event listeners
    card.addEventListener('dragstart', (e) => this.handleDragStart(e, index));
    card.addEventListener('dragover', (e) => this.handleDragOver(e));
    card.addEventListener('drop', (e) => this.handleDrop(e, index));
    card.addEventListener('dragend', () => this.handleDragEnd());

    // Touch support for mobile
    this.addTouchSupport(card, index);

    return card;
  }

  /**
   * Handle drag start
   */
  handleDragStart(e, index) {
    this.draggedIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.target.closest('.page-card').style.opacity = '0.6';
  }

  /**
   * Handle drag over
   */
  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.target.closest('.page-card')?.classList.add('drag-over');
  }

  /**
   * Handle drop - Insert dragged page at target position
   */
  handleDrop(e, targetIndex) {
    e.preventDefault();
    e.stopPropagation();
    e.target.closest('.page-card')?.classList.remove('drag-over');

    // Validate indices
    if (this.draggedIndex === null || this.draggedIndex === undefined) {
      console.warn('No dragged index set');
      return;
    }

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

    // Re-render grid
    this.renderGrid();
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
  }

  /**
   * Add touch support for mobile drag-and-drop
   */
  addTouchSupport(card, index) {
    let touchStartX = 0;
    let touchStartY = 0;

    card.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      this.draggedIndex = index;
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
    this.renderThumbnailsInBackground(grid);
  }

  /**
   * Render thumbnails in background without blocking UI
   */
  async renderThumbnailsInBackground(grid) {
    const cards = grid.querySelectorAll('.page-card');
    
    for (let i = 0; i < this.pages.length; i++) {
      const pageData = this.pages[i];
      const card = cards[i];

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
    this.pages.sort((a, b) => {
      if (a.fileIndex !== b.fileIndex) return a.fileIndex - b.fileIndex;
      return a.pageIndex - b.pageIndex;
    });
    this.renderGrid();
    this.showStatus('Order reset to original');
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
    this.pages = [];
    this.files = [];
    this.pageMap.clear();
    this.thumbnailCache.clear();
    this.containerEl.innerHTML = '';
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdvancedPDFMerger;
}