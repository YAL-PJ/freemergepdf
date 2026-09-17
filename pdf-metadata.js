/**
 * pdf-metadata.js — best-effort extraction of SAFE, non-identifying PDF metadata
 * for attachment to crash reports.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every PDF stays in the browser: freemergepdf never uploads user files, and that
 * privacy property is the product. But it means a crash that only happens on one
 * particular PDF is impossible to reproduce from a report that contains just a
 * message, a stack and a filename string. These few structural facts about the
 * document (version, size, page count, encrypted/linearized flags, rough object
 * count, presence of a form, producing software) are usually enough to rebuild an
 * equivalent PDF locally and reproduce the bug.
 *
 * PRIVACY BOUNDARY — READ BEFORE ADDING A FIELD
 * ---------------------------------------------
 * We NEVER capture, and must never start capturing:
 *   - file bytes or any slice of them (nothing here is ever put in the payload raw)
 *   - page text, extracted content streams, or images / thumbnails
 *   - the document info fields /Title, /Author, /Subject, /Keywords — these routinely
 *     contain real names, client names, case numbers, medical or tax details
 *   - XMP metadata (dc:title, dc:creator, ...) for the same reason
 *   - file paths; only the size of the file, never its location
 * /Producer and /Creator ARE captured: they name software ("Microsoft Word", "Skia/PDF"),
 * which is exactly what we need to reproduce generator-specific breakage. They are
 * truncated and stripped of separator characters before leaving this module.
 * If you are unsure whether a new field can carry user data, leave it out.
 *
 * ROBUSTNESS CONTRACT
 * -------------------
 * An error reporter that crashes while reporting an error is worse than no metadata.
 * Every function here is wrapped so that a malformed PDF, a failed read, a missing
 * browser API or a hostile file can never throw out of the reporter; failures degrade
 * to `null` / partial objects. Work is bounded: large files are never read whole, and
 * every read races a timeout.
 */
