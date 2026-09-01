/**
 * VoiceText / CaawiyeAPP - Real-Time Speech-to-Text Accessibility App
 * Core logic, Speech Recognition State Management, Arabic RTL, Somali STT, and Session Storage.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide Icons
    if (window.lucide) {
        window.lucide.createIcons();
    }

    // State Variables
    let isListening = false;
    let currentLanguage = 'en-US'; // Default English
    let currentLangCode = 'en';
    let recognition = null;
    let segments = []; // [{ id, text, lang, langCode, timestamp, isBookmarked }]
    let activeInterimText = '';
    let fontScale = parseFloat(localStorage.getItem('caawiye_font_scale') || '1.0');
    let audioContext = null;
    let analyser = null;
    let microphoneStream = null;
    let animFrameId = null;

    // Font Controls DOM
    const fontDecBtn = document.getElementById('fontDecBtn');
    const fontIncBtn = document.getElementById('fontIncBtn');
    const fontSizeDisplay = document.getElementById('fontSizeDisplay');

    if (fontDecBtn && fontIncBtn) {
        updateFontSizeUI();
        fontDecBtn.addEventListener('click', () => {
            if (fontScale > 0.8) {
                fontScale = parseFloat((fontScale - 0.15).toFixed(2));
                saveFontSize();
            }
        });
        fontIncBtn.addEventListener('click', () => {
            if (fontScale < 2.0) {
                fontScale = parseFloat((fontScale + 0.15).toFixed(2));
                saveFontSize();
            }
        });
    }

    function saveFontSize() {
        localStorage.setItem('caawiye_font_scale', fontScale.toString());
        updateFontSizeUI();
        renderSegments();
    }

    function updateFontSizeUI() {
        if (fontSizeDisplay) {
            fontSizeDisplay.textContent = `${Math.round(fontScale * 100)}%`;
        }
    }

    // DOM Elements
    const micBtn = document.getElementById('micBtn');
    const statusPill = document.getElementById('statusPill');
    const statusText = document.getElementById('statusText');
    const activeLangLabel = document.getElementById('activeLangLabel');
    const segmentCountEl = document.getElementById('segmentCount');
    const audioVisualizer = document.getElementById('audioVisualizer');
    const transcriptContainer = document.getElementById('transcriptContainer');
    const emptyState = document.getElementById('emptyState');
    
    const interimBufferContainer = document.getElementById('interimBufferContainer');
    const interimTextEl = document.getElementById('interimText');
    const interimLangTag = document.getElementById('interimLangTag');
    
    const langTabs = document.querySelectorAll('.lang-tab');
    const simBtns = document.querySelectorAll('.sim-btn');
    
    const copyAllBtn = document.getElementById('copyAllBtn');
    const exportBtn = document.getElementById('exportBtn');
    const clearBtn = document.getElementById('clearBtn');
    const bookmarksBtn = document.getElementById('bookmarksBtn');
    const historyBtn = document.getElementById('historyBtn');
    
    const historyDrawer = document.getElementById('historyDrawer');
    const historyOverlay = document.getElementById('historyOverlay');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    const historyList = document.getElementById('historyList');
    const historySearchInput = document.getElementById('historySearchInput');

    const menuBtn = document.getElementById('menuBtn');
    const menuModal = document.getElementById('menuModal');
    const menuOverlay = document.getElementById('menuOverlay');
    const closeMenuBtn = document.getElementById('closeMenuBtn');

    if (menuBtn && menuModal) {
        menuBtn.addEventListener('click', () => menuModal.classList.remove('hidden'));
        closeMenuBtn.addEventListener('click', () => menuModal.classList.add('hidden'));
        menuOverlay.addEventListener('click', () => menuModal.classList.add('hidden'));
    }

    const quickReplyBtn = document.getElementById('quickReplyBtn');
    const quickReplyModal = document.getElementById('quickReplyModal');
    const quickReplyOverlay = document.getElementById('quickReplyOverlay');
    const closeQuickReplyBtn = document.getElementById('closeQuickReplyBtn');
    const quickCards = document.querySelectorAll('.quick-card');
    
    const customReplyInput = document.getElementById('customReplyInput');
    const sendCustomReplyBtn = document.getElementById('sendCustomReplyBtn');
    const speakCustomReplyBtn = document.getElementById('speakCustomReplyBtn');

    const fullScreenCardDisplay = document.getElementById('fullScreenCardDisplay');
    const bannerTextContainer = document.getElementById('bannerTextContainer');
    const closeBannerBtn = document.getElementById('closeBannerBtn');

    const toast = document.getElementById('toast');

    // Language Map
    const LANGUAGES = {
        'en-US': { name: 'English', code: 'en', flag: '🇺🇸', dir: 'ltr' },
        'ar-SA': { name: 'العربية', code: 'ar', flag: '🇸🇦', dir: 'rtl' },
        'so-SO': { name: 'Soomaali', code: 'so', flag: '🇸🇴', dir: 'ltr' }
    };

    // Somali Phrase Normalization Map (Fixes speech engine phonetic stutter/misspellings)
    const SOMALI_NORMALIZATION = {
        'hayehayehaye': 'Haye',
        'hayee': 'Haye',
        'sideesidee': 'sidee',
        'sideehaye': 'sidee',
        'hayeeshee': 'haye',
        'iska warran': 'iska warran',
        'mahadsanid': 'mahadsanid'
    };

    // Initialize App
    initSpeechRecognition();
    loadSavedSession();
    updateUI();

    // -------------------------------------------------------------
    // Speech Recognition Core Setup (Fixes Repetition Bug)
    // -------------------------------------------------------------
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            showToast("Web Speech API not fully supported. Use simulated input for testing.");
            return;
        }

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = currentLanguage;

        recognition.onstart = () => {
            isListening = true;
            statusPill.className = 'status-pill listening';
            statusText.textContent = 'Listening...';
            micBtn.classList.add('active');
            micBtn.querySelector('.mic-icon').classList.add('hidden');
            micBtn.querySelector('.stop-icon').classList.remove('hidden');
            audioVisualizer.classList.add('active');
            interimBufferContainer.classList.remove('hidden');
            startAudioVisualizer();
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcriptChunk = event.results[i][0].transcript;

                if (event.results[i].isFinal) {
                    finalTranscript += transcriptChunk;
                } else {
                    interimTranscript += transcriptChunk;
                }
            }

            // Clean repetitions in interim text
            if (interimTranscript.trim().length > 0) {
                const cleanedInterim = cleanSpeechRepetition(interimTranscript);
                activeInterimText = cleanedInterim;
                interimTextEl.textContent = cleanedInterim;
                interimLangTag.textContent = LANGUAGES[currentLanguage].name;
            }

            // Commit final transcript segment without duplicating
            if (finalTranscript.trim().length > 0) {
                const cleanedFinal = cleanSpeechRepetition(finalTranscript);
                if (cleanedFinal.length > 0) {
                    addTranscriptSegment(cleanedFinal, currentLanguage);
                }
                activeInterimText = '';
                interimTextEl.textContent = 'Listening...';
            }
        };

        recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            if (event.error === 'not-allowed') {
                showToast("Microphone access denied. Please check permissions.");
                stopListening();
            } else if (event.error === 'no-speech') {
                // Ignore no speech timeout
            }
        };

        recognition.onend = () => {
            if (isListening) {
                // Auto restart if intended to be listening continuously
                try {
                    recognition.start();
                } catch (e) {
                    stopListening();
                }
            } else {
                stopListeningStateUI();
            }
        };
    }

    function toggleListening() {
        if (!recognition) {
            initSpeechRecognition();
            if (!recognition) {
                showToast("Speech Recognition not supported in this browser.");
                return;
            }
        }

        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    }

    function startListening() {
        try {
            recognition.lang = currentLanguage;
            recognition.start();
        } catch (e) {
            console.error("Failed to start speech recognition:", e);
        }
    }

    function stopListening() {
        isListening = false;
        if (recognition) {
            try { recognition.stop(); } catch (e) {}
        }
        stopListeningStateUI();
    }

    function stopListeningStateUI() {
        isListening = false;
        statusPill.className = 'status-pill ready';
        statusText.textContent = 'Ready';
        micBtn.classList.remove('active');
        micBtn.querySelector('.mic-icon').classList.remove('hidden');
        micBtn.querySelector('.stop-icon').classList.add('hidden');
        audioVisualizer.classList.remove('active');
        interimBufferContainer.classList.add('hidden');
        stopAudioVisualizer();
    }

    // -------------------------------------------------------------
    // Repetition Cleanup & Somali Normalization Algorithm
    // -------------------------------------------------------------
    function cleanSpeechRepetition(text) {
        if (!text) return '';

        let cleaned = text.trim();

        // 1. Remove immediate duplicate contiguous words e.g. "how how" -> "how"
        cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');

        // 2. Remove duplicate phrase patterns e.g. "how are you how are you" -> "how are you"
        cleaned = cleaned.replace(/(.+?)\s+\1/gi, '$1');

        // 3. Fix concatenated repetitive words like "HiHi", "whatI'm", "sideesidee"
        cleaned = cleaned.replace(/([a-zA-Z\u0600-\u06FF]{3,})\1+/gi, '$1');

        // 4. Somali specific dictionary normalization
        if (currentLanguage === 'so-SO') {
            let words = cleaned.split(' ');
            words = words.map(w => {
                const lower = w.toLowerCase();
                return SOMALI_NORMALIZATION[lower] ? SOMALI_NORMALIZATION[lower] : w;
            });
            cleaned = words.join(' ');
        }

        // Capitalize first letter if English/Somali
        if (currentLanguage !== 'ar-SA' && cleaned.length > 0) {
            cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }

        return cleaned;
    }

    // -------------------------------------------------------------
    // Segment Management & Rendering
    // -------------------------------------------------------------
    function addTranscriptSegment(text, langCode) {
        const langConfig = LANGUAGES[langCode] || LANGUAGES['en-US'];
        const now = new Date();
        const timeString = now.toTimeString().substring(0, 5);

        const segment = {
            id: 'seg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            text: text,
            lang: langCode,
            langCode: langConfig.code,
            dir: langConfig.dir,
            timestamp: timeString,
            isBookmarked: false
        };

        segments.push(segment);
        saveSessionToStorage();
        renderSegments();
        scrollToBottom();
    }

    function renderSegments(filterBookmarks = false) {
        // Clear current feed except empty state
        const existingCards = transcriptContainer.querySelectorAll('.segment-card, .lang-group-header');
        existingCards.forEach(el => el.remove());

        let displaySegments = segments;
        if (filterBookmarks) {
            displaySegments = segments.filter(s => s.isBookmarked);
        }

        if (displaySegments.length === 0) {
            emptyState.style.display = 'flex';
            segmentCountEl.textContent = '0 segments';
            return;
        }

        emptyState.style.display = 'none';
        segmentCountEl.textContent = `${displaySegments.length} segment${displaySegments.length > 1 ? 's' : ''}`;

        let currentGroupLang = null;

        displaySegments.forEach(seg => {
            const langConfig = LANGUAGES[seg.lang] || LANGUAGES['en-US'];

            // Render group header if language changes
            if (seg.lang !== currentGroupLang) {
                currentGroupLang = seg.lang;
                const groupHeader = document.createElement('div');
                groupHeader.className = 'lang-group-header';
                groupHeader.innerHTML = `
                    <span class="lang-badge ${langConfig.code}">
                        <span>${langConfig.flag}</span>
                        <span>${langConfig.name}</span>
                    </span>
                    <div class="group-divider"></div>
                `;
                transcriptContainer.appendChild(groupHeader);
            }

            // Segment Card
            const card = document.createElement('article');
            card.className = `segment-card lang-${langConfig.code}`;
            card.setAttribute('dir', langConfig.dir);
            card.setAttribute('data-id', seg.id);

            card.innerHTML = `
                <div class="segment-header">
                    <span class="segment-timestamp">${seg.timestamp}</span>
                    <div class="segment-actions">
                        <button class="small-icon-btn bookmark-btn ${seg.isBookmarked ? 'bookmarked' : ''}" title="Bookmark">
                            <i data-lucide="bookmark"></i>
                        </button>
                        <button class="small-icon-btn copy-btn" title="Copy Segment">
                            <i data-lucide="copy"></i>
                        </button>
                        <button class="small-icon-btn delete-btn" title="Delete Segment">
                            <i data-lucide="trash"></i>
                        </button>
                    </div>
                </div>
                <div class="segment-text" style="font-size: ${langConfig.code === 'ar' ? (1.35 * fontScale).toFixed(2) : (1.2 * fontScale).toFixed(2)}rem;">${escapeHtml(seg.text)}</div>
            `;

            // Event Listeners for Segment Card
            const bookmarkBtn = card.querySelector('.bookmark-btn');
            bookmarkBtn.addEventListener('click', () => toggleBookmark(seg.id));

            const copyBtn = card.querySelector('.copy-btn');
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(seg.text);
                showToast("Segment copied to clipboard!");
            });

            const deleteBtn = card.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', () => deleteSegment(seg.id));

            transcriptContainer.appendChild(card);
        });

        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    function toggleBookmark(id) {
        const seg = segments.find(s => s.id === id);
        if (seg) {
            seg.isBookmarked = !seg.isBookmarked;
            saveSessionToStorage();
            renderSegments();
            showToast(seg.isBookmarked ? "Segment bookmarked" : "Bookmark removed");
        }
    }

    function deleteSegment(id) {
        segments = segments.filter(s => s.id !== id);
        saveSessionToStorage();
        renderSegments();
        showToast("Segment deleted");
    }

    function scrollToBottom() {
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }

    // -------------------------------------------------------------
    // Language Tab Switching
    // -------------------------------------------------------------
    langTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const selectedLang = tab.getAttribute('data-lang');
            const selectedCode = tab.getAttribute('data-lang-code');
            
            if (currentLanguage === selectedLang) return;

            langTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            currentLanguage = selectedLang;
            currentLangCode = selectedCode;
            activeLangLabel.textContent = LANGUAGES[selectedLang].name;

            if (isListening && recognition) {
                stopListening();
                setTimeout(() => startListening(), 200);
            }

            showToast(`Switched language to ${LANGUAGES[selectedLang].name}`);
        });
    });

    // -------------------------------------------------------------
    // Test Simulator Buttons (For quick demonstration)
    // -------------------------------------------------------------
    simBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const langCode = btn.getAttribute('data-lang');
            const text = btn.getAttribute('data-text');

            let fullLang = 'en-US';
            if (langCode === 'ar') fullLang = 'ar-SA';
            if (langCode === 'so') fullLang = 'so-SO';

            addTranscriptSegment(text, fullLang);
            showToast(`Simulated speech in ${LANGUAGES[fullLang].name}`);
        });
    });

    // -------------------------------------------------------------
    // LocalStorage Session Persistence
    // -------------------------------------------------------------
    function saveSessionToStorage() {
        try {
            localStorage.setItem('caawiye_current_session', JSON.stringify(segments));
        } catch (e) {
            console.error("Failed to save session to localStorage:", e);
        }
    }

    function loadSavedSession() {
        try {
            const saved = localStorage.getItem('caawiye_current_session');
            if (saved) {
                segments = JSON.parse(saved);
                renderSegments();
            }
        } catch (e) {
            console.error("Failed to load saved session:", e);
        }
    }

    function saveSessionToHistoryArchive() {
        if (segments.length === 0) return;

        try {
            const history = JSON.parse(localStorage.getItem('caawiye_session_history') || '[]');
            const sessionArchive = {
                id: 'sess_' + Date.now(),
                date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
                segmentCount: segments.length,
                preview: segments[0].text,
                segments: segments
            };
            history.unshift(sessionArchive);
            localStorage.setItem('caawiye_session_history', JSON.stringify(history.slice(0, 30)));
        } catch (e) {
            console.error("Failed to archive session:", e);
        }
    }

    // -------------------------------------------------------------
    // History Drawer Manager
    // -------------------------------------------------------------
    historyBtn.addEventListener('click', () => {
        renderHistoryList();
        historyDrawer.classList.remove('hidden');
    });

    closeHistoryBtn.addEventListener('click', () => historyDrawer.classList.add('hidden'));
    historyOverlay.addEventListener('click', () => historyDrawer.classList.add('hidden'));

    function renderHistoryList(filterQuery = '') {
        try {
            const history = JSON.parse(localStorage.getItem('caawiye_session_history') || '[]');
            historyList.innerHTML = '';

            let filtered = history;
            if (filterQuery.trim()) {
                const q = filterQuery.toLowerCase();
                filtered = history.filter(h => h.preview.toLowerCase().includes(q) || h.date.toLowerCase().includes(q));
            }

            if (filtered.length === 0) {
                historyList.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">No saved sessions found.</div>`;
                return;
            }

            filtered.forEach(session => {
                const item = document.createElement('div');
                item.className = 'history-item';
                item.innerHTML = `
                    <div class="history-item-meta">
                        <span>${session.date}</span>
                        <span>${session.segmentCount} segments</span>
                    </div>
                    <div class="history-item-preview">${escapeHtml(session.preview)}</div>
                `;

                item.addEventListener('click', () => {
                    saveSessionToHistoryArchive(); // Archive current before loading
                    segments = session.segments;
                    saveSessionToStorage();
                    renderSegments();
                    historyDrawer.classList.add('hidden');
                    showToast("Loaded past session history");
                });

                historyList.appendChild(item);
            });
        } catch (e) {
            console.error("Failed to render history list:", e);
        }
    }

    historySearchInput.addEventListener('input', (e) => {
        renderHistoryList(e.target.value);
    });

    // -------------------------------------------------------------
    // Quick Communication Reply Cards & Fullscreen Banner
    // -------------------------------------------------------------
    if (quickReplyBtn) {
        quickReplyBtn.addEventListener('click', () => quickReplyModal.classList.remove('hidden'));
    }
    if (closeQuickReplyBtn) {
        closeQuickReplyBtn.addEventListener('click', () => quickReplyModal.classList.add('hidden'));
    }
    if (quickReplyOverlay) {
        quickReplyOverlay.addEventListener('click', () => quickReplyModal.classList.add('hidden'));
    }

    quickCards.forEach(card => {
        card.addEventListener('click', () => {
            const text = card.getAttribute('data-reply');
            showFullScreenBanner(text);
            quickReplyModal.classList.add('hidden');
        });
    });

    if (sendCustomReplyBtn) {
        sendCustomReplyBtn.addEventListener('click', () => {
            const text = customReplyInput.value.trim();
            if (text) {
                showFullScreenBanner(text);
                quickReplyModal.classList.add('hidden');
                customReplyInput.value = '';
            }
        });
    }

    if (speakCustomReplyBtn) {
        speakCustomReplyBtn.addEventListener('click', () => {
            const text = customReplyInput.value.trim();
            if (text && window.speechSynthesis) {
                const utterance = new SpeechSynthesisUtterance(text);
                window.speechSynthesis.speak(utterance);
                showToast("Speaking reply aloud...");
            }
        });
    }

    function showFullScreenBanner(text) {
        bannerTextContainer.textContent = text;
        fullScreenCardDisplay.classList.remove('hidden');
    }

    if (closeBannerBtn) {
        closeBannerBtn.addEventListener('click', () => fullScreenCardDisplay.classList.add('hidden'));
    }
    if (fullScreenCardDisplay) {
        fullScreenCardDisplay.addEventListener('click', (e) => {
            if (e.target !== closeBannerBtn && !closeBannerBtn.contains(e.target)) {
                fullScreenCardDisplay.classList.add('hidden');
            }
        });
    }

    // -------------------------------------------------------------
    // Action Buttons (Copy, Export, Clear, Bookmarks Filter)
    // -------------------------------------------------------------
    micBtn.addEventListener('click', toggleListening);

    copyAllBtn.addEventListener('click', () => {
        if (segments.length === 0) {
            showToast("No transcripts to copy");
            return;
        }
        const fullText = segments.map(s => `[${s.timestamp}] ${LANGUAGES[s.lang].name}: ${s.text}`).join('\n\n');
        navigator.clipboard.writeText(fullText);
        showToast("Full transcript copied to clipboard!");
    });

    exportBtn.addEventListener('click', () => {
        if (segments.length === 0) {
            showToast("No transcripts to export");
            return;
        }
        const fullText = segments.map(s => `[${s.timestamp}] ${LANGUAGES[s.lang].name}: ${s.text}`).join('\n\n');
        const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `VoiceText_Transcript_${new Date().toISOString().substring(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Transcript exported as .txt file");
    });

    let showingBookmarksOnly = false;
    bookmarksBtn.addEventListener('click', () => {
        showingBookmarksOnly = !showingBookmarksOnly;
        bookmarksBtn.classList.toggle('active', showingBookmarksOnly);
        renderSegments(showingBookmarksOnly);
        showToast(showingBookmarksOnly ? "Showing bookmarked segments" : "Showing all segments");
    });

    clearBtn.addEventListener('click', () => {
        if (segments.length === 0) return;
        if (confirm("Are you sure you want to clear the current transcription feed?")) {
            saveSessionToHistoryArchive();
            segments = [];
            saveSessionToStorage();
            renderSegments();
            showToast("Feed cleared. Session archived to History.");
        }
    });

    // -------------------------------------------------------------
    // Web Audio Visualizer (Mic Spectrum)
    // -------------------------------------------------------------
    function startAudioVisualizer() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            microphoneStream = stream;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            analyser.fftSize = 32;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const bars = audioVisualizer.querySelectorAll('.bar');

            function animateVisualizer() {
                if (!isListening) return;
                analyser.getByteFrequencyData(dataArray);

                for (let i = 0; i < bars.length; i++) {
                    const val = dataArray[i] || 0;
                    const height = Math.max(4, Math.min(18, (val / 255) * 22));
                    bars[i].style.height = `${height}px`;
                }

                animFrameId = requestAnimationFrame(animateVisualizer);
            }

            animateVisualizer();
        }).catch(err => {
            console.log("Audio visualizer mic stream unavailable:", err);
        });
    }

    function stopAudioVisualizer() {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        if (microphoneStream) {
            microphoneStream.getTracks().forEach(track => track.stop());
            microphoneStream = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
    }

    // Helpers
    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }

    function updateUI() {
        activeLangLabel.textContent = LANGUAGES[currentLanguage].name;
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/"/g, "&quot;")
                  .replace(/'/g, "&#039;");
    }
});