(function (global) {
    'use strict';

    var LIMITS = {
        // Head is enough for "%PDF-1.x" and the linearization dictionary.
        headBytes: 4096,
        // Tail covers the trailer / xref, where /Size, /Encrypt and /Root live.
        tailBytes: 128 * 1024,
        // Only files below this size are scanned end-to-end (page/object counting).
        // Above it we stay with head+tail so a 600MB file costs the same as a 1MB one.
        fullScanMaxBytes: 8 * 1024 * 1024,
        perFileTimeoutMs: 1500,
        totalTimeoutMs: 3000,
        maxFiles: 4,
        stringLength: 48,
        noteLength: 320
    };

    function withTimeout(promise, ms, fallback) {
        return new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                resolve(fallback);
            }, ms);
            Promise.resolve(promise).then(function (value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }, function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(fallback);
            });
        });
    }

    /** Read a byte range of a File/Blob as a latin1 string. Never throws. */
    function readSliceText(file, start, end) {
        return new Promise(function (resolve) {
            try {
                var blob = file.slice(Math.max(0, start), Math.max(0, end));
                var decode = function (buffer) {
                    try {
                        // latin1 keeps a 1:1 byte->char mapping, so byte offsets in the
                        // structural syntax stay meaningful and no bytes are retained.
                        return new TextDecoder('latin1').decode(new Uint8Array(buffer));
                    } catch (_) {
                        return '';
                    }
                };
                if (blob && typeof blob.arrayBuffer === 'function') {
                    blob.arrayBuffer().then(function (buf) { resolve(decode(buf)); }, function () { resolve(''); });
                    return;
                }
                if (typeof FileReader === 'function') {
                    var reader = new FileReader();
                    reader.onload = function () { resolve(decode(reader.result)); };
                    reader.onerror = function () { resolve(''); };
                    reader.readAsArrayBuffer(blob);
                    return;
                }
                resolve('');
            } catch (_) {
                resolve('');
            }
        });
    }

    /** Software names only. Strip control chars and our own breadcrumb separators. */
    function sanitizeSoftwareString(value) {
        try {
            return String(value || '')
                .replace(/\\[nrt]/g, ' ')
                .replace(/[^\x20-\x7E]/g, '')
                .replace(/[;|=,]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, LIMITS.stringLength);
        } catch (_) {
            return '';
        }
    }

    /**
     * Pull /Producer or /Creator literal strings out of raw PDF syntax.
     * Deliberately keyed on those two names only — never /Title, /Author,
     * /Subject or /Keywords, which hold user data.
     */
    function findSoftwareString(text, key) {
        try {
            var re = new RegExp('/' + key + '\\s*(?:\\(([^)]{0,200})\\)|<([0-9A-Fa-f\\s]{0,400})>)');
            var match = re.exec(text);
            if (!match) return '';
            if (match[1]) return sanitizeSoftwareString(match[1]);
            if (match[2]) {
                var hex = match[2].replace(/\s+/g, '');
                var out = '';
                for (var i = 0; i + 1 < hex.length; i += 2) {
                    var code = parseInt(hex.substr(i, 2), 16);
                    if (code > 0) out += String.fromCharCode(code);
                }
                return sanitizeSoftwareString(out);
            }
            return '';
        } catch (_) {
            return '';
        }
    }

    function lastIntAfter(text, key) {
        try {
            var re = new RegExp('/' + key + '\\s+(\\d{1,10})', 'g');
            var match;
            var value = null;
            while ((match = re.exec(text)) !== null) {
                value = parseInt(match[1], 10);
            }
            return Number.isFinite(value) ? value : null;
        } catch (_) {
            return null;
        }
    }

    function countMatches(text, re, cap) {
        try {
            var count = 0;
            var match;
            re.lastIndex = 0;
            while ((match = re.exec(text)) !== null) {
                count += 1;
                if (count >= cap) break;
            }
            return count;
        } catch (_) {
            return null;
        }
    }

    /**
     * Extract safe metadata for one File/Blob.
     * Resolves to an object (possibly partly null) or null. Never rejects, never throws.
     */
    function extractSafePdfMetadata(file, options) {
        var opts = options || {};
        try {
            if (!file || typeof file.slice !== 'function') return Promise.resolve(null);

            var size = Number.isFinite(file.size) ? file.size : null;
            var meta = {
                fileSize: size,
                pdfVersion: null,
                pageCount: Number.isFinite(opts.pageCount) ? opts.pageCount : null,
                isEncrypted: null,
                isLinearized: null,
                objectCount: null,
                objectCountExact: false,
                hasAcroForm: null,
                producer: '',
                creator: '',
                scan: 'partial'
            };

            var fullScan = size !== null && size > 0 && size <= LIMITS.fullScanMaxBytes;

            var work = (fullScan
                ? readSliceText(file, 0, size).then(function (text) { return { head: text, tail: '', full: text }; })
                : Promise.all([
                    readSliceText(file, 0, LIMITS.headBytes),
                    readSliceText(file, Math.max(0, (size || 0) - LIMITS.tailBytes), size || LIMITS.tailBytes)
                ]).then(function (parts) { return { head: parts[0], tail: parts[1], full: '' }; })
            ).then(function (chunks) {
                var head = chunks.head || '';
                var tail = chunks.tail || '';
                var scanned = chunks.full || (head + '\n' + tail);
                meta.scan = fullScan ? 'full' : 'head+tail';

                var version = /%PDF-(\d\.\d)/.exec(head.slice(0, 1024));
                meta.pdfVersion = version ? version[1] : null;

                meta.isLinearized = /\/Linearized/.test(head);
                meta.isEncrypted = /\/Encrypt\b/.test(scanned);
                meta.hasAcroForm = /\/AcroForm\b/.test(scanned);

                // Object count: the xref trailer's /Size is the authoritative highest
                // object number; otherwise count "N G obj" headers (approximate, and
                // undercounts objects packed into compressed object streams).
                var trailerSize = lastIntAfter(tail || scanned, 'Size');
                if (Number.isFinite(trailerSize) && trailerSize > 0) {
                    meta.objectCount = trailerSize;
                    meta.objectCountExact = true;
                } else if (fullScan) {
                    meta.objectCount = countMatches(scanned, /\b\d{1,8}\s+\d{1,5}\s+obj\b/g, 100000);
                }

                if (!Number.isFinite(meta.pageCount)) {
                    // Linearized files publish the page count as /N in the first-page dict.
                    var linearN = meta.isLinearized ? lastIntAfter(head, 'N') : null;
                    if (Number.isFinite(linearN) && linearN > 0) {
                        meta.pageCount = linearN;
                    } else if (fullScan) {
                        // /Count on the page tree root; fall back to counting page objects.
                        var counts = [];
                        var re = /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d{1,7})|\/Count\s+(\d{1,7})[\s\S]{0,400}?\/Type\s*\/Pages/g;
                        var m;
                        while ((m = re.exec(scanned)) !== null) {
                            var n = parseInt(m[1] || m[2], 10);
                            if (Number.isFinite(n)) counts.push(n);
                        }
                        if (counts.length) {
                            meta.pageCount = Math.max.apply(null, counts);
                        } else {
                            var pageObjects = countMatches(scanned, /\/Type\s*\/Page[^s]/g, 20000);
                            meta.pageCount = pageObjects || null;
                        }
                    }
                }

                // Software names only (see PRIVACY BOUNDARY above).
                meta.producer = findSoftwareString(scanned, 'Producer');
                meta.creator = findSoftwareString(scanned, 'Creator');

                return meta;
            }, function () {
                return meta;
            });

            return withTimeout(work, opts.timeoutMs || LIMITS.perFileTimeoutMs, meta)
                .then(function (value) { return value || meta; }, function () { return meta; });
        } catch (_) {
            return Promise.resolve(null);
        }
    }

    /** Extract for up to LIMITS.maxFiles inputs. Never rejects. */
    function collectSafePdfMetadata(files, options) {
        var opts = options || {};
        try {
            var list = [];
            try {
                list = Array.prototype.slice.call(files || []);
            } catch (_) {
                list = [];
            }
            list = list.filter(Boolean).slice(0, opts.maxFiles || LIMITS.maxFiles);
            if (!list.length) return Promise.resolve([]);

            var all = Promise.all(list.map(function (file) {
                return extractSafePdfMetadata(file, opts).catch(function () { return null; });
            })).then(function (results) {
                return results.filter(Boolean);
            }, function () {
                return [];
            });

            return withTimeout(all, opts.totalTimeoutMs || LIMITS.totalTimeoutMs, []);
        } catch (_) {
            return Promise.resolve([]);
        }
    }

    function bool(value) {
        if (value === true) return '1';
        if (value === false) return '0';
        return '?';
    }

    /**
     * Render metadata as a breadcrumb in the same style as the existing userNote
     * convention, e.g.
     *   pdf1=ver:1.4|size:1234|pages:3|enc:0|lin:0|obj:12|form:0|prod:pdf-lib
     */
    function formatPdfMetadataNote(metaList) {
        try {
            var parts = (metaList || []).map(function (meta, index) {
                if (!meta) return null;
                var fields = [
                    meta.pdfVersion ? 'ver:' + meta.pdfVersion : null,
                    Number.isFinite(meta.fileSize) ? 'size:' + meta.fileSize : null,
                    Number.isFinite(meta.pageCount) ? 'pages:' + meta.pageCount : null,
                    'enc:' + bool(meta.isEncrypted),
                    'lin:' + bool(meta.isLinearized),
                    Number.isFinite(meta.objectCount)
                        ? 'obj' + (meta.objectCountExact ? ':' : '~:') + meta.objectCount
                        : null,
                    'form:' + bool(meta.hasAcroForm),
                    meta.producer ? 'prod:' + meta.producer : null,
                    meta.creator ? 'creat:' + meta.creator : null,
                    meta.scan ? 'scan:' + meta.scan : null
                ].filter(Boolean);
                return 'pdf' + (index + 1) + '=' + fields.join('|');
            }).filter(Boolean);
            return parts.join(';').slice(0, LIMITS.noteLength);
        } catch (_) {
            return '';
        }
    }

    var api = {
        LIMITS: LIMITS,
        extractSafePdfMetadata: extractSafePdfMetadata,
        collectSafePdfMetadata: collectSafePdfMetadata,
        formatPdfMetadataNote: formatPdfMetadataNote
    };

    global.PdfSafeMetadata = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
