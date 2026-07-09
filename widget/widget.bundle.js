(function (global) {
  /*
   * Widget 預設設定：
   * - 集中管理前端可覆寫的 API、文案、外觀與互動行為。
   * - 初始化時會和 script data-* 設定、遠端站台設定一起合併。
   */
  const DEFAULTS = {
    apiBase: '',
    siteCode: '',
    assistantCode: '',
    languageCode: 'zh-TW',
    title: '小智',
    subtitle: '歡迎提問網站相關問題',
    // 首次使用 / 重新開始時的歡迎區塊文案。
    // 嵌入者可用 data-welcome-kicker / data-welcome-title / data-welcome-message 覆寫。
    welcomeKicker: '我是您的助理 小智 ~',
    welcomeTitle: '您可直接輸入問題',
    welcomeMessage: '- 可直接點上方 `快速提問區` 問題，開始對話。\n- 歡迎提問網站相關問題，謝謝~',
    // 對話內容區的空狀態文案。
    // 嵌入者可用 data-empty-kicker / data-empty-title / data-empty-message / data-empty-items 覆寫。
    emptyKicker: '您可直接提問',
    emptyTitle: '先提問您想了解的服務',
    emptyMessage: '系統會先整理回答，再視命中情況進行回答',
    emptyItems: ['問題越具體，回答通常越穩定。', '也可直接點上方快速提問，開始對話。'],
    // 首次載入顯示歡迎；使用者按「重新開始」後改顯示空訊息。
    // 嵌入者可用 data-show-welcome / data-show-empty-messages 控制是否顯示。
    showWelcome: true,
    showEmptyMessages: true,
    // 是否在底部提問區顯示「重新開始」圖示鈕；嵌入者可用 data-show-input-reset-button 控制，預設顯示。
    showInputResetButton: true,
    placeholder: '請輸入您的問題…',
    primaryColor: '#2563eb',
    launcherIcon: 'fa-regular fa-comments',
    launcherBehavior: 'hide-when-open',
    launcherPosition: 'bottom-right',
    launcherStyle: 'bubble',
    launcherText: '',
    launcherOffsetX: '24px',
    launcherOffsetY: '24px',
    // 面板初始位置可與啟動按鈕分開設定；留空時由初始化流程沿用 launcherOffsetX / launcherOffsetY。
    panelOffsetX: '',
    panelOffsetY: '',
    autoOpen: false,
    sessionEndpoint: '/api/widget/session/create',
    sendEndpoint: '/api/widget/chat/send',
    feedbackEndpoint: '/api/widget/feedback',
    configEndpointTemplate: '/api/widget/config/{siteCode}',
    // v28.6.19.19.151：正式 Widget 使用 POST 查詢設定，避免 iPad Safari iframe 內 GET 缺少 Origin / Referer。
    configQueryEndpoint: '/api/widget/config/query',
    suggestedQuestionsEndpointTemplate: '/api/widget/suggested-questions/{siteCode}',
    // v28.6.19.19.151：正式 Widget 使用 POST 查詢快速提問，讓來源驗證與 session/chat 行為一致。
    suggestedQuestionsQueryEndpoint: '/api/widget/suggested-questions/query',
    referrerUrl: global.location ? global.location.href : '',
    metadataJson: '{}',
    themeMode: 'auto',
    brandShort: '',
    brandName: '',
    panelStyle: 'soft',
    compactHeader: true,
    suggestionsMode: 'auto',
    panelMode: 'right-bottom-window',
    // 是否啟用開啟 Widget 時的背景遮罩；預設 false，避免遮住嵌入頁內容。
    enableOverlay: false,
    startView: 'home',
    mobileMode: 'auto-fullscreen',
    density: 'comfortable',
    widgetWidth: '400px',
    widgetHeight: '700px',
    showAdvancedInfo: false,
    showReferencesPanel: false,
    // 是否顯示答案正文尾端「答案來源：...」摘要列；預設關閉，讓正式站台畫面更乾淨。
    showAnswerSourceFooter: false,
    // 是否顯示答案上方「已引用站內來源｜一般知識回答」狀態摘要列；預設關閉，避免一般訪客看到偏技術資訊。
    showAnswerStatusSubtitle: false,
    showFeedbackPanel: true,
    // 表格 / 統計型回答的呈現層設定：
    // - showResultCount：是否顯示「查詢結果共 N 筆」摘要
    // - useThousandsSeparator：是否對統計值套用千分位
    // - visibleAnswerTypes：限制要顯示的回答類型；null 代表顯示全部。
    showResultCount: true,
    useThousandsSeparator: true,
    visibleAnswerTypes: null,
    // FAQ / 引導式 FAQ 多候選時，最多列出幾筆讓使用者選。
    answerCandidateLimit: 5
  };

  // 跨頁對話保留設定：同一瀏覽器、同一站台與同一助理在換頁後可還原最近對話。
  // 目前採固定安全預設，不先公開成 data-* 參數，避免產生未完整治理的假設定。
  const CONVERSATION_PERSISTENCE_TTL_MS = 24 * 60 * 60 * 1000;
  const CONVERSATION_PERSISTENCE_MAX_MESSAGES = 40;
  const CONVERSATION_PERSISTENCE_MAX_JSON_CHARS = 120000;

  function safeStorageGetItem(key) {
    try {
      return global.localStorage ? global.localStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function safeStorageSetItem(key, value) {
    try {
      if (!global.localStorage) return false;
      global.localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function safeStorageRemoveItem(key) {
    try {
      if (global.localStorage) global.localStorage.removeItem(key);
    } catch (_) {}
  }

  function normalizePersistenceKeyPart(value, fallback) {
    const text = String(value || '').trim() || fallback;
    try {
      return encodeURIComponent(text.toLowerCase());
    } catch (_) {
      return fallback;
    }
  }

  function trimPersistenceText(value, maxLength = 4000) {
    const text = String(value || '');
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  function cloneForPersistence(value, maxChars = CONVERSATION_PERSISTENCE_MAX_JSON_CHARS) {
    if (value === null || value === undefined) return value;
    try {
      const json = JSON.stringify(value);
      if (!json || json.length > maxChars) return null;
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function sanitizeReferencesForPersistence(references) {
    if (!Array.isArray(references)) return [];
    return references.slice(0, 10).map((ref) => ({
      sourceType: trimPersistenceText(ref && ref.sourceType, 80),
      sourceTitle: trimPersistenceText(ref && ref.sourceTitle, 500),
      sourceUrl: trimPersistenceText(ref && ref.sourceUrl, 1000),
      snippetText: trimPersistenceText(ref && ref.snippetText, 1200),
      confidenceLevel: trimPersistenceText(ref && ref.confidenceLevel, 80),
      confidenceLabel: trimPersistenceText(ref && ref.confidenceLabel, 80),
      citationHint: trimPersistenceText(ref && ref.citationHint, 300),
      faqId: ref && ref.faqId ? ref.faqId : null,
      documentId: ref && ref.documentId ? ref.documentId : null,
      chunkId: ref && ref.chunkId ? ref.chunkId : null,
      score: ref && ref.score !== undefined ? ref.score : null
    }));
  }

  function sanitizeGuidedOptionsForPersistence(options) {
    if (!Array.isArray(options)) return [];
    return options.slice(0, 20).map((item) => ({
      optionText: trimPersistenceText(item && item.optionText, 300),
      displayOrder: Number(item && item.displayOrder || 0)
    })).filter((item) => item.optionText);
  }

  function sanitizeAnswerCandidatesForPersistence(candidates) {
    if (!Array.isArray(candidates)) return [];
    return candidates.slice(0, 10).map((item) => ({
      sourceType: trimPersistenceText(item && item.sourceType, 80),
      sourceId: item && item.sourceId !== undefined ? item.sourceId : null,
      question: trimPersistenceText(item && item.question, 1000),
      matchReason: trimPersistenceText(item && item.matchReason, 500),
      score: item && item.score !== undefined ? item.score : null
    })).filter((item) => item.question);
  }

  /* ------------------------------
   Widget 基礎工具區
   ------------------------------ */

  function normalizeAnswerCandidateLimit(value, fallback) {
    const number = parseInt(value, 10);
    if (!Number.isFinite(number) || number < 1) return fallback;
    return Math.min(number, 10);
  }

  function replaceSiteCodeTemplate(url, siteCode) {
    return url.replace('{siteCode}', encodeURIComponent(siteCode));
  }


  function trimSingleTrailingSlash(value) {
    return value ? value.replace(/\/$/, '') : '';
  }

  /*
   * 文字型公開參數正規化：
   * - undefined / null / 空白字串視為未設定，回退系統預設值。
   * - 保留嵌入者輸入的非空字串，避免後端 branding 或 runtime 設定覆蓋。
   */
  function normalizeTextOption(value, fallback) {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text ? text : fallback;
  }

  /*
   * v28.6.19.18.128：嵌入文字可用 &#10; 控制開頭、結尾與中間換行，
   * 因此不能套用一般文字的 trim()。
   */
  function normalizeEmbedTextOption(value, fallback) {
    if (value === null || value === undefined) return fallback;
    const text = String(value).replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '');
    return text.replace(/[\t ]+/g, '').replace(/\n/g, '') ? text : fallback;
  }

  /*
   * 空狀態條列文字支援三種格式：
   * - Array：create() 手動初始化時可直接傳入陣列。
   * - 字串：script data-empty-items 可用 | 或換行分隔多筆。
   * - Markdown 區塊：若內容含標題、清單、引用或分隔線，保留成一段安全 Markdown 呈現。
   */
  function normalizeTextListOption(value, fallback) {
    if (Array.isArray(value)) {
      const items = value.map((item) => String(item || '').trim()).filter(Boolean);
      return items.length ? items : fallback;
    }
    if (value === null || value === undefined) return fallback;
    const raw = String(value).replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '');
    if (!raw.replace(/[\t ]+/g, '').replace(/\n/g, '')) return fallback;

    // v28.6.19.18.125：data-empty-items 若使用 Markdown 區塊，保留換行與語法，不再拆成一般文字項目。
    // v28.6.19.18.128：若開頭或結尾使用 &#10; 做排版，也要保留，不可先 trim。
    const hasMarkdownBlock = /(^|\n)\s*(#{1,4}\s+|[-•●]\s+|\d+[.)]\s+|[（(]\d+[)）]\s+|>\s+|(?:-{3,}|_{3,}|\*{3,})\s*$)/m.test(raw);
    const hasEdgeNewline = /^\n|\n$/.test(raw);
    if (hasMarkdownBlock || hasEdgeNewline) return raw;

    const items = raw.split(/\r?\n|\|/).map((item) => item.trim()).filter(Boolean);
    return items.length ? items : fallback;
  }

  /*
   * Widget 尺寸設定正規化：
   * - 允許數字（自動補 px）或安全的 CSS 尺寸字串。
   * - 空值、0、負值或不合法格式會回退到預設尺寸。
   * - 真正的 viewport 安全邊界交由 CSS min/max/clamp 類型規則處理。
   */
  function normalizeWidgetDimension(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? `${value}px` : fallback;
    }

    const raw = String(value).trim();
    if (!raw) return fallback;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const numericValue = Number(raw);
      return Number.isFinite(numericValue) && numericValue > 0 ? `${numericValue}px` : fallback;
    }

    const isBasicLength = /^\d+(?:\.\d+)?(px|r?em|vh|vw|svh|svw|dvh|dvw|%)$/i.test(raw);
    const isExpression = /^(calc|min|max|clamp)\(.+\)$/i.test(raw);
    return isBasicLength || isExpression ? raw : fallback;
  }


  /*
   * Widget 面板模式正規化：
   * - modal：置中視窗。
   * - drawer-left / drawer-right：左右側抽屜。
   * - right-bottom-window / left-bottom-window：左右下角浮動視窗，可在桌機調整寬高。
   * - 未設定或非法值時一律回退為 right-bottom-window，避免後台預設與正式 Widget 預設不一致。
   */
  function normalizePanelMode(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'drawer-left' || raw === 'drawer-right' || raw === 'modal' || raw === 'right-bottom-window' || raw === 'left-bottom-window') return raw;
    return fallback;
  }

  function isResizableWindowPanelMode(mode) {
    return mode === 'modal' || mode === 'right-bottom-window' || mode === 'left-bottom-window';
  }


  /*
   * Widget 起始畫面模式正規化：
   * - home：完整首頁，引導文案 + 快速提問 + 空狀態
   * - suggestions：以快速提問為主，未對話前隱藏訊息區
   * - conversation：直接聚焦輸入與對話區
   */
  function normalizeStartView(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'home' || raw === 'suggestions' || raw === 'conversation') return raw;
    return fallback;
  }

  /*
   * Widget 行動版模式正規化：
   * - auto-fullscreen：手機版預設全螢幕
   * - same-as-desktop：沿用桌面規則
   * - hide：手機版不顯示 launcher 與面板
   */
  function normalizeMobileMode(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'auto-fullscreen' || raw === 'same-as-desktop' || raw === 'hide') return raw;
    return fallback;
  }

  /*
   * Widget 資訊密度正規化：
   * - comfortable：較舒適、較符合產品預設
   * - compact：較緊湊，適合資訊密度較高的站台
   */
  function normalizeDensity(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'comfortable' || raw === 'compact') return raw;
    return fallback;
  }

  /*
   * Widget 快速提問顯示模式正規化：
   * - auto / expanded：預設展開，送出問題後收合。
   * - collapsed：首次載入與重新開始時先收合。
   * - hidden：完全隱藏快速提問區。
   */
  function normalizeSuggestionsMode(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'auto' || raw === 'expanded' || raw === 'collapsed' || raw === 'hidden') return raw;
    return fallback;
  }

  function isMobileViewport() {
    return !!(global.matchMedia && global.matchMedia('(max-width: 640px)').matches);
  }

  /**
   * v28.6.19.19.273：手機瀏覽器可視高度同步。
   * Android Chrome / WebView 的 100vh 可能包含網址列，造成全螢幕面板上緣被吃掉，Header 與關閉鈕不可見。
   * 這裡優先使用 visualViewport 的實際可視範圍，並寫入 CSS 變數給手機全螢幕樣式使用。
   */
  function getViewportMetrics() {
    const visualViewport = global.visualViewport;
    const width = Math.max(320, Math.round(
      (visualViewport && visualViewport.width)
        || global.innerWidth
        || document.documentElement.clientWidth
        || 1024
    ));
    const height = Math.max(320, Math.round(
      (visualViewport && visualViewport.height)
        || global.innerHeight
        || document.documentElement.clientHeight
        || 720
    ));
    return { width, height };
  }

  function syncViewportMetrics(rootEl) {
    if (!rootEl) return;
    const metrics = getViewportMetrics();
    rootEl.style.setProperty('--ai-viewport-width', metrics.width + 'px');
    rootEl.style.setProperty('--ai-viewport-height', metrics.height + 'px');
  }


  /*
   * Widget launcher 位置正規化：
   * - 支援 bottom-right、bottom-left，並接受 left / right 簡寫。
   * - 未設定或非法值時回退到既有的 bottom-right。
   */
  function normalizeLauncherPosition(value, fallback) {
    const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (raw === 'left' || raw === 'bottom-left' || raw === 'left-bottom' || raw === 'top-left' || raw === 'left-top') return 'bottom-left';
    if (raw === 'right' || raw === 'bottom-right' || raw === 'right-bottom' || raw === 'top-right' || raw === 'right-top') return 'bottom-right';
    return fallback;
  }

  /*
   * Widget launcher 樣式正規化：
   * - bubble：原本的圓形浮動按鈕
   * - pill：帶文字的膠囊鈕
   * - icon-text：較穩定的圓角矩形入口
   */
  function normalizeLauncherStyle(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'bubble' || raw === 'pill' || raw === 'icon-text') return raw;
    return fallback;
  }

  /*
   * Widget launcher 位移量正規化：
   * - 允許 0、正數（自動補 px）與安全的 CSS 長度字串。
   * - 負值與非法格式會回退到預設值。
   */
  function normalizeLauncherOffset(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0 ? `${value}px` : fallback;
    }

    const raw = String(value).trim();
    if (!raw) return fallback;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const numericValue = Number(raw);
      return Number.isFinite(numericValue) && numericValue >= 0 ? `${numericValue}px` : fallback;
    }

    const isBasicLength = /^\d+(?:\.\d+)?(px|r?em|vh|vw|svh|svw|dvh|dvw|%)$/i.test(raw);
    const isExpression = /^(calc|min|max|clamp)\(.+\)$/i.test(raw);
    return isBasicLength || isExpression ? raw : fallback;
  }

  /*
   * 統一處理 Widget 對 Web API 的呼叫：
   * - 自動補上 base url 與 JSON header
   * - 盡量把 ProblemDetails / 純文字錯誤轉成可顯示訊息
   * - 讓後續 session/create、chat/send、feedback 共用同一套路徑
   */
  function buildApiUrl(base, path) {
    return trimSingleTrailingSlash(base) + path;
  }

  async function apiFetch(base, path, options) {
    const response = await fetch(buildApiUrl(base, path), {
      credentials: 'omit',
      // v28.6.19.19.151：Widget API 不使用瀏覽器快取。
      // iPad Safari 在 iframe / srcdoc 預覽內對 GET 快取較積極，可能造成快速提問拿到舊的空結果。
      // 對 session/create、chat/send 這類 POST 也維持 no-store，不影響資料正確性。
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options && options.headers ? options.headers : {}) },
      ...options
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!response.ok) {
      const detail = data && typeof data === 'object' ? (data.detail || data.title || JSON.stringify(data)) : (text || response.statusText);
      throw new Error(detail || 'API 呼叫失敗');
    }

    return data;
  }



  function parseColorToRgb(value) {
    if (!value) return null;
    const color = String(value).trim();
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let raw = hex[1];
      if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
      const intVal = parseInt(raw, 16);
      return { r: (intVal >> 16) & 255, g: (intVal >> 8) & 255, b: intVal & 255 };
    }
    const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgb) {
      return { r: Math.max(0, Math.min(255, parseInt(rgb[1], 10))), g: Math.max(0, Math.min(255, parseInt(rgb[2], 10))), b: Math.max(0, Math.min(255, parseInt(rgb[3], 10))) };
    }
    return null;
  }

  function normalizeWidgetColor(value, fallback) {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return parseColorToRgb(text) ? text : fallback;
  }

  function mixRgb(base, target, amount) {
    return {
      r: Math.round(base.r + (target.r - base.r) * amount),
      g: Math.round(base.g + (target.g - base.g) * amount),
      b: Math.round(base.b + (target.b - base.b) * amount)
    };
  }

  function rgbToString(rgb, alpha) {
    if (!rgb) return '';
    if (typeof alpha === 'number') return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  function getBrightness(rgb) {
    if (!rgb) return 255;
    return ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
  }

  function detectThemeMode(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    let bg = null;
    try {
      const target = document.body || document.documentElement;
      const value = global.getComputedStyle ? global.getComputedStyle(target).backgroundColor : '';
      bg = parseColorToRgb(value);
    } catch (_) {}

    if (bg) {
      return getBrightness(bg) < 148 ? 'dark' : 'light';
    }

    if (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  }

  function buildBrandShort(config) {
    if (config.brandShort) return String(config.brandShort).trim().slice(0, 5).toUpperCase();
    const source = config.brandName || config.title || 'AI';
    const latin = String(source).match(/[A-Za-z]+/g);
    if (latin && latin.length) {
      return latin.map((part) => part[0]).join('').slice(0, 3).toUpperCase();
    }
    return String(source).trim().slice(0, 2).toUpperCase() || 'AI';
  }


  function shouldShowBrandPill(config) {
    const explicitShort = String(config.brandShort || '').trim();
    const explicitName = String(config.brandName || '').trim();
    const title = String(config.title || '').trim();
    if (!explicitShort && !explicitName) return false;
    const shortVal = (explicitShort ? explicitShort.slice(0, 5) : buildBrandShort(config)).toUpperCase();
    const titleUpper = title.toUpperCase();
    if (explicitName && explicitName !== title) return true;
    if (explicitShort && explicitShort !== title && explicitShort.toUpperCase() !== titleUpper) return true;
    if (shortVal && titleUpper && shortVal !== titleUpper && !titleUpper.startsWith(shortVal)) return true;
    return false;
  }

  function applyBrandTheme(root, config) {
    const primary = parseColorToRgb(config.primaryColor) || { r: 37, g: 99, b: 235 };
    const theme = detectThemeMode(config.themeMode);
    const surfaceBase = theme === 'dark' ? { r: 15, g: 23, b: 42 } : { r: 255, g: 255, b: 255 };
    const panelBase = theme === 'dark' ? { r: 17, g: 24, b: 39 } : { r: 248, g: 250, b: 252 };
    const soft = mixRgb(primary, surfaceBase, theme === 'dark' ? 0.78 : 0.9);
    const border = mixRgb(primary, surfaceBase, theme === 'dark' ? 0.72 : 0.82);
    const badge = mixRgb(primary, { r: 255, g: 255, b: 255 }, 0.12);
    const textStrong = theme === 'dark' ? 'rgba(248, 250, 252, .96)' : 'rgba(15, 23, 42, .96)';
    const textMuted = theme === 'dark' ? 'rgba(203, 213, 225, .86)' : 'rgba(71, 85, 105, .9)';

    root.classList.remove('theme-light', 'theme-dark', 'panel-style-solid', 'panel-style-soft');
    root.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light');
    root.classList.add(config.panelStyle === 'solid' ? 'panel-style-solid' : 'panel-style-soft');
    root.style.setProperty('--ai-primary', rgbToString(primary));
    root.style.setProperty('--ai-primary-soft', rgbToString(mixRgb(primary, { r: 255, g: 255, b: 255 }, theme === 'dark' ? 0.08 : 0.84)));
    root.style.setProperty('--ai-primary-softer', rgbToString(mixRgb(primary, panelBase, theme === 'dark' ? 0.72 : 0.92)));
    root.style.setProperty('--ai-primary-contrast', getBrightness(primary) < 150 ? '#ffffff' : '#0f172a');
    root.style.setProperty('--ai-surface', rgbToString(surfaceBase));
    root.style.setProperty('--ai-surface-soft', rgbToString(panelBase));
    root.style.setProperty('--ai-surface-elevated', rgbToString(soft));
    root.style.setProperty('--ai-border', rgbToString(border, theme === 'dark' ? 0.72 : 0.34));
    root.style.setProperty('--ai-border-strong', rgbToString(mixRgb(primary, surfaceBase, theme === 'dark' ? 0.55 : 0.68), theme === 'dark' ? 0.88 : 0.48));
    root.style.setProperty('--ai-text-strong', textStrong);
    root.style.setProperty('--ai-text-muted', textMuted);
    root.style.setProperty('--ai-shadow', theme === 'dark' ? '0 22px 55px rgba(2, 6, 23, .45)' : '0 22px 55px rgba(15, 23, 42, .18)');
    root.style.setProperty('--ai-brand-badge', rgbToString(badge));
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  /*
   * 回答正規化：
   * - 移除常見制式前言與收尾
   * - 將過長段落切成較易閱讀的區塊
   * - 讓 Widget 在前端顯示時更聚焦、不雜亂
   */
  function normalizeAnswerText(text) {
    let normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return '';

    // v28.6.19.18.7：FAQ 直答在後端保守回覆路徑可能被組成
    // 「1. 問題：1.[FAQ] 答案...」這種不易閱讀的單行文字。
    // Widget 顯示層先做輕量斷行，讓問題標題與 FAQ 條列答案分開，
    // 同時不改變原始 API 契約與安全連結解析規則。
    normalized = normalized
      .replace(/^(\d+[.)]\s*)?([^\n]{2,80}[？?])\s*[：:]\s*(?=\d+[.)]\s*\[FAQ)/, '$2：\n')
      .replace(/([：:])\s*(?=\d+[.)]\s*\[FAQ)/g, '$1\n');

    const lines = normalized.split('\n');
    const leadInPattern = /^(以下是依網站知識整理的重點|依網站知識整理如下|以下整理重點如下|以下說明如下)[：:]?$/;
    const boilerplateEndingPattern = /(若您需要，我也可以再整理|如果您需要，我也可以再整理|也可以再整理成條列重點|也可以再整理成需求摘要)/;
    const compacted = [];

    const splitLongLine = (line) => {
      const raw = String(line || '').replace(/\t/g, '  ').replace(/[ \t]+$/g, '');
      const trimmed = raw.trim();
      // v28.6.19.18.145：Markdown 標題與清單項目必須保持為同一行。
      // 長標題或清單項目內若含句點、連結，不能被拆成段落，否則會造成 ### 或清單順序失效。
      const markdownHeadingLinePattern = /^#{1,6}\s+\S/;
      if (markdownHeadingLinePattern.test(trimmed)) return [trimmed];
      // v28.6.19.18.147：階層清單需要保留行首縮排，不能先 trim 掉。
      // 兩個空白代表下一層，最多支援 3 層；長清單項目也不可被拆段。
      const markdownListItemPattern = /^\s*(?:[-•●]\s+|\d+[.)]\s+|[（(]\d+[)）]\s+)/;
      if (markdownListItemPattern.test(raw)) return [raw];
      if (trimmed.length <= 88 || !/[。！？]/.test(trimmed)) return [trimmed];
      const parts = trimmed.match(/[^。！？]+[。！？]?/g) || [trimmed];
      if (parts.length <= 1) return [trimmed];
      const grouped = [];
      let current = '';
      parts.map((part) => part.trim()).filter(Boolean).forEach((part) => {
        if (current && (current.length + part.length) > 72) {
          grouped.push(current.trim());
          current = part;
          return;
        }
        current = current ? current + ' ' + part : part;
      });
      if (current) grouped.push(current.trim());
      return grouped.length ? grouped : [trimmed];
    };

    lines.forEach((rawLine) => {
      const raw = String(rawLine || '').replace(/\t/g, '  ').replace(/[ \t]+$/g, '');
      const line = raw.trim();
      if (!line) {
        if (compacted.length && compacted[compacted.length - 1] !== '') compacted.push('');
        return;
      }
      if (leadInPattern.test(line) && lines.length > 1) return;
      if (boilerplateEndingPattern.test(line)) return;
      splitLongLine(raw).forEach((segment) => {
        if (!segment || !String(segment).trim()) return;
        if (segment === compacted[compacted.length - 1]) return;
        compacted.push(segment);
      });
    });

    while (compacted.length && compacted[compacted.length - 1] === '') compacted.pop();
    return compacted.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }


  /**
   * 將 FAQ / Guided FAQ 答案中的連結安全渲染成可點擊連結。
   * 支援：
   * - Markdown 連結：[顯示文字](https://example.com)
   * - 純網址：https://example.com
   * 安全原則：只允許 http / https / mailto，不執行 HTML，不接受 javascript: 等危險協定。
   */
  function normalizeSafeAnswerUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
      const url = new URL(value, global.location ? global.location.href : undefined);
      const protocol = String(url.protocol || '').toLowerCase();
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') return url.href;
    } catch (_) {
      return '';
    }
    return '';
  }

  function decodeAnswerHtmlEntities(value) {
    return String(value || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  function stripAnswerHtmlTags(value) {
    return decodeAnswerHtmlEntities(String(value || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  }

  function normalizeInlineAnswerLinkMarkup(value) {
    let normalized = String(value || '');
    // v28.6.19.18.243：外部流程 n8n / RAG 有時會把原 FAQ Markdown 連結轉成 HTML anchor。
    // Widget 不執行 HTML，但可把安全的 <a href="...">文字</a> 轉回 Markdown 連結，再走既有安全 URL 過濾。
    normalized = normalized.replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (full, _quote, rawUrl, rawLabel) => {
      const safeUrl = normalizeSafeAnswerUrl(decodeAnswerHtmlEntities(rawUrl));
      const label = stripAnswerHtmlTags(rawLabel) || safeUrl;
      if (!safeUrl) return label || full;
      return `[${label.replace(/[\[\]\r\n]/g, ' ').trim()}](${safeUrl})`;
    });
    // n8n / LLM 有時會為了跳脫 JSON 或 Markdown 把 [ ] ( ) 前面加反斜線；顯示前收斂回標準 Markdown。
    normalized = normalized.replace(/\\([\[\]\(\)])/g, '$1');
    return normalized;
  }

  function appendSafeAnswerLink(host, label, rawUrl) {
    const href = normalizeSafeAnswerUrl(rawUrl);
    if (!href) {
      host.appendChild(document.createTextNode(label || rawUrl || ''));
      return;
    }
    const a = document.createElement('a');
    a.className = 'ai-assistant-widget-answer-link';
    a.href = href;
    a.textContent = label || href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    host.appendChild(a);
  }

  function appendInlineMarkdownNode(host, tagName, className, text) {
    const el = document.createElement(tagName);
    el.className = className;
    el.textContent = text || '';
    host.appendChild(el);
  }

  function appendAnswerTextWithSafeLinks(host, text) {
    const raw = normalizeInlineAnswerLinkMarkup(text || '');
    if (!raw) return;

    // v28.6.19.18.102：FAQ 與引導式 FAQ 答案支援安全的基本 Markdown 文字樣式。
    // v28.6.19.18.243：Markdown 連結的 URL 不限絕對網址，會再交由 normalizeSafeAnswerUrl 做安全過濾，支援站內相對路徑與 n8n RAG 回傳的連結。
    // 只允許連結、粗體、斜體與行內代碼；HTML 仍以純文字顯示，不執行 script。
    const tokenPattern = /(!)?\[([^\]\n]{1,200})\]\(([^\s)]+)\)|(https?:\/\/[^\s<>()]+|mailto:[^\s<>()]+|tel:[^\s<>()]+)|(\*\*([^*\n]{1,240})\*\*)|(\*([^*\n]{1,200})\*)|(`([^`\n]{1,200})`)/gi;
    const trailingPunctuationPattern = /[，。；、,.!?！？:：]+$/;
    let cursor = 0;
    let match;

    while ((match = tokenPattern.exec(raw)) !== null) {
      const isImageSyntax = !!match[1];
      if (match.index > cursor) {
        host.appendChild(document.createTextNode(raw.slice(cursor, match.index)));
      }

      const markdownLabel = match[2];
      const markdownUrl = match[3];
      let bareUrl = match[4];
      const boldText = match[6];
      const italicText = match[8];
      const codeText = match[10];

      if (isImageSyntax) {
        // 不支援在 FAQ 答案中直接渲染圖片 Markdown，避免外部圖片污染版面與造成安全風險。
        host.appendChild(document.createTextNode(match[0]));
      } else if (markdownUrl) {
        appendSafeAnswerLink(host, markdownLabel, markdownUrl);
      } else if (bareUrl) {
        const trailing = (bareUrl.match(trailingPunctuationPattern) || [''])[0];
        if (trailing) bareUrl = bareUrl.slice(0, -trailing.length);
        appendSafeAnswerLink(host, bareUrl, bareUrl);
        if (trailing) host.appendChild(document.createTextNode(trailing));
      } else if (boldText) {
        appendInlineMarkdownNode(host, 'strong', 'ai-assistant-widget-answer-strong', boldText);
      } else if (italicText) {
        appendInlineMarkdownNode(host, 'em', 'ai-assistant-widget-answer-emphasis-text', italicText);
      } else if (codeText) {
        appendInlineMarkdownNode(host, 'code', 'ai-assistant-widget-answer-code', codeText);
      }

      cursor = match.index + match[0].length;
    }

    if (cursor < raw.length) {
      host.appendChild(document.createTextNode(raw.slice(cursor)));
    }
  }

  function appendAnswerParagraphWithLabelEmphasis(host, value) {
    const raw = String(value || '').trim();
    const labelMatch = raw.match(/^([一-鿿A-Za-z0-9_／/（）()「」『』\-\s]{2,24})([：:])(.{2,})$/);
    if (!labelMatch) {
      appendAnswerTextWithSafeLinks(host, raw);
      return;
    }

    const label = labelMatch[1].trim();
    const body = labelMatch[3].trim();
    if (!label || !body || /^https?$/i.test(label)) {
      appendAnswerTextWithSafeLinks(host, raw);
      return;
    }

    // v28.6.19.18.255：模型或 FAQ 不一定都會輸出 Markdown **粗體**。
    // 對「重點：內容」這類回答標籤做安全前端強調，讓 Widget 閱讀層次更穩定；仍不執行 HTML。
    appendInlineMarkdownNode(host, 'strong', 'ai-assistant-widget-answer-strong', `${label}${labelMatch[2]}`);
    host.appendChild(document.createTextNode(' '));
    appendAnswerTextWithSafeLinks(host, body);
  }

  /*
   * v28.6.19.18.128：嵌入參數文字要保留開頭、結尾與中間的連續換行。
   * data-welcome-message / data-empty-items 常會用 &#10; 控制排版，因此不可用 trim() 移除前後換行。
   */
  function normalizeEmbedMarkdownText(value) {
    if (value === null || value === undefined) return '';
    const normalized = String(value)
      .replace(/\r\n?/g, '\n')
      .replace(/[\t ]+$/gm, '');
    return normalized.replace(/[\t ]+/g, '').replace(/\n/g, '') ? normalized : '';
  }

  /*
   * 將純文字回答轉成可閱讀的 DOM 結構。
   * 會嘗試辨識：標題、段落、項目清單、編號清單、引用與分隔線，
   * 讓回答主體看起來更像成熟產品而不是一大塊文字。
   */
  function buildAnswerContent(text, options) {
    const container = createEl('div', 'ai-assistant-widget-answer-content');
    const preserveBlankLines = !!(options && options.preserveBlankLines);
    const normalized = preserveBlankLines ? normalizeEmbedMarkdownText(text) : normalizeAnswerText(text);
    if (!normalized) return container;

    const lines = normalized.split('\n');
    // v28.6.19.18.147：清單改用 stack 管理，才能保留 FAQ / 引導式 FAQ 的 1~3 層階層清單。
    // 產生 class：ai-assistant-widget-answer-list-level-1 / ai-assistant-widget-answer-list-level-2 / ai-assistant-widget-answer-list-level-3。
    // 每層清單在建立時就放回目前 DOM 位置，避免後續段落把清單擠到最後。
    let activeListStack = [];
    let activeQuote = null;
    let currentSection = createEl('section', 'ai-assistant-widget-answer-section ai-assistant-widget-answer-emphasis');

    const headingOnlyPattern = /^(摘要|重點說明|主要定位與背景|主要產品與服務（概要）|公司定位與背景|主要產品與技術|主要應用範例|安全、監管與爭議|使用與商業面向|定位|主要產品|常見用途|補充說明|結論|重點|注意事項|限制|建議)[：:]?$/;
    const headingWithBodyPattern = /^(摘要|重點說明|主要定位與背景|主要產品與服務（概要）|公司定位與背景|主要產品與技術|主要應用範例|安全、監管與爭議|使用與商業面向|定位|主要產品|常見用途|補充說明|結論|重點|注意事項|限制|建議)[：:](.+)$/;
    // v28.6.19.18.145：FAQ 與引導式 FAQ 答案支援安全 Markdown 小標題。
    // 只把 # / ## / ### / #### / ##### / ###### 轉成內部標題節點，不直接渲染 HTML。
    // 標題內容可能較長，仍應去除 Markdown 符號並保持原始順序。
    const markdownHeadingPattern = /^#{1,6}\s+(.+)$/;
    const numberedHeadingPattern = /^[一二三四五六七八九十0-9]+[.、]\s*/;
    const questionHeadingPattern = /^.{2,80}[？?][：:]?$/;
    const bulletPattern = /^\s*([-•●])\s+/;
    // v28.6.19.18.105：支援 Markdown 編號清單，安全轉成 <ol><li>。
    const orderedPattern = /^\s*(\d+[.)]|[（(]\d+[)）])\s+/;
    // v28.6.19.18.147：用行首縮排判斷階層清單。2 個空白為第 2 層，4 個空白為第 3 層，超過仍限制在第 3 層。
    const nestedBulletPattern = /^(\s*)([-•●])\s+(.+)$/;
    const nestedOrderedPattern = /^(\s*)(\d+[.)]|[（(]\d+[)）])\s+(.+)$/;
    // v28.6.19.18.106：支援 Markdown 引用語法，安全轉成 <blockquote>。
    const quotePattern = /^>\s?(.+)$/;
    // v28.6.19.18.122：支援 Markdown 分隔線，安全轉成 <hr>，避免用空白行推測分隔線造成顯示不穩。
    const dividerPattern = /^(?:-{3,}|_{3,}|\*{3,})$/;

    const resetActiveLists = () => {
      activeListStack = [];
    };

    const appendNestedListItem = (level, desiredTag, value) => {
      const safeLevel = Math.max(1, Math.min(3, Number(level) || 1));
      let effectiveLevel = safeLevel;
      if (safeLevel > 1 && !activeListStack[safeLevel - 2]) {
        // 若使用者一開始就貼第 2 / 3 層縮排，前面沒有父層時，保守回到第 1 層，避免產生破碎 HTML。
        effectiveLevel = 1;
      }

      if (activeListStack.length > effectiveLevel) activeListStack = activeListStack.slice(0, effectiveLevel);
      const previousLevel = activeListStack[effectiveLevel - 1];
      if (!previousLevel || previousLevel.tag !== desiredTag) {
        if (activeListStack.length >= effectiveLevel) activeListStack = activeListStack.slice(0, effectiveLevel - 1);
        const list = createEl(desiredTag, `ai-assistant-widget-answer-list ai-assistant-widget-answer-list-level-${effectiveLevel}`);
        list.dataset.listLevel = String(effectiveLevel);
        if (effectiveLevel === 1) {
          currentSection.appendChild(list);
        } else {
          const parent = activeListStack[effectiveLevel - 2];
          const parentLi = parent && parent.lastLi;
          if (parentLi) parentLi.appendChild(list);
          else currentSection.appendChild(list);
        }
        activeListStack[effectiveLevel - 1] = { tag: desiredTag, list, lastLi: null };
      }

      const target = activeListStack[effectiveLevel - 1];
      const li = createEl('li', `ai-assistant-widget-answer-list-item ai-assistant-widget-answer-list-item-level-${effectiveLevel}`);
      li.dataset.listLevel = String(effectiveLevel);
      appendAnswerTextWithSafeLinks(li, value);
      target.list.appendChild(li);
      target.lastLi = li;
      activeListStack = activeListStack.slice(0, effectiveLevel);
    };

    const flushActiveList = resetActiveLists;

    const flushActiveQuote = () => {
      if (activeQuote && activeQuote.childNodes.length > 0) {
        currentSection.appendChild(activeQuote);
      }
      activeQuote = null;
    };

    const hasPendingSectionContent = () => (
      currentSection.childNodes.length > 0
      || (activeQuote && activeQuote.childNodes.length > 0)
    );

    const commitSection = () => {
      if (!currentSection) return;
      resetActiveLists();
      flushActiveQuote();
      if (currentSection.childNodes.length > 0) {
        container.appendChild(currentSection);
      }
      currentSection = createEl('section', 'ai-assistant-widget-answer-section');
    };

    const appendParagraph = (value) => {
      // v28.6.19.18.146：若前面已有 Markdown 清單，遇到一般段落時要先把清單放回目前位置。
      // 否則清單會一直暫存在 activeList，最後才被 append 到 section，造成畫面順序被移到段落後方。
      flushActiveList();
      flushActiveQuote();
      const p = createEl('p', 'ai-assistant-widget-answer-paragraph');
      appendAnswerParagraphWithLabelEmphasis(p, value);
      currentSection.appendChild(p);
    };

    lines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line) {
        if (preserveBlankLines) {
          flushActiveList();
          flushActiveQuote();
          if (currentSection.childNodes.length > 0) commitSection();
          // v28.6.19.18.128：保留嵌入參數開頭、結尾與中間的每一個 &#10;。
          // 例如 &#10;&#10;文字、文字&#10;&#10; 都要顯示對應空行，不可因位置在最前/最後而失效。
          container.appendChild(createEl('div', 'ai-assistant-widget-embed-line-break'));
          return;
        }
        if (hasPendingSectionContent() && index < lines.length - 1) commitSection();
        return;
      }

      if (dividerPattern.test(line)) {
        flushActiveList();
        flushActiveQuote();
        if (hasPendingSectionContent()) commitSection();
        // v28.6.19.18.125：分隔線獨立使用專用 section，避免外層 section border-top 與 <hr> 疊成兩條線。
        currentSection.classList.add('ai-assistant-widget-answer-divider-section');
        currentSection.appendChild(createEl('hr', 'ai-assistant-widget-answer-divider'));
        commitSection();
        return;
      }

      const rawListLine = String(rawLine || '').replace(/\t/g, '  ').replace(/[ \t]+$/g, '');
      const nestedOrdered = rawListLine.match(nestedOrderedPattern);
      const nestedBullet = rawListLine.match(nestedBulletPattern);
      if (nestedBullet || nestedOrdered) {
        const match = nestedOrdered || nestedBullet;
        const indent = (match[1] || '').length;
        const listLevel = Math.min(3, Math.floor(indent / 2) + 1);
        const desiredTag = nestedOrdered ? 'ol' : 'ul';
        flushActiveQuote();
        appendNestedListItem(listLevel, desiredTag, (match[3] || '').trim());
        return;
      }

      const quoteMatch = line.match(quotePattern);
      if (quoteMatch) {
        flushActiveList();
        if (!activeQuote) activeQuote = createEl('blockquote', 'ai-assistant-widget-answer-quote');
        const quoteLine = createEl('p', 'ai-assistant-widget-answer-quote-line');
        appendAnswerTextWithSafeLinks(quoteLine, quoteMatch[1].trim());
        activeQuote.appendChild(quoteLine);
        return;
      }

      flushActiveQuote();

      const markdownHeading = line.match(markdownHeadingPattern);
      if (markdownHeading) {
        if (hasPendingSectionContent()) commitSection();
        currentSection.appendChild(createEl('div', 'ai-assistant-widget-answer-heading', markdownHeading[1].trim()));
        if (container.childNodes.length > 0) currentSection.classList.remove('ai-assistant-widget-answer-emphasis');
        return;
      }

      const headingWithBody = line.match(headingWithBodyPattern);
      if (headingWithBody) {
        if (hasPendingSectionContent()) commitSection();
        currentSection.appendChild(createEl('div', 'ai-assistant-widget-answer-heading', headingWithBody[1]));
        if (container.childNodes.length > 0) currentSection.classList.remove('ai-assistant-widget-answer-emphasis');
        appendParagraph(headingWithBody[2].trim());
        return;
      }

      if (headingOnlyPattern.test(line) || questionHeadingPattern.test(line) || (numberedHeadingPattern.test(line) && line.length <= 22)) {
        if (hasPendingSectionContent()) commitSection();
        currentSection.appendChild(createEl('div', 'ai-assistant-widget-answer-heading', line.replace(/[：:]$/, '')));
        if (container.childNodes.length > 0) currentSection.classList.remove('ai-assistant-widget-answer-emphasis');
        return;
      }

      appendParagraph(line);
    });

    commitSection();

    if (!container.childNodes.length) {
      const fallback = createEl('section', 'ai-assistant-widget-answer-section ai-assistant-widget-answer-emphasis');
      const p = createEl('p', 'ai-assistant-widget-answer-paragraph');
      appendAnswerTextWithSafeLinks(p, normalized);
      fallback.appendChild(p);
      container.appendChild(fallback);
    }

    return container;
  }



  /*
   * v28.6.19.19.113：系統錯誤訊息使用專用 UI，而不是一般回答強調卡。
   * 這類訊息代表後端或外部流程處理失敗，應清楚、友善、可讓使用者知道下一步。
   */
  function isSystemFailureText(text) {
    return /^\s*系統處理失敗[：:]/.test(String(text || ''));
  }

  function normalizeSystemFailureDetail(text) {
    const raw = String(text || '').trim();
    const detail = raw.replace(/^\s*系統處理失敗[：:]\s*/, '').trim();
    return detail || '系統目前無法完成要求，請稍後再試。';
  }

  function extractTraceIdFromText(text) {
    const raw = String(text || '');
    const match = raw.match(/(?:traceId|trace id|追蹤代碼)\s*[：:]?\s*([A-Za-z0-9][A-Za-z0-9._:-]{5,})/i);
    return match ? match[1] : '';
  }

  function buildSystemErrorContent(text) {
    const detail = normalizeSystemFailureDetail(text);
    const traceId = extractTraceIdFromText(detail);
    const card = createEl('div', 'ai-assistant-widget-system-error-card');
    card.setAttribute('role', 'alert');

    const icon = createEl('div', 'ai-assistant-widget-system-error-icon', '!');
    icon.setAttribute('aria-hidden', 'true');

    const body = createEl('div', 'ai-assistant-widget-system-error-body');
    const top = createEl('div', 'ai-assistant-widget-system-error-top');
    top.appendChild(createEl('div', 'ai-assistant-widget-system-error-title', '系統暫時無法完成要求'));
    top.appendChild(createEl('div', 'ai-assistant-widget-system-error-badge', '系統訊息'));
    body.appendChild(top);
    body.appendChild(createEl('p', 'ai-assistant-widget-system-error-message', detail));

    const foot = createEl('div', 'ai-assistant-widget-system-error-foot');
    foot.appendChild(createEl('span', 'ai-assistant-widget-system-error-hint', traceId ? '請將此 traceId 提供給維運人員協助排查。' : '請稍後再試；若持續發生，請提供發生時間與問題內容給維運人員。'));
    if (traceId) {
      const trace = createEl('code', 'ai-assistant-widget-system-error-trace', `traceId：${traceId}`);
      foot.appendChild(trace);
    }
    body.appendChild(foot);

    card.appendChild(icon);
    card.appendChild(body);
    return card;
  }


  /*
   * v28.6.19.18.125：讓 Widget 嵌入參數的歡迎文字與空狀態內容支援安全 Markdown。
   * 使用與 FAQ / 引導式 FAQ 相同的安全轉換邏輯，不執行 HTML、script 或危險連結。
   */
  function buildSafeEmbedMarkdownContent(text, className) {
    const host = createEl('div', className || 'ai-assistant-widget-embed-markdown');
    const content = buildAnswerContent(text || '', { preserveBlankLines: true });
    content.classList.add('ai-assistant-widget-embed-markdown-content');
    host.appendChild(content);
    return host;
  }

  function appendInlineMarkdownContent(host, text) {
    appendAnswerTextWithSafeLinks(host, String(text || ''));
  }

  function isStructuredObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  // n8n 新協定的 table / composite / cards 會先走結構化渲染；
  // 只有在缺少 data.type 時，才會回退到純文字 assistantMessageText。
  function normalizeStructuredType(responseType, responseData) {
    const type = responseData && typeof responseData.type === 'string'
      ? responseData.type
      : responseType;
    return String(type || 'text').trim().toLowerCase();
  }

  function extractStructuredText(value) {
    return typeof value === 'string' ? value : '';
  }


  /*
   * 回答類型正規化：
   * - Widget 對外公開的可控類型以 text / table / links / list / cards 為主。
   * - markdown 會視為 text，方便嵌入者用較少的規則控制顯示。
   * - composite 不是直接顯示型別，而是容器；實際顯示由內部 sections 決定。
   */
  function normalizeVisibleAnswerType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'all' || raw === '*') return '*';
    if (raw === 'markdown') return 'text';
    if (raw === 'text' || raw === 'table' || raw === 'links' || raw === 'list' || raw === 'cards') return raw;
    return '';
  }

  function parseVisibleAnswerTypes(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const sourceItems = Array.isArray(value)
      ? value
      : String(value).split(/[\s,，|]+/g);
    const normalized = [];
    sourceItems.forEach((item) => {
      const type = normalizeVisibleAnswerType(item);
      if (!type) return;
      if (type === '*') {
        normalized.length = 0;
        return;
      }
      if (!normalized.includes(type)) normalized.push(type);
    });
    return normalized.length ? normalized : fallback;
  }


  function parseOptionalBoolean(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const raw = String(value).trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'yes') return true;
    if (raw === 'false' || raw === '0' || raw === 'no') return false;
    return fallback;
  }

  function isAnswerTypeVisible(type, config) {
    const allowed = config && Array.isArray(config.visibleAnswerTypes) ? config.visibleAnswerTypes : null;
    if (!allowed || !allowed.length) return true;
    const normalizedType = normalizeVisibleAnswerType(type);
    if (!normalizedType) return false;
    return allowed.includes(normalizedType);
  }

  function getVisibleAnswerTypes(config) {
    return config && Array.isArray(config.visibleAnswerTypes) ? config.visibleAnswerTypes.slice() : [];
  }

  function buildVisibleAnswerTypeLabel(type) {
    switch (normalizeVisibleAnswerType(type)) {
      case 'table': return '資料表格';
      case 'links': return '相關連結';
      case 'list': return '重點清單';
      case 'cards': return '重點卡片';
      case 'text': return '文字摘要';
      default: return '內容';
    }
  }

  function buildVisibleAnswerTypesSummary(config) {
    const allowed = getVisibleAnswerTypes(config);
    if (!allowed.length) return '全部';
    return allowed.map((type) => buildVisibleAnswerTypeLabel(type)).join('、');
  }

  function resolveStructuredVisibleType(section, responseType) {
    const normalizedType = normalizeVisibleAnswerType(normalizeStructuredType(responseType || '', section));
    if (normalizedType) return normalizedType;
    const fallbackText = extractStructuredText(section && (section.content || section.summary || ''));
    return fallbackText ? 'text' : '';
  }

  function buildHiddenAnswerTypeNotice(config, hiddenTypes) {
    const container = createEl('div', 'ai-assistant-widget-answer-content ai-assistant-widget-answer-structured');
    const section = createEl('section', 'ai-assistant-widget-structured-section is-filtered');
    section.appendChild(createEl('div', 'ai-assistant-widget-structured-label', '已依 Widget 顯示設定隱藏'));
    const dedupedTypes = Array.from(new Set((Array.isArray(hiddenTypes) ? hiddenTypes : []).map((type) => normalizeVisibleAnswerType(type)).filter(Boolean)));
    const hiddenTypeText = dedupedTypes.length
      ? dedupedTypes.map((type) => buildVisibleAnswerTypeLabel(type)).join('、')
      : '部分回答內容';
    const visibleTypeText = buildVisibleAnswerTypesSummary(config);
    section.appendChild(createEl('div', 'ai-assistant-widget-structured-empty', `此回答包含 ${hiddenTypeText}，但目前 data-visible-answer-types / Widget 顯示設定只允許顯示：${visibleTypeText}。`));
    container.appendChild(section);
    return container;
  }

  function moveAnswerContentChildren(target, text) {
    const fragment = buildAnswerContent(text || '');
    Array.from(fragment.childNodes).forEach(node => target.appendChild(node));
  }

  function buildStructuredSectionLabel(type, index) {
    switch (String(type || '').toLowerCase()) {
      case 'table': return '資料表格';
      case 'cards': return '重點卡片';
      case 'list': return '重點清單';
      case 'links': return '相關連結';
      case 'markdown':
      case 'text': return index === 0 ? '回答摘要' : '補充說明';
      default: return '內容區塊';
    }
  }

  function buildStructuredTextSection(section, index) {
    const wrapper = createEl('section', 'ai-assistant-widget-structured-section is-text');
    const contentText = extractStructuredText(section.content || section.summary || '');
    const title = extractStructuredText(section.title || section.label || '');
    if (title) {
      wrapper.appendChild(createEl('div', 'ai-assistant-widget-structured-label', title));
    } else if (index > 0) {
      wrapper.appendChild(createEl('div', 'ai-assistant-widget-structured-label', buildStructuredSectionLabel(section.type, index)));
    }
    const host = createEl('div', 'ai-assistant-widget-structured-text');
    moveAnswerContentChildren(host, contentText);
    wrapper.appendChild(host);
    return wrapper;
  }

  function buildStructuredListSection(section, index) {
    const wrapper = createEl('section', 'ai-assistant-widget-structured-section is-list');
    wrapper.appendChild(createEl('div', 'ai-assistant-widget-structured-label', extractStructuredText(section.title || section.label || '') || buildStructuredSectionLabel('list', index)));
    const list = createEl('ol', 'ai-assistant-widget-structured-list');
    const items = Array.isArray(section.items) ? section.items : [];
    items.forEach((item) => {
      const li = createEl('li', 'ai-assistant-widget-structured-list-item');
      // v28.6.19.18.35：n8n 結構化 list item 可能使用 text / label / value / meta，
      // 優先採用 text，避免只顯示 value 而遺失「臺北市 / 行政區 / 年度」這類重點脈絡。
      appendAnswerTextWithSafeLinks(li, typeof item === 'string'
        ? item
        : extractStructuredText(item && (item.text || item.content || item.title || item.label || item.value || item.message)) || JSON.stringify(item));
      list.appendChild(li);
    });
    if (!list.childNodes.length) {
      moveAnswerContentChildren(wrapper, extractStructuredText(section.content || ''));
      return wrapper;
    }
    wrapper.appendChild(list);
    return wrapper;
  }


  // links section 是跨案可擴充型別；Widget 在前端再做一次 URL 安全過濾與顯示正規化，
  // 避免不安全協定、重複連結或缺少 title 的資料直接進畫面，並維持不同專案輸出的呈現一致性。
    /*
   * 將 links section item 收斂成 Widget 可安全顯示的結構。
   * 這層即使後端已過濾，前端仍再做一次安全 URL 驗證與標題 / host 摘要整理，避免外部資料直接污染畫面。
   */
  function normalizeStructuredLink(item) {
    if (!item || typeof item !== 'object') return null;
    const rawUrl = extractStructuredText(item.url || '');
    if (!rawUrl) return null;
    let url = '';
    try {
      const parsed = new URL(rawUrl);
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(protocol)) return null;
      url = parsed.toString();
    } catch (_) {
      return null;
    }
    const title = extractStructuredText(item.title || item.label || url || '連結');
    const description = extractStructuredText(item.description || item.content || '');
    const kind = extractStructuredText(item.kind || '');
    const target = extractStructuredText(item.target || '_blank') === '_self' ? '_self' : '_blank';
    let hostLabel = '';
    try {
      const parsed = new URL(url);
      hostLabel = parsed.host || (parsed.protocol === 'mailto:' ? '電子郵件' : parsed.protocol === 'tel:' ? '電話' : '');
    } catch (_) {}
    return { title, url, description, kind, target, hostLabel };
  }

    /*
   * 將 links section 轉成可掃描的連結清單，而不是把整批 URL 硬攤平成純文字。
   * 設計原則：保留 title、description、kind、host，並以 RWD 方式呈現。
   */
  function buildStructuredLinksSection(section, index) {
    const wrapper = createEl('section', 'ai-assistant-widget-structured-section is-links');
    wrapper.appendChild(createEl('div', 'ai-assistant-widget-structured-label', extractStructuredText(section.title || section.label || '') || buildStructuredSectionLabel('links', index)));
    const list = createEl('div', 'ai-assistant-widget-structured-links');
    const items = Array.isArray(section.items) ? section.items : [];
    const seen = new Set();
    items.forEach((item) => {
      const normalized = normalizeStructuredLink(item);
      if (!normalized) return;
      const dedupeKey = `${normalized.url}|${normalized.title}`.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      const entry = createEl('div', 'ai-assistant-widget-structured-link-item');
      const anchor = createEl('a', 'ai-assistant-widget-structured-link-anchor', normalized.title);
      anchor.href = normalized.url;
      anchor.target = normalized.target;
      anchor.rel = normalized.target === '_blank' ? 'noopener noreferrer' : 'noopener';
      entry.appendChild(anchor);
      const metaBits = [normalized.kind, normalized.hostLabel].filter(Boolean);
      if (metaBits.length) {
        entry.appendChild(createEl('div', 'ai-assistant-widget-structured-link-meta', metaBits.join('｜')));
      }
      if (normalized.description) {
        entry.appendChild(createEl('div', 'ai-assistant-widget-structured-link-description', normalized.description));
      }
      list.appendChild(entry);
    });
    if (!list.childNodes.length) {
      const fallback = extractStructuredText(section.content || '');
      if (fallback) {
        moveAnswerContentChildren(wrapper, fallback);
      }
      return wrapper;
    }
    wrapper.appendChild(list);
    return wrapper;
  }

  function buildStructuredCardsSection(section, index) {
    const wrapper = createEl('section', 'ai-assistant-widget-structured-section is-cards');
    wrapper.appendChild(createEl('div', 'ai-assistant-widget-structured-label', extractStructuredText(section.title || section.label || '') || buildStructuredSectionLabel('cards', index)));
    const grid = createEl('div', 'ai-assistant-widget-structured-cards');
    // v28.6.19.18.35：下層 n8n 目前以 cards[] 輸出卡片；舊版 Widget 只讀 items[]，
    // 會造成 API 已有 cards section 但畫面沒有卡片。本版同時支援 cards[] / items[]。
    const items = Array.isArray(section.cards) ? section.cards : (Array.isArray(section.items) ? section.items : []);
    items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const card = createEl('div', 'ai-assistant-widget-structured-card');
      const title = normalizeDisplayParentheses(item.title || item.label || item.name || '') || '項目';
      const subtitle = normalizeDisplayParentheses(item.subtitle || item.description || '');
      const directValue = normalizeDisplayParentheses(item.value || item.content || item.message || '');
      card.appendChild(createEl('div', 'ai-assistant-widget-structured-card-title', title));
      if (subtitle) card.appendChild(createEl('div', 'ai-assistant-widget-structured-card-subtitle', subtitle));
      if (directValue) card.appendChild(createEl('div', 'ai-assistant-widget-structured-card-value', directValue));
      const fields = Array.isArray(item.fields) ? item.fields : (Array.isArray(item.metrics) ? item.metrics : []);
      if (fields.length) {
        const fieldList = createEl('div', 'ai-assistant-widget-structured-card-fields');
        fields.forEach((field) => {
          if (!field || typeof field !== 'object') return;
          const row = createEl('div', 'ai-assistant-widget-structured-card-field');
          row.appendChild(createEl('span', 'ai-assistant-widget-structured-card-field-label', normalizeDisplayParentheses(field.label || field.name || '') || '欄位'));
          const valueText = normalizeDisplayParentheses(field.value || field.text || '') || '-';
          const unitText = normalizeDisplayParentheses(field.unit || '');
          row.appendChild(createEl('span', 'ai-assistant-widget-structured-card-field-value', unitText ? `${valueText}${unitText}` : valueText));
          fieldList.appendChild(row);
        });
        if (fieldList.childNodes.length) card.appendChild(fieldList);
      }
      if (card.childNodes.length > 1) grid.appendChild(card);
    });
    if (!grid.childNodes.length) return null;
    wrapper.appendChild(grid);
    return wrapper;
  }

  function normalizeDisplayParentheses(value) {
    return extractStructuredText(value || '').replace(/（/g, '(').replace(/）/g, ')');
  }

  function normalizeDisplayToken(value) {
    return normalizeDisplayParentheses(value).replace(/\s+/g, '').toLowerCase();
  }

  function labelAlreadyIncludesUnit(label, unit) {
    const normalizedLabel = normalizeDisplayToken(label);
    const normalizedUnit = normalizeDisplayToken(unit);
    if (!normalizedLabel || !normalizedUnit) return false;
    return normalizedLabel.includes(`(${normalizedUnit})`) || normalizedLabel.endsWith(normalizedUnit);
  }

  function formatStructuredColumnHeader(column, columnMetaItem) {
    // v28.6.19.18.37：n8n 的 section.columns 是實際給使用者看的欄位標題，優先採用。
    // columnMeta.unit 只作為 fallback 補充；若欄名已含單位，不可再追加一次，避免顯示成「人口數/男(人)(人)」。
    const columnLabel = normalizeDisplayParentheses(column);
    const metaLabel = normalizeDisplayParentheses(columnMetaItem && (columnMetaItem.label || columnMetaItem.name));
    const rawLabel = columnLabel || metaLabel;
    const unit = normalizeDisplayParentheses(columnMetaItem && (columnMetaItem.unit || columnMetaItem.valueRole || ''));
    if (!rawLabel && !unit) return '';
    if (!unit || labelAlreadyIncludesUnit(rawLabel, unit)) return rawLabel;
    return `${rawLabel}(${unit})`;
  }

  /*
   * 嘗試把各種欄位值轉成可格式化的數字。
   * 主要用於表格 / cards / result count 中的統計欄位，若不是純數字則回傳 null，避免錯把文字欄位做千分位。
   */
  function tryParseNumericValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumericWithThousands(value, languageCode) {
    const numericValue = tryParseNumericValue(value);
    if (numericValue === null) return value == null ? '' : String(value);
    const formatter = new Intl.NumberFormat(languageCode || 'zh-TW', { maximumFractionDigits: 20 });
    return formatter.format(numericValue);
  }

  function formatStructuredCellValue(cell, columnMetaItem, config) {
    if (!config || config.useThousandsSeparator === false) {
      return cell == null ? '' : String(cell);
    }
    const isMetric = !!(columnMetaItem && columnMetaItem.isStatisticalValue);
    const dataType = String((columnMetaItem && columnMetaItem.dataType) || '').trim();
    const shouldFormat = isMetric || dataType === '數值' || dataType.toLowerCase() === 'number';
    if (!shouldFormat) return cell == null ? '' : String(cell);
    return formatNumericWithThousands(cell, config.languageCode);
  }

  function extractPrimaryTableSection(responseData) {
    if (!isStructuredObject(responseData)) return null;
    const normalizedType = normalizeStructuredType(responseData.type || '', responseData);
    if (normalizedType === 'table') return responseData;
    if (normalizedType === 'composite' && Array.isArray(responseData.sections)) {
      return responseData.sections.find((section) => normalizeStructuredType(section && section.type || '', section) === 'table') || null;
    }
    return null;
  }

  function extractStructuredResultCount(responseData, responseMeta) {
    if (responseMeta && Number.isFinite(Number(responseMeta.resultCount))) {
      return Math.max(Number(responseMeta.resultCount), 0);
    }
    const tableSection = extractPrimaryTableSection(responseData);
    if (tableSection && Array.isArray(tableSection.rows)) {
      return tableSection.rows.length;
    }
    return 0;
  }

  /*
   * 根據 rows / rowCount / meta 等資訊整理出「查詢結果共 N 筆」提示。
   * showResultCount=false 時會直接略過；useThousandsSeparator=true 時會套用數值格式化。
   */
  function isRuntimeTraceWarning(value) {
    const text = String(value || '').trim().toUpperCase();
    return text.startsWith('RESPONSE_MODE:') || text.startsWith('RESPONSE_POLICY:') || text.startsWith('MATCHED_BY:');
  }

  function sanitizeUserVisibleWarnings(warnings) {
    if (!Array.isArray(warnings)) return [];
    return warnings.map((item) => String(item || '').trim()).filter((item) => item && !isRuntimeTraceWarning(item));
  }

  function normalizeKnowledgeRetrievalDiagnosis(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const toNumber = (input) => {
      const number = Number(input);
      return Number.isFinite(number) ? Math.max(0, number) : 0;
    };

    return {
      retrievalProvider: String(value.retrievalProvider || '').trim(),
      keywordCount: toNumber(value.keywordCount),
      faqCandidateCount: toNumber(value.faqCandidateCount),
      faqPassedGuardCount: toNumber(value.faqPassedGuardCount),
      documentCandidateCount: toNumber(value.documentCandidateCount),
      documentPassedGuardCount: toNumber(value.documentPassedGuardCount),
      documentLexicalPassedCount: toNumber(value.documentLexicalPassedCount),
      documentSemanticPassedCount: toNumber(value.documentSemanticPassedCount),
      bestDocumentScore: toNumber(value.bestDocumentScore),
      bestDocumentKeywordScore: toNumber(value.bestDocumentKeywordScore),
      bestDocumentVectorScore: toNumber(value.bestDocumentVectorScore),
      documentVectorAvailableCount: toNumber(value.documentVectorAvailableCount),
      documentVectorComparableCount: toNumber(value.documentVectorComparableCount),
      queryEmbeddingAvailable: !!value.queryEmbeddingAvailable,
      diagnosticSummary: String(value.diagnosticSummary || '').trim()
    };
  }

  function ensureAssistantAnswerText(text, responseMode) {
    const normalized = String(text || '').trim();
    if (normalized) return normalized;
    if (String(responseMode || '').toUpperCase() === 'STRICT_KNOWLEDGE') {
      return '目前站內知識尚未命中足夠可引用內容，為避免誤答，本次不直接產生自由回答。';
    }
    return '目前沒有取得可顯示的回答內容，請稍後再試，或改用更明確的站內關鍵字重新提問。';
  }


  function formatResponseModeLabel(responseMode) {
    const mode = String(responseMode || '').trim().toUpperCase();
    if (mode === 'GENERAL_KNOWLEDGE') return '一般知識回答';
    if (mode === 'STRICT_KNOWLEDGE') return '嚴格知識回答';
    if (mode === 'OPENAI_ONLY') return '模型回答';
    if (mode === 'EXTERNAL_WORKFLOW') return '外部流程';
    if (mode === 'FAQ_GUIDED_THEN_EXTERNAL_WORKFLOW') return 'FAQ優先→外部流程';
    if (mode === 'FAQ_GUIDED_THEN_OPENAI') return 'FAQ優先→模型回答';
    if (mode === 'FAQ_GUIDED_RAG_THEN_EXTERNAL_WORKFLOW') return 'FAQ→知識→外部流程';
    if (mode === 'FAQ_GUIDED_RAG_THEN_OPENAI') return 'FAQ→知識→模型';
    if (mode === 'AUTO') return '自動判斷';
    return responseMode || '';
  }

  function buildResultCountHint(responseData, responseMeta, warnings, config) {
    if (!config || config.showResultCount === false) return null;
    if (!isAnswerTypeVisible('table', config)) return null;
    const resultCount = extractStructuredResultCount(responseData, responseMeta);
    if (!resultCount) return null;
    const wrapper = createEl('div', 'ai-assistant-widget-inline-summary');
    const title = createEl('div', 'ai-assistant-widget-inline-summary-title', '查詢結果');
    let summaryText = `共 ${formatNumericWithThousands(resultCount, config.languageCode)} 筆`;
    if (Array.isArray(warnings) && warnings.some((item) => String(item || '').indexOf('ROW_LIMIT_REACHED') >= 0)) {
      summaryText += '(目前為顯示上限內的結果)';
    }
    wrapper.appendChild(title);
    wrapper.appendChild(createEl('div', 'ai-assistant-widget-inline-summary-text', summaryText));
    return wrapper;
  }

  function buildStructuredTableSection(section, index, config) {
    const wrapper = createEl('section', 'ai-assistant-widget-structured-section is-table');
    wrapper.appendChild(createEl('div', 'ai-assistant-widget-structured-label', extractStructuredText(section.title || section.label || '') || buildStructuredSectionLabel('table', index)));
    const surface = createEl('div', 'ai-assistant-widget-structured-table-surface');
    const scroll = createEl('div', 'ai-assistant-widget-structured-table-scroll');
    const table = createEl('table', 'ai-assistant-widget-structured-table');
    const columns = Array.isArray(section.columns) ? section.columns : [];
    const rows = Array.isArray(section.rows) ? section.rows : [];
    const columnMeta = Array.isArray(section.columnMeta) ? section.columnMeta : [];
    const effectiveColumns = columns.length
      ? columns
      : columnMeta.map((item) => formatStructuredColumnHeader('', item)).filter((item) => item);
    if (effectiveColumns.length) {
      const thead = createEl('thead', '');
      const tr = createEl('tr', '');
      effectiveColumns.forEach((column, idx) => {
        const th = createEl('th', '', formatStructuredColumnHeader(column, columnMeta[idx]) || normalizeDisplayParentheses(typeof column === 'string' ? column : String(column || '')));
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
    }
    const tbody = createEl('tbody', '');
    rows.forEach((row) => {
      const tr = createEl('tr', '');
      if (Array.isArray(row)) {
        row.forEach((cell, cellIndex) => {
          const td = createEl('td', '');
          td.textContent = formatStructuredCellValue(cell, columnMeta[cellIndex], config);
          tr.appendChild(td);
        });
      } else {
        const td = createEl('td', '');
        td.textContent = row == null ? '' : String(row);
        td.colSpan = Math.max(effectiveColumns.length || 1, 1);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    surface.appendChild(scroll);
    if (!rows.length && !effectiveColumns.length) {
      surface.appendChild(createEl('div', 'ai-assistant-widget-structured-empty', '目前沒有可顯示的表格資料。'));
    }
    wrapper.appendChild(surface);
    return wrapper;
  }

  function buildStructuredSection(section, index, config) {
    if (!isStructuredObject(section)) return null;
    const type = normalizeStructuredType(section.type || '', section);
    const visibleType = resolveStructuredVisibleType(section, type);
    if (visibleType && !isAnswerTypeVisible(visibleType, config)) return null;
    switch (type) {
      case 'text':
      case 'markdown':
        return buildStructuredTextSection(section, index);
      case 'list':
        return buildStructuredListSection(section, index);
      case 'cards':
        return buildStructuredCardsSection(section, index);
      case 'links':
        return buildStructuredLinksSection(section, index);
      case 'table':
        return buildStructuredTableSection(section, index, config);
      default: {
        const fallbackText = extractStructuredText(section.content || section.summary || '');
        if (!fallbackText) return null;
        return buildStructuredTextSection({ ...section, type: 'text', content: fallbackText }, index);
      }
    }
  }

  function buildStructuredAnswerContent(text, responseType, responseData, config) {
    if (!isStructuredObject(responseData)) {
      return isAnswerTypeVisible('text', config)
        ? buildAnswerContent(text || '')
        : buildHiddenAnswerTypeNotice(config, ['text']);
    }

    const normalizedType = normalizeStructuredType(responseType, responseData);
    if (normalizedType === 'composite' && Array.isArray(responseData.sections)) {
      const container = createEl('div', 'ai-assistant-widget-answer-content ai-assistant-widget-answer-structured');
      let hasStructuredSection = false;
      const hiddenTypes = [];
      responseData.sections.forEach((section, index) => {
        const visibleType = resolveStructuredVisibleType(section, section && section.type || '');
        if (visibleType && !isAnswerTypeVisible(visibleType, config)) {
          hiddenTypes.push(visibleType);
          return;
        }
        const sectionEl = buildStructuredSection(section, index, config);
        if (!sectionEl) return;
        container.appendChild(sectionEl);
        hasStructuredSection = true;
      });
      if (hasStructuredSection) return container;
      if (hiddenTypes.length) return buildHiddenAnswerTypeNotice(config, hiddenTypes);
      return isAnswerTypeVisible('text', config) ? buildAnswerContent(text || '') : buildHiddenAnswerTypeNotice(config, ['text']);
    }

    const topLevelVisibleType = resolveStructuredVisibleType(responseData, normalizedType);
    if (topLevelVisibleType && !isAnswerTypeVisible(topLevelVisibleType, config)) {
      return buildHiddenAnswerTypeNotice(config, [topLevelVisibleType]);
    }

    const singleSection = buildStructuredSection(responseData, 0, config);
    if (!singleSection) {
      return isAnswerTypeVisible('text', config) ? buildAnswerContent(text || '') : buildHiddenAnswerTypeNotice(config, ['text']);
    }
    const container = createEl('div', 'ai-assistant-widget-answer-content ai-assistant-widget-answer-structured');
    container.appendChild(singleSection);
    return container;
  }

  function createAnswerSkeleton() {
    const skeleton = createEl('div', 'ai-assistant-widget-answer-skeleton');
    const lines = [
      'ai-assistant-widget-answer-skeleton-line is-wide',
      'ai-assistant-widget-answer-skeleton-line is-medium',
      'ai-assistant-widget-answer-skeleton-line is-soft',
      'ai-assistant-widget-answer-skeleton-line is-short'
    ];
    lines.forEach((cls) => skeleton.appendChild(createEl('span', cls)));
    return skeleton;
  }

  // Widget 內建的圖示資產以產品封裝版為主，部分 Font Awesome 圖示在不同版本中可能不存在；
  // 因此先做相容映射與支援名單檢查，避免互動切換或客製 launcher icon 時出現空白、方框或 RWD 位移。
  function normalizeWidgetIconClass(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return raw;
    const compatibilityMap = {
      'fa-solid fa-eye-slash': 'fa-solid fa-xmark',
      'fa-solid fa-gauge': 'fa-solid fa-gauge-high',
      'fa-solid fa-book': 'fa-solid fa-book-open',
      'fa-solid fa-pen-to-square': 'fa-solid fa-file-lines',
      'fa-solid fa-compass': 'fa-solid fa-circle-info'
    };
    return compatibilityMap[raw] || raw;
  }

  function isSupportedWidgetIconClass(value) {
    const normalizedValue = normalizeWidgetIconClass(value);
    const supportedSet = new Set([
      'fa-regular fa-comments',
      'fa-solid fa-comments',
      'fa-solid fa-robot',
      'fa-solid fa-wand-magic-sparkles',
      'fa-solid fa-circle-info',
      'fa-solid fa-paper-plane',
      'fa-solid fa-circle-question',
      'fa-solid fa-compress',
      'fa-solid fa-expand',
      'fa-solid fa-rotate-right',
      'fa-solid fa-xmark'
    ]);
    return supportedSet.has(normalizedValue);
  }

  function setIconOrText(el, value, fallbackLabel) {
    const normalizedValue = normalizeWidgetIconClass(value);
    if (normalizedValue && /fa-[\w-]+/.test(normalizedValue) && isSupportedWidgetIconClass(normalizedValue)) {
      el.innerHTML = '<i class="' + normalizedValue + '"></i>' + (fallbackLabel ? '<span class="visually-hidden">' + fallbackLabel + '</span>' : '');
      return;
    }
    el.textContent = typeof normalizedValue === 'string' ? normalizedValue : (fallbackLabel || '');
  }

  // v28.6.19.18.140：小型控制鈕改用內嵌 SVG，避免外部 icon font 缺字時顯示成方塊。
  const INLINE_ICON_PATHS = {
    chevronDown: 'M6 9l6 6 6-6',
    chevronUp: 'M18 15l-6-6-6 6',
    arrowDown: 'M12 4v12m0 0 5-5m-5 5-5-5M5 20h14',
    rotateCcw: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5'
  };

  function setSvgButtonIcon(el, pathData, label) {
    if (!el) return;
    const safeLabel = String(label || '');
    el.innerHTML = '<svg class="ai-assistant-widget-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<path d="' + pathData + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'
      + '</svg>';
    el.title = safeLabel;
    el.setAttribute('aria-label', safeLabel);
  }

  function syncSuggestionsToggleIcon(el, expanded) {
    const label = expanded ? '收合' : '展開';
    setSvgButtonIcon(el, expanded ? INLINE_ICON_PATHS.chevronUp : INLINE_ICON_PATHS.chevronDown, label);
    if (el) el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }


  function hasFontAwesomeIconClass(value) {
    return !!(value && /fa-[\w-]+/.test(normalizeWidgetIconClass(value)) && isSupportedWidgetIconClass(value));
  }

  function getLauncherLabel(config) {
    const raw = String((config && config.launcherText) || '').trim();
    return raw || ((config && config.title) || '開啟 AI 助理');
  }

  function applyLauncherContent(el, config) {
    if (!el) return;
    const style = (config && config.launcherStyle) || DEFAULTS.launcherStyle;
    const label = getLauncherLabel(config);
    const normalizedLauncherIcon = normalizeWidgetIconClass(config && config.launcherIcon);
    const hasIcon = hasFontAwesomeIconClass(normalizedLauncherIcon);
    el.innerHTML = '';

    if (style === 'bubble') {
      if (hasIcon) {
        el.appendChild(createEl('i', normalizedLauncherIcon));
        el.appendChild(createEl('span', 'visually-hidden', label));
      } else {
        el.appendChild(createEl('span', 'ai-assistant-widget-launcher-bubble-text', label.slice(0, 2)));
      }
      return;
    }

    if (hasIcon) {
      const iconWrap = createEl('span', 'ai-assistant-widget-launcher-icon-wrap');
      iconWrap.appendChild(createEl('i', normalizedLauncherIcon));
      el.appendChild(iconWrap);
    }

    el.appendChild(createEl('span', 'ai-assistant-widget-launcher-label', label));
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /*
   * Widget 主控制器：
   * - 管理 session、畫面 render、送訊息、狀態切換與回饋送出
   * - 也是整個前端 Widget 的主要狀態容器
   */
  /* ------------------------------
   Widget 主要類別
   ------------------------------ */

  class AIAssistantWidget {
    constructor(config) {
      // 基本組態：由預設值、使用者 script 設定與遠端設定合併而成。
      // 注意：loader 可能會傳入 showAdvancedInfo: undefined 這類「未明確指定」的欄位。
      // undefined 不應被判定為嵌入頁覆寫，否則後台 Runtime 開關會被前端預設值擋掉。
      this.config = { ...DEFAULTS, ...config };
      const hasTextOverride = (key) => Object.prototype.hasOwnProperty.call(config || {}, key) && String((config || {})[key] ?? '').trim().length > 0;
      const hasListOverride = (key) => Object.prototype.hasOwnProperty.call(config || {}, key) && (Array.isArray((config || {})[key]) ? (config || {})[key].some((item) => String(item || '').trim()) : String((config || {})[key] ?? '').trim().length > 0);
      const hasFlag = (flagName) => Object.prototype.hasOwnProperty.call(config || {}, flagName);
      const resolveCustomFlag = (flagName, optionName, isList = false) => hasFlag(flagName) ? !!(config || {})[flagName] : (isList ? hasListOverride(optionName) : hasTextOverride(optionName));
      this.config.hasCustomLanguageCode = hasFlag('hasCustomLanguageCode') ? !!(config || {}).hasCustomLanguageCode : hasTextOverride('languageCode');
      this.config.hasCustomWelcomeKicker = resolveCustomFlag('hasCustomWelcomeKicker', 'welcomeKicker');
      this.config.hasCustomWelcomeTitle = resolveCustomFlag('hasCustomWelcomeTitle', 'welcomeTitle');
      this.config.hasCustomWelcomeMessage = resolveCustomFlag('hasCustomWelcomeMessage', 'welcomeMessage');
      this.config.hasCustomEmptyKicker = resolveCustomFlag('hasCustomEmptyKicker', 'emptyKicker');
      this.config.hasCustomEmptyTitle = resolveCustomFlag('hasCustomEmptyTitle', 'emptyTitle');
      this.config.hasCustomEmptyMessage = resolveCustomFlag('hasCustomEmptyMessage', 'emptyMessage');
      this.config.hasCustomEmptyItems = resolveCustomFlag('hasCustomEmptyItems', 'emptyItems', true);
      this.config.hasCustomPlaceholder = resolveCustomFlag('hasCustomPlaceholder', 'placeholder');
      this.config.welcomeKicker = normalizeTextOption(this.config.welcomeKicker, DEFAULTS.welcomeKicker);
      this.config.welcomeTitle = normalizeTextOption(this.config.welcomeTitle, DEFAULTS.welcomeTitle);
      this.config.welcomeMessage = normalizeEmbedTextOption(this.config.welcomeMessage, DEFAULTS.welcomeMessage);
      this.config.emptyKicker = normalizeTextOption(this.config.emptyKicker, DEFAULTS.emptyKicker);
      this.config.emptyTitle = normalizeTextOption(this.config.emptyTitle, DEFAULTS.emptyTitle);
      this.config.emptyMessage = normalizeEmbedTextOption(this.config.emptyMessage, DEFAULTS.emptyMessage);
      this.config.emptyItems = normalizeTextListOption(this.config.emptyItems, DEFAULTS.emptyItems);
      this.config.showWelcome = parseOptionalBoolean(this.config.showWelcome, DEFAULTS.showWelcome);
      this.config.showEmptyMessages = parseOptionalBoolean(this.config.showEmptyMessages, DEFAULTS.showEmptyMessages);
      this.config.showInputResetButton = parseOptionalBoolean(this.config.showInputResetButton, DEFAULTS.showInputResetButton);
      this.config.enableOverlay = parseOptionalBoolean(this.config.enableOverlay, DEFAULTS.enableOverlay);
      this.config.placeholder = normalizeTextOption(this.config.placeholder, DEFAULTS.placeholder);
      this.config.hasCustomPrimaryColor = hasFlag('hasCustomPrimaryColor') ? !!(config || {}).hasCustomPrimaryColor : hasTextOverride('primaryColor');
      this.config.hasCustomLauncherPosition = hasFlag('hasCustomLauncherPosition') ? !!(config || {}).hasCustomLauncherPosition : hasTextOverride('launcherPosition');
      this.config.hasCustomLauncherIcon = hasFlag('hasCustomLauncherIcon') ? !!(config || {}).hasCustomLauncherIcon : hasTextOverride('launcherIcon');
      this.config.hasCustomLauncherStyle = hasFlag('hasCustomLauncherStyle') ? !!(config || {}).hasCustomLauncherStyle : hasTextOverride('launcherStyle');
      this.config.hasCustomLauncherText = hasFlag('hasCustomLauncherText') ? !!(config || {}).hasCustomLauncherText : hasTextOverride('launcherText');
      this.config.hasCustomThemeMode = hasFlag('hasCustomThemeMode') ? !!(config || {}).hasCustomThemeMode : hasTextOverride('themeMode');
      this.config.hasCustomPanelStyle = hasFlag('hasCustomPanelStyle') ? !!(config || {}).hasCustomPanelStyle : hasTextOverride('panelStyle');
      this.config.hasCustomPanelMode = hasFlag('hasCustomPanelMode') ? !!(config || {}).hasCustomPanelMode : hasTextOverride('panelMode');
      this.config.hasCustomMobileMode = hasFlag('hasCustomMobileMode') ? !!(config || {}).hasCustomMobileMode : hasTextOverride('mobileMode');
      this.config.hasCustomDensity = hasFlag('hasCustomDensity') ? !!(config || {}).hasCustomDensity : hasTextOverride('density');
      this.config.hasCustomEnableOverlay = hasFlag('hasCustomEnableOverlay') ? !!(config || {}).hasCustomEnableOverlay : (Object.prototype.hasOwnProperty.call(config || {}, 'enableOverlay') && typeof (config || {}).enableOverlay === 'boolean');
      this.config.hasCustomAutoOpen = hasFlag('hasCustomAutoOpen') ? !!(config || {}).hasCustomAutoOpen : (Object.prototype.hasOwnProperty.call(config || {}, 'autoOpen') && typeof (config || {}).autoOpen === 'boolean');
      this.config.hasCustomPanelWidth = hasFlag('hasCustomPanelWidth') ? !!(config || {}).hasCustomPanelWidth : hasTextOverride('widgetWidth');
      this.config.hasCustomPanelHeight = hasFlag('hasCustomPanelHeight') ? !!(config || {}).hasCustomPanelHeight : hasTextOverride('widgetHeight');
      this.config.hasCustomShowWelcome = hasFlag('hasCustomShowWelcome') ? !!(config || {}).hasCustomShowWelcome : (Object.prototype.hasOwnProperty.call(config || {}, 'showWelcome') && typeof (config || {}).showWelcome === 'boolean');
      this.config.hasCustomShowEmptyMessages = hasFlag('hasCustomShowEmptyMessages') ? !!(config || {}).hasCustomShowEmptyMessages : (Object.prototype.hasOwnProperty.call(config || {}, 'showEmptyMessages') && typeof (config || {}).showEmptyMessages === 'boolean');
      this.config.hasCustomShowInputResetButton = hasFlag('hasCustomShowInputResetButton') ? !!(config || {}).hasCustomShowInputResetButton : (Object.prototype.hasOwnProperty.call(config || {}, 'showInputResetButton') && typeof (config || {}).showInputResetButton === 'boolean');
      this.config.hasCustomAnswerCandidateLimit = hasFlag('hasCustomAnswerCandidateLimit') ? !!(config || {}).hasCustomAnswerCandidateLimit : hasTextOverride('answerCandidateLimit');
      this.config.hasCustomMetadataJson = hasFlag('hasCustomMetadataJson') ? !!(config || {}).hasCustomMetadataJson : hasTextOverride('metadataJson');
      this.config.hasCustomBrandShort = hasFlag('hasCustomBrandShort') ? !!(config || {}).hasCustomBrandShort : hasTextOverride('brandShort');
      this.config.hasCustomBrandName = hasFlag('hasCustomBrandName') ? !!(config || {}).hasCustomBrandName : hasTextOverride('brandName');
      this.config.hasCustomCompactHeader = hasFlag('hasCustomCompactHeader') ? !!(config || {}).hasCustomCompactHeader : (Object.prototype.hasOwnProperty.call(config || {}, 'compactHeader') && typeof (config || {}).compactHeader === 'boolean');
      this.config.hasCustomSuggestionsMode = hasFlag('hasCustomSuggestionsMode') ? !!(config || {}).hasCustomSuggestionsMode : hasTextOverride('suggestionsMode');
      this.config.hasCustomStartView = hasFlag('hasCustomStartView') ? !!(config || {}).hasCustomStartView : hasTextOverride('startView');
      this.config.hasCustomLauncherBehavior = hasFlag('hasCustomLauncherBehavior') ? !!(config || {}).hasCustomLauncherBehavior : hasTextOverride('launcherBehavior');
      this.config.hasCustomLauncherOffsetX = hasFlag('hasCustomLauncherOffsetX') ? !!(config || {}).hasCustomLauncherOffsetX : hasTextOverride('launcherOffsetX');
      this.config.hasCustomLauncherOffsetY = hasFlag('hasCustomLauncherOffsetY') ? !!(config || {}).hasCustomLauncherOffsetY : hasTextOverride('launcherOffsetY');
      this.config.hasCustomPanelOffsetX = hasFlag('hasCustomPanelOffsetX') ? !!(config || {}).hasCustomPanelOffsetX : hasTextOverride('panelOffsetX');
      this.config.hasCustomPanelOffsetY = hasFlag('hasCustomPanelOffsetY') ? !!(config || {}).hasCustomPanelOffsetY : hasTextOverride('panelOffsetY');
      this.config.primaryColor = normalizeWidgetColor(this.config.primaryColor, DEFAULTS.primaryColor);
      const hasBooleanOverride = (key) => Object.prototype.hasOwnProperty.call(config || {}, key) && typeof (config || {})[key] === 'boolean';
      const resolveBooleanCustomFlag = (flagName, optionName) => hasFlag(flagName) ? !!(config || {})[flagName] : hasBooleanOverride(optionName);
      this.config.hasCustomShowAdvancedInfo = resolveBooleanCustomFlag('hasCustomShowAdvancedInfo', 'showAdvancedInfo');
      this.config.hasCustomShowReferencesPanel = resolveBooleanCustomFlag('hasCustomShowReferencesPanel', 'showReferencesPanel');
      this.config.hasCustomShowAnswerSourceFooter = resolveBooleanCustomFlag('hasCustomShowAnswerSourceFooter', 'showAnswerSourceFooter');
      this.config.hasCustomShowAnswerStatusSubtitle = resolveBooleanCustomFlag('hasCustomShowAnswerStatusSubtitle', 'showAnswerStatusSubtitle');
      this.config.hasCustomShowFeedbackPanel = resolveBooleanCustomFlag('hasCustomShowFeedbackPanel', 'showFeedbackPanel');
      this.config.hasCustomShowResultCount = resolveBooleanCustomFlag('hasCustomShowResultCount', 'showResultCount');
      this.config.hasCustomUseThousandsSeparator = resolveBooleanCustomFlag('hasCustomUseThousandsSeparator', 'useThousandsSeparator');
      if (typeof this.config.showAdvancedInfo !== 'boolean') this.config.showAdvancedInfo = DEFAULTS.showAdvancedInfo;
      if (typeof this.config.showReferencesPanel !== 'boolean') this.config.showReferencesPanel = DEFAULTS.showReferencesPanel;
      if (typeof this.config.showAnswerSourceFooter !== 'boolean') this.config.showAnswerSourceFooter = DEFAULTS.showAnswerSourceFooter;
      if (typeof this.config.showAnswerStatusSubtitle !== 'boolean') this.config.showAnswerStatusSubtitle = DEFAULTS.showAnswerStatusSubtitle;
      if (typeof this.config.showFeedbackPanel !== 'boolean') this.config.showFeedbackPanel = DEFAULTS.showFeedbackPanel;
      if (typeof this.config.showResultCount !== 'boolean') this.config.showResultCount = DEFAULTS.showResultCount;
      if (typeof this.config.useThousandsSeparator !== 'boolean') this.config.useThousandsSeparator = DEFAULTS.useThousandsSeparator;
      this.config.panelMode = normalizePanelMode(this.config.panelMode, DEFAULTS.panelMode);
      this.config.startView = normalizeStartView(this.config.startView, DEFAULTS.startView);
      this.config.mobileMode = normalizeMobileMode(this.config.mobileMode, DEFAULTS.mobileMode);
      this.config.density = normalizeDensity(this.config.density, DEFAULTS.density);
      this.config.suggestionsMode = normalizeSuggestionsMode(this.config.suggestionsMode, DEFAULTS.suggestionsMode);
      this.config.widgetWidth = normalizeWidgetDimension(this.config.widgetWidth, DEFAULTS.widgetWidth);
      this.config.widgetHeight = normalizeWidgetDimension(this.config.widgetHeight, DEFAULTS.widgetHeight);
      this.config.launcherPosition = normalizeLauncherPosition(this.config.launcherPosition, DEFAULTS.launcherPosition);
      this.config.launcherStyle = normalizeLauncherStyle(this.config.launcherStyle, DEFAULTS.launcherStyle);
      this.config.launcherText = String(this.config.launcherText || '').trim();
      this.config.launcherOffsetX = normalizeLauncherOffset(this.config.launcherOffsetX, DEFAULTS.launcherOffsetX);
      this.config.launcherOffsetY = normalizeLauncherOffset(this.config.launcherOffsetY, DEFAULTS.launcherOffsetY);
      // v28.6.19.19.222：面板初始位置可獨立設定；未設定時沿用啟動按鈕 X / Y 偏移，維持既有預設行為。
      this.config.panelOffsetX = normalizeLauncherOffset(this.config.panelOffsetX, this.config.launcherOffsetX);
      this.config.panelOffsetY = normalizeLauncherOffset(this.config.panelOffsetY, this.config.launcherOffsetY);
      // 回答型別白名單：由嵌入者決定要顯示哪些內容型別；未設定時維持全部顯示。
      this.config.visibleAnswerTypes = parseVisibleAnswerTypes(this.config.visibleAnswerTypes, DEFAULTS.visibleAnswerTypes);
      this.config.answerCandidateLimit = normalizeAnswerCandidateLimit(this.config.answerCandidateLimit, DEFAULTS.answerCandidateLimit);
      // 對話識別與回饋綁定狀態。
      this.sessionId = null;
      this.lastAssistantMessageId = null;
      this.pendingSuggestedQuestion = null;
      // 主要 DOM 參考：render 完成後會保存，供後續 update / append 使用。
      this.container = null;
      this.messagesEl = null;
      this.statusEl = null;
      this.sendBtnEl = null;
      this.inputResetBtnEl = null;
      this.isBusy = false;
      this.textareaEl = null;
      this.suggestionsWrapEl = null;
      this.suggestionsHeaderEl = null;
      this.suggestionsToggleBtnEl = null;
      this.suggestionsEl = null;
      this.welcomeEl = null;
      // v28.6.19.18.262：首次開啟 Widget 時，歡迎卡片先等待視窗穩定後再柔和淡入上浮。
      // 只控制視覺出場，不延遲 Widget 開啟、快速提問或輸入操作，避免造成使用者誤以為系統變慢。
      this.hasPlayedWelcomeEntrance = false;
      this.welcomeEntranceTimer = null;
      // v28.6.19.18.263：重新開始畫面完成後，空訊息卡片同樣以淡入上浮方式出場。
      // 只控制視覺節奏，不延遲快速提問、輸入框或實際對話流程。
      this.emptyEntranceTimer = null;
      // v28.6.19.18.266：使用者按「重新開始」時先顯示確認視窗，避免誤清目前對話。
      this.resetConfirmEl = null;
      this.resetConfirmResolve = null;
      this.resetConfirmLastFocusedEl = null;
      // 首屏 / 快速提問狀態：控制第一眼體驗與 suggestions 展開方式。
      this.hasConversationStarted = false;
      // v28.6.19.18.126：區分首次載入與使用者按「重新開始」。
      // 首次載入顯示快速提問 + 歡迎；重新開始後顯示快速提問 + 空訊息。
      this.firstScreenVariant = 'initial';
      this.suggestionsExpanded = true;
      this.maxVisibleSuggestions = 5;
      // v28.6.19.19.151：快速提問載入狀態，用於教學頁預覽與維運診斷。
      // 避免 API 失敗時靜默不顯示，造成誤判為 Widget 沒接到 API。
      this.suggestionsLoadStatus = 'idle';
      this.suggestionsLoadError = '';
      this.suggestionsLoadCount = 0;
      // Modal / focus / fullscreen 狀態：避免開關視窗時焦點與全螢幕行為失控。
      this.rootEl = null;
      this.launcherEl = null;
      this.backdropEl = null;
      this.modalShellEl = null;
      this.panelId = 'ai-assistant-panel-' + Math.random().toString(36).slice(2, 10);
      this.titleId = this.panelId + '-title';
      this.subtitleId = this.panelId + '-subtitle';
      this.statusId = this.panelId + '-status';
      this.previouslyFocusedEl = null;
      this.boundDocumentKeydown = null;
      this.fullscreenBtnEl = null;
      this.modalDialogEl = null;
      this.boundFullscreenChange = null;
      this.fullscreenEventRoots = [];
      this.boundViewportChange = null;
      // 面板拖曳調整尺寸用的 DOM 參考；僅影響前端顯示尺寸，不會改動 Runtime / API 設定。
      this.resizeHandleEl = null;
      this.boundPanelResizeMove = null;
      this.boundPanelResizeEnd = null;
      this.emptyStateEl = null;
      this.scrollToBottomBtnEl = null;
      this.boundMessagesScroll = null;
      // 送出中與重試狀態：保留最後一則 user 問題，失敗時可重新送出。
      this.lastUserMessageText = '';
      this.statusClearTimer = null;
      this.loadingStageTimer = null;
      this.loadingStageIndex = 0;
      this.loadingStages = ['正在檢查站內知識', '正在整理回答', '正在準備引用資訊'];
      // 目前等待使用者選擇的引導式 FAQ 選項。
      // 若使用者沒有點選這些選項而直接輸入其他內容，下一次後端仍回傳選項時才加強提醒。
      this.activeGuidedFaqOptions = [];
      // v28.6.19.18.150：記錄本次送出是否來自引導式 FAQ 選項或離開引導按鈕。
      // 只有點選引導選項才送 SelectOption；一般輸入不帶 action，後端會再次提示需點選選項。
      this.pendingGuidedFaqAction = '';
      this.pendingAnswerCandidate = null;
      // 跨頁對話保留：只保存必要的前端顯示狀態，讓使用者在同網站換頁後可繼續剛剛的對話。
      this.isRestoringConversation = false;
      this.persistedMessages = [];
      this.conversationPersistenceKey = '';
    }

    getRuntimeSummary() {
      const mobile = isMobileViewport();
      const hideOnMobile = mobile && this.config.mobileMode === 'hide';
      const fullscreenOnMobile = mobile && this.config.mobileMode === 'auto-fullscreen';
      const sameAsDesktopOnMobile = mobile && this.config.mobileMode === 'same-as-desktop';
      const effectivePanelMode = hideOnMobile ? 'hidden' : (fullscreenOnMobile ? 'mobile-fullscreen' : this.config.panelMode);
      const hasSuggestions = !!(this.suggestionsEl && this.suggestionsEl.querySelector('.ai-assistant-widget-chip'));
      const preConversation = !this.hasConversationStarted;
      const firstScreenVariant = this.firstScreenVariant || 'initial';
      const firstScreenState = !preConversation
        ? 'conversation-active'
        : (firstScreenVariant === 'reset'
          ? 'reset-empty'
          : (this.config.startView === 'suggestions' && hasSuggestions ? 'suggestions' : this.config.startView === 'conversation' ? 'conversation' : 'home'));
      return {
        open: !!(this.rootEl && this.rootEl.classList.contains('open')),
        panelMode: this.config.panelMode,
        startView: this.config.startView,
        mobileMode: this.config.mobileMode,
        density: this.config.density,
        launcherPosition: this.config.launcherPosition,
        launcherStyle: this.config.launcherStyle,
        panelOffsetX: this.config.panelOffsetX,
        panelOffsetY: this.config.panelOffsetY,
        styleIsolation: this.config.styleIsolation || 'scoped',
        widgetWidth: this.config.widgetWidth,
        widgetHeight: this.config.widgetHeight,
        showAdvancedInfo: this.config.showAdvancedInfo !== false,
        showReferencesPanel: this.config.showReferencesPanel === true,
        showAnswerSourceFooter: this.config.showAnswerSourceFooter === true,
        showAnswerStatusSubtitle: this.config.showAnswerStatusSubtitle === true,
        showFeedbackPanel: this.config.showFeedbackPanel !== false,
        showWelcome: this.config.showWelcome !== false,
        showEmptyMessages: this.config.showEmptyMessages !== false,
        firstScreenVariant,
        showResultCount: this.config.showResultCount !== false,
        useThousandsSeparator: this.config.useThousandsSeparator !== false,
        visibleAnswerTypes: getVisibleAnswerTypes(this.config),
        isMobileViewport: mobile,
        hideOnMobile,
        fullscreenOnMobile,
        sameAsDesktopOnMobile,
        effectivePanelMode,
        hasSuggestions,
        hasConversationStarted: this.hasConversationStarted,
        firstScreenState,
        suggestionsExpanded: this.suggestionsExpanded,
        suggestionsLoadStatus: this.suggestionsLoadStatus || 'idle',
        suggestionsLoadCount: Number(this.suggestionsLoadCount || 0),
        suggestionsLoadError: this.suggestionsLoadError || ''
      };
    }

    syncRuntimeSummary(reason) {
      const summary = this.getRuntimeSummary();
      if (this.rootEl) {
        this.rootEl.dataset.configPanelMode = summary.panelMode;
        this.rootEl.dataset.configStartView = summary.startView;
        this.rootEl.dataset.configMobileMode = summary.mobileMode;
        this.rootEl.dataset.configDensity = summary.density;
        this.rootEl.dataset.configLauncherPosition = summary.launcherPosition;
        this.rootEl.dataset.configLauncherStyle = summary.launcherStyle;
        this.rootEl.dataset.configPanelOffsetX = summary.panelOffsetX || '';
        this.rootEl.dataset.configPanelOffsetY = summary.panelOffsetY || '';
        this.rootEl.dataset.configStyleIsolation = summary.styleIsolation || 'scoped';
        this.rootEl.dataset.configPanelWidth = summary.widgetWidth;
        this.rootEl.dataset.configPanelHeight = summary.widgetHeight;
        this.rootEl.dataset.configShowAdvancedInfo = summary.showAdvancedInfo ? 'true' : 'false';
        this.rootEl.dataset.configShowReferencesPanel = summary.showReferencesPanel ? 'true' : 'false';
        this.rootEl.dataset.configShowAnswerSourceFooter = summary.showAnswerSourceFooter ? 'true' : 'false';
        this.rootEl.dataset.configShowAnswerStatusSubtitle = summary.showAnswerStatusSubtitle ? 'true' : 'false';
        this.rootEl.dataset.configShowFeedbackPanel = summary.showFeedbackPanel ? 'true' : 'false';
        this.rootEl.dataset.configShowWelcome = summary.showWelcome ? 'true' : 'false';
        this.rootEl.dataset.configShowEmptyMessages = summary.showEmptyMessages ? 'true' : 'false';
        this.rootEl.dataset.configShowResultCount = summary.showResultCount ? 'true' : 'false';
        this.rootEl.dataset.configUseThousandsSeparator = summary.useThousandsSeparator ? 'true' : 'false';
        this.rootEl.dataset.configVisibleAnswerTypes = summary.visibleAnswerTypes.length ? summary.visibleAnswerTypes.join(',') : 'all';
        this.rootEl.dataset.runtimeMobileViewport = summary.isMobileViewport ? 'true' : 'false';
        this.rootEl.dataset.runtimeEffectivePanelMode = summary.effectivePanelMode;
        this.rootEl.dataset.runtimeFirstScreenState = summary.firstScreenState;
        this.rootEl.dataset.runtimeHasSuggestions = summary.hasSuggestions ? 'true' : 'false';
        this.rootEl.dataset.runtimeConversationStarted = summary.hasConversationStarted ? 'true' : 'false';
        this.rootEl.dataset.runtimeOpen = summary.open ? 'true' : 'false';
        this.rootEl.dataset.runtimeSuggestionsLoadStatus = summary.suggestionsLoadStatus;
        this.rootEl.dataset.runtimeSuggestionsLoadCount = String(summary.suggestionsLoadCount);
        this.rootEl.dataset.runtimeSuggestionsLoadError = summary.suggestionsLoadError;
      }
      const detail = { reason, ...summary };
      global.__AIAssistantWidgetLastInstance = this;
      global.__AIAssistantWidgetLastState = detail;
      if (typeof global.CustomEvent === 'function') {
        try {
          if (this.rootEl) {
            this.rootEl.dispatchEvent(new global.CustomEvent('AIAssistantWidgetStateChanged', { detail, bubbles: true }));
          }
          global.dispatchEvent(new global.CustomEvent('AIAssistantWidgetStateChanged', { detail }));
        } catch (_) {}
      }
      return detail;
    }

    /**
     * Widget 啟動進入點。
     * 順序固定為：載入遠端設定 → render → 還原跨頁對話 → 載入快速提問 → 建立 / 沿用 session。
     */
    async init() {
      if (!this.config.apiBase) throw new Error('apiBase 未設定');
      if (!this.config.siteCode) throw new Error('siteCode 未設定');

      await this.loadRemoteConfig();
      this.render();
      this.restorePersistentConversation();
      await this.loadSuggestedQuestions();
      await this.ensureSession();

      if (this.config.autoOpen) {
        this.open();
      }
    }

    /**
     * 從站台設定 API 取得遠端設定。
     * 只覆寫沒有被呼叫端明確指定的可客製欄位，避免腳本設定被吃掉。
     */
    async loadRemoteConfig() {
      try {
        // v28.6.19.19.151：改用 POST 查詢設定。
        // iPad Safari 在 iframe / srcdoc 預覽中的 GET 可能不帶 Origin / Referer，
        // 導致後端 Allowed Origins 誤判；POST 與 session/create、chat/send 行為一致。
        const endpoint = this.config.configQueryEndpoint || replaceSiteCodeTemplate(this.config.configEndpointTemplate, this.config.siteCode);
        const data = await apiFetch(this.config.apiBase, endpoint, {
          method: 'POST',
          body: JSON.stringify({
            siteCode: this.config.siteCode,
            assistantCode: this.config.assistantCode || null
          })
        });
        if (data && typeof data === 'object') {
          if (!this.config.hasCustomTitle) {
            this.config.title = data.title || data.assistantName || this.config.title;
          }
          if (!this.config.hasCustomSubtitle) {
            this.config.subtitle = data.hideSubtitle === true ? '' : (data.subtitle || this.config.subtitle);
          }
          if (!this.config.hasCustomLanguageCode) {
            this.config.languageCode = data.languageCode || data.defaultLanguage || this.config.languageCode;
          }
          if (!this.config.hasCustomWelcomeKicker) {
            this.config.welcomeKicker = normalizeTextOption(data.welcomeKicker, this.config.welcomeKicker);
          }
          if (!this.config.hasCustomWelcomeTitle) {
            this.config.welcomeTitle = normalizeTextOption(data.welcomeTitle, this.config.welcomeTitle);
          }
          if (!this.config.hasCustomWelcomeMessage) {
            this.config.welcomeMessage = normalizeEmbedTextOption(data.welcomeMessage, this.config.welcomeMessage);
          }
          if (!this.config.hasCustomEmptyKicker) {
            this.config.emptyKicker = normalizeTextOption(data.emptyKicker, this.config.emptyKicker);
          }
          if (!this.config.hasCustomEmptyTitle) {
            this.config.emptyTitle = normalizeTextOption(data.emptyTitle, this.config.emptyTitle);
          }
          if (!this.config.hasCustomEmptyMessage) {
            this.config.emptyMessage = normalizeEmbedTextOption(data.emptyMessage, this.config.emptyMessage);
          }
          if (!this.config.hasCustomEmptyItems) {
            this.config.emptyItems = normalizeTextListOption(data.emptyItems, this.config.emptyItems);
          }
          if (!this.config.hasCustomPlaceholder) {
            this.config.placeholder = normalizeTextOption(data.placeholderText, this.config.placeholder);
          }
          // v28.6.19.19.151：嵌入碼明確指定 data-primary-color 時，不可被後台 ThemeColor 覆蓋。
          // 未指定時才採用後台站台品牌色；若後台色碼格式不合法，保留目前安全主色。
          if (!this.config.hasCustomPrimaryColor) {
            this.config.primaryColor = normalizeWidgetColor(data.primaryColor || data.themeColor, this.config.primaryColor);
          }
          this.config.assistantCode = data.assistantCode || this.config.assistantCode;
          if (!this.config.hasCustomLauncherPosition && data.launcherPosition) {
            this.config.launcherPosition = normalizeLauncherPosition(data.launcherPosition, this.config.launcherPosition);
          }
          if (!this.config.hasCustomLauncherIcon) this.config.launcherIcon = data.launcherIcon || this.config.launcherIcon;
          if (!this.config.hasCustomLauncherStyle) this.config.launcherStyle = normalizeLauncherStyle(data.launcherStyle, this.config.launcherStyle);
          if (!this.config.hasCustomLauncherText && typeof data.launcherText === 'string') this.config.launcherText = data.launcherText;
          if (!this.config.hasCustomThemeMode) this.config.themeMode = data.themeMode || this.config.themeMode;
          if (!this.config.hasCustomPanelStyle) this.config.panelStyle = data.panelStyle || this.config.panelStyle;
          if (!this.config.hasCustomPanelMode) this.config.panelMode = normalizePanelMode(data.panelMode, this.config.panelMode);
          if (!this.config.hasCustomMobileMode) this.config.mobileMode = normalizeMobileMode(data.mobileMode, this.config.mobileMode);
          if (!this.config.hasCustomDensity) this.config.density = normalizeDensity(data.density, this.config.density);
          if (!this.config.hasCustomEnableOverlay && typeof data.enableOverlay === 'boolean') this.config.enableOverlay = data.enableOverlay;
          if (!this.config.hasCustomAutoOpen && typeof data.autoOpen === 'boolean') this.config.autoOpen = data.autoOpen;
          if (!this.config.hasCustomPanelWidth && data.panelWidth) this.config.widgetWidth = normalizeWidgetDimension(data.panelWidth, this.config.widgetWidth);
          if (!this.config.hasCustomPanelHeight && data.panelHeight) this.config.widgetHeight = normalizeWidgetDimension(data.panelHeight, this.config.widgetHeight);
          if (!this.config.hasCustomShowWelcome && typeof data.showWelcome === 'boolean') this.config.showWelcome = data.showWelcome;
          if (!this.config.hasCustomShowEmptyMessages && typeof data.showEmptyMessages === 'boolean') this.config.showEmptyMessages = data.showEmptyMessages;
          if (!this.config.hasCustomShowInputResetButton && typeof data.showInputResetButton === 'boolean') this.config.showInputResetButton = data.showInputResetButton;
          if (!this.config.hasCustomAnswerCandidateLimit && data.answerCandidateLimit) this.config.answerCandidateLimit = normalizeAnswerCandidateLimit(data.answerCandidateLimit, this.config.answerCandidateLimit);
          if (!this.config.hasCustomMetadataJson && typeof data.metadataJson === 'string' && data.metadataJson.trim()) this.config.metadataJson = data.metadataJson;
          if (!this.config.hasCustomBrandShort && typeof data.brandShort === 'string') this.config.brandShort = data.brandShort;
          if (!this.config.hasCustomBrandName && typeof data.brandName === 'string') this.config.brandName = data.brandName;
          if (!this.config.hasCustomCompactHeader && typeof data.compactHeader === 'boolean') this.config.compactHeader = data.compactHeader;
          if (!this.config.hasCustomSuggestionsMode && data.suggestionsMode) this.config.suggestionsMode = normalizeSuggestionsMode(data.suggestionsMode, this.config.suggestionsMode);
          if (!this.config.hasCustomStartView && data.startView) this.config.startView = normalizeStartView(data.startView, this.config.startView);
          if (!this.config.hasCustomLauncherBehavior && data.launcherBehavior) this.config.launcherBehavior = data.launcherBehavior;
          if (!this.config.hasCustomLauncherOffsetX && data.launcherOffsetX) this.config.launcherOffsetX = normalizeLauncherOffset(data.launcherOffsetX, this.config.launcherOffsetX);
          if (!this.config.hasCustomLauncherOffsetY && data.launcherOffsetY) this.config.launcherOffsetY = normalizeLauncherOffset(data.launcherOffsetY, this.config.launcherOffsetY);
          if (!this.config.hasCustomPanelOffsetX && data.panelOffsetX) this.config.panelOffsetX = normalizeLauncherOffset(data.panelOffsetX, this.config.panelOffsetX);
          if (!this.config.hasCustomPanelOffsetY && data.panelOffsetY) this.config.panelOffsetY = normalizeLauncherOffset(data.panelOffsetY, this.config.panelOffsetY);
          // 顯示治理邊界：若嵌入頁已明確指定 showAdvancedInfo / showReferencesPanel / showAnswerSourceFooter / showAnswerStatusSubtitle / showFeedbackPanel / showResultCount /
          // useThousandsSeparator / visibleAnswerTypes，則以嵌入頁為準；未指定時才採後端 runtime 回傳值。
          if (!this.config.hasCustomShowAdvancedInfo && typeof data.showAdvancedInfo === 'boolean') this.config.showAdvancedInfo = data.showAdvancedInfo;
          if (!this.config.hasCustomShowReferencesPanel && typeof data.showReferencesPanel === 'boolean') this.config.showReferencesPanel = data.showReferencesPanel;
          if (!this.config.hasCustomShowAnswerSourceFooter && typeof data.showAnswerSourceFooter === 'boolean') this.config.showAnswerSourceFooter = data.showAnswerSourceFooter;
          if (!this.config.hasCustomShowAnswerStatusSubtitle && typeof data.showAnswerStatusSubtitle === 'boolean') this.config.showAnswerStatusSubtitle = data.showAnswerStatusSubtitle;
          if (!this.config.hasCustomShowFeedbackPanel && typeof data.showFeedbackPanel === 'boolean') this.config.showFeedbackPanel = data.showFeedbackPanel;
          if (!this.config.hasCustomShowResultCount && typeof data.showResultCount === 'boolean') this.config.showResultCount = data.showResultCount;
          if (!this.config.hasCustomUseThousandsSeparator && typeof data.useThousandsSeparator === 'boolean') this.config.useThousandsSeparator = data.useThousandsSeparator;
          if (!this.config.hasCustomVisibleAnswerTypes) {
            this.config.visibleAnswerTypes = parseVisibleAnswerTypes(data.visibleAnswerTypes ?? data.answerVisibleTypes, this.config.visibleAnswerTypes);
          }
        }
      } catch (_) {}
    }

    /**
     * 建立 Widget 主要 DOM 結構。
     * 包含：header、快速提問、對話區、輸入區、狀態列與 launcher。
     */
    render() {
      const root = createEl('div', 'ai-assistant-widget-root gs-ai-widget');
      root.style.setProperty('--ai-launcher-right', this.config.launcherOffsetX);
      root.style.setProperty('--ai-launcher-bottom', this.config.launcherOffsetY);
      root.style.setProperty('--ai-launcher-inline-offset', this.config.launcherOffsetX);
      root.style.setProperty('--ai-panel-inline-offset', this.config.panelOffsetX);
      root.style.setProperty('--ai-panel-bottom', this.config.panelOffsetY);
      root.style.setProperty('--ai-widget-width', this.config.widgetWidth);
      root.style.setProperty('--ai-widget-height', this.config.widgetHeight);
      syncViewportMetrics(root);
      applyBrandTheme(root, this.config);
      if (this.config.compactHeader) root.classList.add('has-compact-header');
      if (this.config.suggestionsMode) root.classList.add('suggestions-mode-' + this.config.suggestionsMode);
      root.classList.add('uses-modal-shell');
      root.classList.add('panel-mode-' + this.config.panelMode);
      root.classList.add(this.config.enableOverlay ? 'overlay-enabled' : 'overlay-disabled');
      root.classList.add('start-view-' + this.config.startView);
      root.classList.add('mobile-mode-' + this.config.mobileMode);
      root.classList.add('density-' + this.config.density);
      root.classList.add('launcher-position-' + this.config.launcherPosition);
      root.classList.add('launcher-style-' + this.config.launcherStyle);

      const backdrop = createEl('div', 'ai-assistant-widget-modal-backdrop modal-backdrop fade');
      backdrop.addEventListener('click', () => this.close());
      this.backdropEl = backdrop;

      const modalShell = createEl('div', 'ai-assistant-widget-modal-shell modal fade');
      modalShell.id = this.panelId;
      modalShell.setAttribute('role', 'dialog');
      modalShell.setAttribute('aria-modal', this.config.enableOverlay ? 'true' : 'false');
      modalShell.setAttribute('aria-labelledby', this.titleId);
      modalShell.setAttribute('aria-describedby', this.subtitleId);
      modalShell.setAttribute('tabindex', '-1');
      const modalDialog = createEl('div', 'ai-assistant-widget-modal-dialog modal-dialog modal-dialog-scrollable modal-dialog-centered');
      const panel = createEl('div', 'ai-assistant-widget-panel ai-assistant-widget-modal-content modal-content');
      const header = createEl('div', 'ai-assistant-widget-header modal-header');
      header.style.background = this.config.primaryColor;

      const titleWrap = createEl('div', 'ai-assistant-widget-header-brand');
      if (shouldShowBrandPill(this.config)) {
        const brandPill = createEl('div', 'ai-assistant-widget-brand-pill', buildBrandShort(this.config));
        titleWrap.appendChild(brandPill);
      }
      const titleTextWrap = createEl('div', 'ai-assistant-widget-header-copy');
      const titleEl = createEl('div', 'ai-assistant-widget-title', this.config.title);
      titleEl.id = this.titleId;
      const subtitleEl = createEl('div', 'ai-assistant-widget-subtitle', this.config.subtitle);
      subtitleEl.id = this.subtitleId;
      titleTextWrap.appendChild(titleEl);
      if (this.config.subtitle) titleTextWrap.appendChild(subtitleEl);
      titleWrap.appendChild(titleTextWrap);
      header.appendChild(titleWrap);

      const headerActions = createEl('div', 'ai-assistant-widget-header-actions');
      const fullscreenBtn = createEl('button', 'ai-assistant-widget-icon-btn btn btn-sm', '');
      fullscreenBtn.type = 'button';
      fullscreenBtn.title = '全螢幕';
      fullscreenBtn.setAttribute('aria-label', '全螢幕');
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
      this.fullscreenBtnEl = fullscreenBtn;
      this.syncFullscreenButton();
      const clearBtn = createEl('button', 'ai-assistant-widget-icon-btn btn btn-sm', '');
      setSvgButtonIcon(clearBtn, INLINE_ICON_PATHS.rotateCcw, '重新開始');
      clearBtn.addEventListener('click', () => this.resetConversation());
      const closeBtn = createEl('button', 'ai-assistant-widget-icon-btn btn btn-sm', '');
      setIconOrText(closeBtn, 'fa-solid fa-xmark', '關閉');
      closeBtn.title = '關閉';
      closeBtn.setAttribute('aria-label', '關閉');
      closeBtn.addEventListener('click', () => this.close());
      headerActions.appendChild(fullscreenBtn);
      headerActions.appendChild(clearBtn);
      headerActions.appendChild(closeBtn);
      header.appendChild(headerActions);

      const body = createEl('div', 'ai-assistant-widget-body');
      this.welcomeEl = createEl('div', 'ai-assistant-widget-welcome');
      this.welcomeEl.appendChild(createEl('div', 'ai-assistant-widget-welcome-kicker', this.config.welcomeKicker));
      this.welcomeEl.appendChild(createEl('div', 'ai-assistant-widget-welcome-title', this.config.welcomeTitle));
      this.welcomeEl.appendChild(buildSafeEmbedMarkdownContent(this.config.welcomeMessage, 'ai-assistant-widget-welcome-text ai-assistant-widget-embed-markdown'));
      this.suggestionsWrapEl = createEl('div', 'ai-assistant-widget-suggestions-wrap');
      this.suggestionsHeaderEl = createEl('div', 'ai-assistant-widget-suggestions-header');
      this.suggestionsHeaderEl.appendChild(createEl('div', 'ai-assistant-widget-suggestions-title', '快速提問'));
      this.suggestionsToggleBtnEl = createEl('button', 'ai-assistant-widget-suggestions-toggle', '');
      this.suggestionsToggleBtnEl.type = 'button';
      syncSuggestionsToggleIcon(this.suggestionsToggleBtnEl, false);
      this.suggestionsToggleBtnEl.addEventListener('click', () => {
        this.suggestionsExpanded = !this.suggestionsExpanded;
        this.applySuggestionsState();
      });
      this.suggestionsHeaderEl.appendChild(this.suggestionsToggleBtnEl);
      this.suggestionsWrapEl.appendChild(this.suggestionsHeaderEl);
      this.suggestionsEl = createEl('div', 'ai-assistant-widget-suggestions');
      this.suggestionsWrapEl.appendChild(this.suggestionsEl);
      // v28.6.19.18.100：首次畫面先顯示「快速提問」，再顯示歡迎文字。
      // 讓使用者一開啟 Widget 時先看到可點選的入口，歡迎說明則作為下方輔助內容。
      body.appendChild(this.suggestionsWrapEl);
      body.appendChild(this.welcomeEl);
      this.messagesEl = createEl('div', 'ai-assistant-widget-messages');
      this.messagesEl.setAttribute('role', 'log');
      this.messagesEl.setAttribute('aria-live', 'polite');
      this.messagesEl.setAttribute('aria-relevant', 'additions text');
      this.messagesEl.setAttribute('aria-label', '對話訊息');
      this.boundMessagesScroll = () => this.handleMessagesScroll();
      this.messagesEl.addEventListener('scroll', this.boundMessagesScroll);
      this.renderEmptyState();
      body.appendChild(this.messagesEl);

      this.scrollToBottomBtnEl = createEl('button', 'ai-assistant-widget-scroll-latest', '');
      this.scrollToBottomBtnEl.type = 'button';
      setSvgButtonIcon(this.scrollToBottomBtnEl, INLINE_ICON_PATHS.arrowDown, '回到底部');
      this.scrollToBottomBtnEl.addEventListener('click', () => this.scrollMessagesToBottom('smooth'));
      body.appendChild(this.scrollToBottomBtnEl);

      const footer = createEl('div', 'ai-assistant-widget-footer');
      const inputRow = createEl('div', 'ai-assistant-widget-input-row');
      this.textareaEl = createEl('textarea', 'ai-assistant-widget-textarea');
      this.textareaEl.placeholder = this.config.placeholder;
      this.textareaEl.setAttribute('aria-label', '輸入問題');
      this.textareaEl.setAttribute('rows', '1');
      this.textareaEl.addEventListener('input', () => this.autoResizeTextarea());
      this.textareaEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendCurrentMessage();
        }
      });
      const inputResetBtn = createEl('button', 'ai-assistant-widget-input-reset', '');
      inputResetBtn.type = 'button';
      setSvgButtonIcon(inputResetBtn, INLINE_ICON_PATHS.rotateCcw, '重新開始');
      inputResetBtn.addEventListener('click', () => this.resetConversationFromInput());
      this.inputResetBtnEl = inputResetBtn;

      const sendBtn = createEl('button', 'ai-assistant-widget-send btn btn-primary', '');
      sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
      sendBtn.title = '送出';
      sendBtn.setAttribute('aria-label', '送出');
      sendBtn.style.background = this.config.primaryColor;
      sendBtn.addEventListener('click', () => this.sendCurrentMessage());
      this.sendBtnEl = sendBtn;
      inputRow.appendChild(this.textareaEl);
      if (this.config.showInputResetButton) inputRow.appendChild(inputResetBtn);
      inputRow.appendChild(sendBtn);
      footer.appendChild(inputRow);
      this.statusEl = createEl('div', 'ai-assistant-widget-status');
      this.statusEl.id = this.statusId;
      this.statusEl.setAttribute('role', 'status');
      this.statusEl.setAttribute('aria-live', 'polite');
      footer.appendChild(this.statusEl);

      const resetConfirm = createEl('div', 'ai-assistant-widget-reset-confirm');
      resetConfirm.hidden = true;
      resetConfirm.setAttribute('role', 'dialog');
      resetConfirm.setAttribute('aria-modal', 'true');
      resetConfirm.setAttribute('aria-labelledby', this.panelId + '-reset-confirm-title');
      resetConfirm.setAttribute('aria-describedby', this.panelId + '-reset-confirm-desc');
      resetConfirm.setAttribute('tabindex', '-1');
      const resetConfirmCard = createEl('div', 'ai-assistant-widget-reset-confirm-card');
      const resetConfirmTitle = createEl('div', 'ai-assistant-widget-reset-confirm-title', '確定要重新開始對話？');
      resetConfirmTitle.id = this.panelId + '-reset-confirm-title';
      const resetConfirmDesc = createEl('div', 'ai-assistant-widget-reset-confirm-desc', '重新開始後，畫面上的目前對話會清空，並建立新的對話。');
      resetConfirmDesc.id = this.panelId + '-reset-confirm-desc';
      const resetConfirmActions = createEl('div', 'ai-assistant-widget-reset-confirm-actions');
      const resetCancelBtn = createEl('button', 'ai-assistant-widget-reset-confirm-btn ai-assistant-widget-reset-confirm-cancel', '取消');
      resetCancelBtn.type = 'button';
      const resetOkBtn = createEl('button', 'ai-assistant-widget-reset-confirm-btn ai-assistant-widget-reset-confirm-ok', '確定');
      resetOkBtn.type = 'button';
      resetConfirmActions.appendChild(resetCancelBtn);
      resetConfirmActions.appendChild(resetOkBtn);
      resetConfirmCard.appendChild(resetConfirmTitle);
      resetConfirmCard.appendChild(resetConfirmDesc);
      resetConfirmCard.appendChild(resetConfirmActions);
      resetConfirm.appendChild(resetConfirmCard);
      resetConfirm.addEventListener('click', (event) => {
        if (event.target === resetConfirm) this.closeResetConfirmation(false);
      });
      resetConfirm.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeResetConfirmation(false);
        }
      });
      resetCancelBtn.addEventListener('click', () => this.closeResetConfirmation(false));
      resetOkBtn.addEventListener('click', () => this.closeResetConfirmation(true));
      this.resetConfirmEl = resetConfirm;

      panel.appendChild(header);
      panel.appendChild(body);
      panel.appendChild(footer);
      panel.appendChild(resetConfirm);
      modalDialog.appendChild(panel);
      const resizeHandle = createEl('button', 'ai-assistant-widget-resize-handle', '');
      resizeHandle.type = 'button';
      resizeHandle.title = '拖曳調整視窗尺寸';
      resizeHandle.setAttribute('aria-label', '拖曳調整視窗尺寸');
      resizeHandle.setAttribute('tabindex', '0');
      resizeHandle.addEventListener('pointerdown', (event) => this.startPanelResize(event));
      resizeHandle.addEventListener('keydown', (event) => this.handlePanelResizeKeydown(event));
      modalDialog.appendChild(resizeHandle);
      this.resizeHandleEl = resizeHandle;
      this.modalDialogEl = modalDialog;
      modalShell.appendChild(modalDialog);

      this.launcherEl = createEl('button', 'ai-assistant-widget-launcher btn btn-primary shadow', '');
      applyLauncherContent(this.launcherEl, this.config);
      this.launcherEl.type = 'button';
      this.launcherEl.style.background = this.config.primaryColor;
      this.launcherEl.title = getLauncherLabel(this.config);
      this.launcherEl.setAttribute('aria-label', getLauncherLabel(this.config));
      this.launcherEl.setAttribute('aria-haspopup', 'dialog');
      this.launcherEl.setAttribute('aria-controls', this.panelId);
      this.launcherEl.setAttribute('aria-expanded', 'false');
      this.launcherEl.addEventListener('click', () => {
        if (root.classList.contains('open')) this.close(); else this.open();
      });

      root.appendChild(backdrop);
      root.appendChild(modalShell);
      root.appendChild(this.launcherEl);
      // v28.6.19.19.222：Widget 可掛載到 Shadow DOM，避免宿主網站 reset.css / 全域 button 樣式干擾內部排版與 resize handle。
      const mountTarget = this.config.mountTarget && typeof this.config.mountTarget.appendChild === 'function'
        ? this.config.mountTarget
        : document.body;
      mountTarget.appendChild(root);
      this.rootEl = root;
      this.modalShellEl = modalShell;
      this.container = modalShell;
      this.boundDocumentKeydown = (e) => this.handleRootKeydown(e);
      root.addEventListener('keydown', this.boundDocumentKeydown);
      this.boundFullscreenChange = () => this.syncFullscreenButton();
      this.fullscreenEventRoots = [document];
      const widgetRootNode = typeof root.getRootNode === 'function' ? root.getRootNode() : null;
      if (widgetRootNode && widgetRootNode !== document && typeof widgetRootNode.addEventListener === 'function') {
        this.fullscreenEventRoots.push(widgetRootNode);
      }
      this.fullscreenEventRoots.forEach((eventRoot) => {
        eventRoot.addEventListener('fullscreenchange', this.boundFullscreenChange);
        eventRoot.addEventListener('webkitfullscreenchange', this.boundFullscreenChange);
      });
      this.boundViewportChange = () => {
        syncViewportMetrics(this.rootEl);
        this.applyResponsiveModes();
      };
      window.addEventListener('resize', this.boundViewportChange);
      if (global.visualViewport && typeof global.visualViewport.addEventListener === 'function') {
        global.visualViewport.addEventListener('resize', this.boundViewportChange);
        global.visualViewport.addEventListener('scroll', this.boundViewportChange);
      }
      this.boundViewportChange();
      this.updateFirstScreenState();
      this.syncRuntimeSummary('render');
    }

    /**
     * 回傳目前面板可調整的尺寸範圍。
     * - modal：限制在瀏覽器可視範圍內，避免調整後超出畫面。
     * - right-bottom-window / left-bottom-window：固定在左右下角，限制寬高不可超出 viewport。
     * - drawer：維持只調整寬度，高度固定貼齊視窗。
     */
    getPanelResizeBounds(mode) {
      const viewportWidth = Math.max(320, global.innerWidth || document.documentElement.clientWidth || 1024);
      const viewportHeight = Math.max(320, global.innerHeight || document.documentElement.clientHeight || 720);
      const isModal = mode === 'modal';
      const isBottomWindow = mode === 'right-bottom-window' || mode === 'left-bottom-window';
      const widthSafeGap = isModal ? 40 : (isBottomWindow ? 28 : 12);
      const heightSafeGap = isModal ? 40 : (isBottomWindow ? 88 : 0);
      const maxWidth = Math.max(320, viewportWidth - widthSafeGap);
      const minWidth = Math.min(isModal ? 360 : 320, maxWidth);
      const maxHeight = Math.max(360, viewportHeight - heightSafeGap);
      const minHeight = Math.min(isBottomWindow ? 420 : 480, maxHeight);
      return { minWidth, maxWidth, minHeight, maxHeight };
    }

    clampPanelSizeValue(value, min, max) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return min;
      return Math.min(Math.max(numeric, min), max);
    }

    applyPanelSize(width, height) {
      if (!this.rootEl || !this.modalDialogEl) return;
      const mode = this.config.panelMode;
      const bounds = this.getPanelResizeBounds(mode);
      const nextWidth = this.clampPanelSizeValue(width, bounds.minWidth, bounds.maxWidth);
      this.rootEl.style.setProperty('--ai-widget-width', `${Math.round(nextWidth)}px`);
      if (isResizableWindowPanelMode(mode) && height !== undefined && height !== null) {
        const nextHeight = this.clampPanelSizeValue(height, bounds.minHeight, bounds.maxHeight);
        this.rootEl.style.setProperty('--ai-widget-height', `${Math.round(nextHeight)}px`);
      }
    }

    clampPanelSizeToViewport() {
      if (!this.rootEl || !this.modalDialogEl) return;
      if (isMobileViewport() || document.fullscreenElement) return;
      const rect = this.modalDialogEl.getBoundingClientRect();
      const mode = this.config.panelMode;
      this.applyPanelSize(rect.width, isResizableWindowPanelMode(mode) ? rect.height : null);
    }

    /**
     * 使用者拖曳 Widget 面板邊界時，動態更新 CSS 變數控制尺寸。
     * - modal：右下角拖曳，同時調整寬與高。
     * - right-bottom-window：左上角拖曳，向左調寬、向上調高。
     * - left-bottom-window：右上角拖曳，向右調寬、向上調高。
     * - drawer-left：右側拖曳，只調整寬度。
     * - drawer-right：左側拖曳，只調整寬度。
     * - 手機或全螢幕模式不啟用，避免干擾觸控與行動版全螢幕體驗。
     */
    startPanelResize(event) {
      if (!this.rootEl || !this.modalDialogEl || isMobileViewport()) return;
      if (document.fullscreenElement) return;
      if (event.button !== undefined && event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      if (this.resizeHandleEl && this.resizeHandleEl.setPointerCapture && event.pointerId !== undefined) {
        try { this.resizeHandleEl.setPointerCapture(event.pointerId); } catch (_) {}
      }

      const mode = this.config.panelMode;
      const rect = this.modalDialogEl.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = rect.width;
      const startHeight = rect.height;

      this.rootEl.classList.add('is-resizing-panel');

      this.boundPanelResizeMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        let nextWidth = startWidth;
        let nextHeight = startHeight;

        if (mode === 'drawer-right' || mode === 'right-bottom-window') {
          nextWidth = startWidth - deltaX;
        } else {
          nextWidth = startWidth + deltaX;
        }

        if (mode === 'modal') {
          nextHeight = startHeight + deltaY;
        } else if (mode === 'right-bottom-window' || mode === 'left-bottom-window') {
          nextHeight = startHeight - deltaY;
        }

        this.applyPanelSize(nextWidth, isResizableWindowPanelMode(mode) ? nextHeight : null);
      };

      this.boundPanelResizeEnd = () => {
        this.rootEl.classList.remove('is-resizing-panel');
        global.removeEventListener('pointermove', this.boundPanelResizeMove);
        global.removeEventListener('pointerup', this.boundPanelResizeEnd);
        global.removeEventListener('pointercancel', this.boundPanelResizeEnd);
        this.boundPanelResizeMove = null;
        this.boundPanelResizeEnd = null;
      };

      global.addEventListener('pointermove', this.boundPanelResizeMove);
      global.addEventListener('pointerup', this.boundPanelResizeEnd);
      global.addEventListener('pointercancel', this.boundPanelResizeEnd);
    }

    handlePanelResizeKeydown(event) {
      if (!this.rootEl || !this.modalDialogEl || isMobileViewport()) return;
      if (document.fullscreenElement) return;
      const key = event.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;

      const mode = this.config.panelMode;
      const rect = this.modalDialogEl.getBoundingClientRect();
      const step = event.shiftKey ? 48 : 16;
      let nextWidth = rect.width;
      let nextHeight = rect.height;

      if (mode === 'right-bottom-window') {
        if (key === 'ArrowLeft') nextWidth += step;
        if (key === 'ArrowRight') nextWidth -= step;
      } else {
        if (key === 'ArrowRight') nextWidth += step;
        if (key === 'ArrowLeft') nextWidth -= step;
      }

      if (mode === 'right-bottom-window' || mode === 'left-bottom-window') {
        if (key === 'ArrowUp') nextHeight += step;
        if (key === 'ArrowDown') nextHeight -= step;
      } else if (mode === 'modal') {
        if (key === 'ArrowDown') nextHeight += step;
        if (key === 'ArrowUp') nextHeight -= step;
      }
      if (!isResizableWindowPanelMode(mode) && (key === 'ArrowUp' || key === 'ArrowDown')) return;

      event.preventDefault();
      this.applyPanelSize(nextWidth, isResizableWindowPanelMode(mode) ? nextHeight : null);
    }

    applyResponsiveModes() {
      if (!this.rootEl) return;
      syncViewportMetrics(this.rootEl);
      const mobile = isMobileViewport();
      const hideOnMobile = mobile && this.config.mobileMode === 'hide';
      const fullscreenOnMobile = mobile && this.config.mobileMode === 'auto-fullscreen';
      const sameAsDesktopOnMobile = mobile && this.config.mobileMode === 'same-as-desktop';
      this.rootEl.classList.toggle('is-mobile-viewport', mobile);
      this.rootEl.classList.toggle('is-mobile-hidden-mode', hideOnMobile);
      this.rootEl.classList.toggle('is-mobile-fullscreen-mode', fullscreenOnMobile);
      this.rootEl.classList.toggle('is-mobile-same-as-desktop-mode', sameAsDesktopOnMobile);
      if (!mobile && this.rootEl.classList.contains('open')) {
        this.clampPanelSizeToViewport();
      }
      if (this.launcherEl) {
        this.launcherEl.hidden = hideOnMobile;
        this.launcherEl.setAttribute('aria-hidden', hideOnMobile ? 'true' : 'false');
      }
      if (hideOnMobile && this.rootEl.classList.contains('open')) {
        this.close();
      }
      this.syncRuntimeSummary('responsive');
    }

    // 載入 Widget 快速提問：只作為 UI 提問入口，不等同 FAQ 答案資料。
    async loadSuggestedQuestions() {
      this.suggestionsEl.innerHTML = '';
      if (this.suggestionsWrapEl) this.suggestionsWrapEl.style.display = 'none';
      this.suggestionsLoadStatus = 'loading';
      this.suggestionsLoadError = '';
      this.suggestionsLoadCount = 0;
      this.syncRuntimeSummary('suggestions-loading');

      try {
        // v28.6.19.19.151：快速提問必須跟目前助理一致。
        // v28.6.19.19.151：改用 POST 查詢快速提問。
        // iPad Safari 在 iframe / srcdoc 預覽中的 GET 可能不帶 Origin / Referer，
        // 導致後端 Allowed Origins 誤判；POST 與 session/create、chat/send 行為一致。
        const endpoint = this.config.suggestedQuestionsQueryEndpoint || replaceSiteCodeTemplate(this.config.suggestedQuestionsEndpointTemplate, this.config.siteCode);
        const data = await apiFetch(this.config.apiBase, endpoint, {
          method: 'POST',
          body: JSON.stringify({
            siteCode: this.config.siteCode,
            assistantCode: this.config.assistantCode || null
          })
        });
        const items = Array.isArray(data) ? data : (data && data.items ? data.items : []);
        items.forEach((item) => {
          const text = typeof item === 'string' ? item : (item.questionText || item.text || item.title || '');
          if (!text) return;
          const chip = createEl('button', 'ai-assistant-widget-chip', text);
          chip.type = 'button';
          chip.setAttribute('aria-label', '快速提問：' + text);
          chip.addEventListener('click', () => {
            if (this.isBusy) return;
            this.pendingSuggestedQuestion = typeof item === 'string' ? null : {
              suggestedQuestionId: Number(item.suggestedQuestionId || 0) || null,
              hitTargetMode: String(item.hitTargetMode || 'DEFAULT')
            };
            this.textareaEl.value = text;
            this.sendCurrentMessage();
          });
          this.suggestionsEl.appendChild(chip);
        });
        this.suggestionsLoadCount = this.suggestionsEl.querySelectorAll('.ai-assistant-widget-chip').length;
        this.suggestionsLoadStatus = this.suggestionsLoadCount > 0 ? 'loaded' : 'empty';
        this.suggestionsExpanded = this.hasConversationStarted ? false : (this.config.suggestionsMode === 'collapsed' ? false : true);
        this.applySuggestionsState();
      } catch (error) {
        this.suggestionsLoadStatus = 'failed';
        this.suggestionsLoadError = error && error.message ? error.message : '快速提問載入失敗';
        this.applySuggestionsState();
        if (global.console && typeof global.console.warn === 'function') {
          console.warn('AI Assistant Widget 快速提問載入失敗。', {
            siteCode: this.config.siteCode,
            assistantCode: this.config.assistantCode,
            error: this.suggestionsLoadError
          });
        }
      }
      this.syncRuntimeSummary('suggestions');
    }

    applySuggestionsState() {
      if (!this.suggestionsWrapEl || !this.suggestionsEl || !this.suggestionsToggleBtnEl) return;
      const chips = Array.from(this.suggestionsEl.querySelectorAll('.ai-assistant-widget-chip'));
      const hasItems = chips.length > 0;
      if (this.rootEl) this.rootEl.classList.toggle('has-suggestions', hasItems);
      if (!hasItems) {
        this.suggestionsWrapEl.style.display = 'none';
        return;
      }
      if (this.config.suggestionsMode === 'hidden') {
        this.suggestionsWrapEl.style.display = 'none';
        return;
      }
      this.suggestionsWrapEl.style.display = '';
      // v28.6.19.17.4：快速提問維持完整資料；收合時只保留標題列與展開鈕，不保留任何題目。
      // 這樣題數多時不會占用對話空間，也不會從資料層刪除後台設定的快速提問。
      const shouldShowToggle = chips.length > 0;
      const expanded = shouldShowToggle && this.suggestionsExpanded;
      this.suggestionsWrapEl.classList.toggle('is-compact', false);
      this.suggestionsWrapEl.classList.toggle('is-collapsed', shouldShowToggle && !expanded);
      this.suggestionsWrapEl.classList.toggle('is-expanded', expanded);
      this.suggestionsWrapEl.classList.toggle('is-collapsed-to-bar', shouldShowToggle && !expanded);
      chips.forEach((chip) => chip.classList.toggle('is-hidden-by-collapse', shouldShowToggle && !expanded));
      this.suggestionsToggleBtnEl.hidden = !shouldShowToggle;
      syncSuggestionsToggleIcon(this.suggestionsToggleBtnEl, expanded);
    }

    updateFirstScreenState() {
      const preConversation = !this.hasConversationStarted;
      const firstScreenVariant = this.firstScreenVariant || 'initial';
      const isInitialScreen = preConversation && firstScreenVariant !== 'reset';
      const isResetScreen = preConversation && firstScreenVariant === 'reset';
      const showWelcome = isInitialScreen && this.config.startView !== 'conversation' && this.config.showWelcome !== false;
      const showEmptyMessages = !preConversation || (isResetScreen && this.config.showEmptyMessages !== false) || (isInitialScreen && this.config.startView === 'conversation' && this.config.showEmptyMessages !== false);
      if (this.rootEl) {
        this.rootEl.classList.toggle('is-pre-conversation', preConversation);
        this.rootEl.classList.toggle('is-post-conversation', !preConversation);
        this.rootEl.classList.toggle('is-initial-screen', isInitialScreen);
        this.rootEl.classList.toggle('is-reset-screen', isResetScreen);
        this.rootEl.classList.toggle('has-visible-welcome', showWelcome);
        this.rootEl.classList.toggle('has-visible-empty-messages', preConversation && showEmptyMessages);
        this.rootEl.classList.toggle('start-view-home-active', preConversation && this.config.startView === 'home');
        this.rootEl.classList.toggle('start-view-suggestions-active', preConversation && this.config.startView === 'suggestions');
        this.rootEl.classList.toggle('start-view-conversation-active', preConversation && this.config.startView === 'conversation');
      }
      if (this.welcomeEl) {
        this.welcomeEl.classList.toggle('is-condensed', !showWelcome);
        this.welcomeEl.classList.toggle('is-hidden-after-conversation', !showWelcome);
        this.welcomeEl.setAttribute('aria-hidden', showWelcome ? 'false' : 'true');
        this.welcomeEl.style.display = showWelcome ? '' : 'none';
      }
      if (this.messagesEl) {
        this.messagesEl.classList.toggle('is-pre-conversation', preConversation);
        this.messagesEl.setAttribute('aria-hidden', showEmptyMessages ? 'false' : 'true');
        this.messagesEl.style.display = showEmptyMessages ? '' : 'none';
      }
      this.syncRuntimeSummary('first-screen');
    }

    shouldPlayWelcomeEntrance() {
      return !!(
        this.rootEl
        && this.welcomeEl
        && !this.hasPlayedWelcomeEntrance
        && !this.hasConversationStarted
        && this.firstScreenVariant === 'initial'
        && this.config.startView !== 'conversation'
        && this.config.showWelcome !== false
        && this.welcomeEl.getAttribute('aria-hidden') !== 'true'
      );
    }

    prepareWelcomeEntranceIfNeeded() {
      if (!this.shouldPlayWelcomeEntrance()) return false;
      if (this.welcomeEntranceTimer) {
        window.clearTimeout(this.welcomeEntranceTimer);
        this.welcomeEntranceTimer = null;
      }
      this.rootEl.classList.remove('is-welcome-entrance-active');
      // 先進入準備狀態，讓 Widget 面板開啟後不會先閃出歡迎卡片，再突然開始動畫。
      this.rootEl.classList.add('is-welcome-entrance-preparing');
      return true;
    }

    playWelcomeEntranceIfNeeded(prepared = false) {
      if (!prepared && !this.shouldPlayWelcomeEntrance()) return;
      this.hasPlayedWelcomeEntrance = true;
      if (this.welcomeEntranceTimer) {
        window.clearTimeout(this.welcomeEntranceTimer);
        this.welcomeEntranceTimer = null;
      }
      if (!prepared) {
        this.rootEl.classList.remove('is-welcome-entrance-active');
        this.rootEl.classList.add('is-welcome-entrance-preparing');
      }
      // v262：給面板開啟一小段穩定時間，再啟動歡迎卡片淡入上浮，讓節奏更有儀式感。
      this.welcomeEntranceTimer = window.setTimeout(() => {
        if (!this.rootEl || !this.rootEl.classList.contains('open')) {
          this.welcomeEntranceTimer = null;
          return;
        }
        this.rootEl.classList.remove('is-welcome-entrance-preparing');
        this.rootEl.classList.remove('is-welcome-entrance-active');
        // 強制重算樣式，確保 class 加回去時動畫能穩定觸發。
        void this.rootEl.offsetWidth;
        this.rootEl.classList.add('is-welcome-entrance-active');
        this.welcomeEntranceTimer = window.setTimeout(() => {
          if (this.rootEl) this.rootEl.classList.remove('is-welcome-entrance-active');
          this.welcomeEntranceTimer = null;
        }, 1050);
      }, 420);
    }

    shouldPlayEmptyEntrance() {
      return !!(
        this.rootEl
        && !this.hasConversationStarted
        && this.firstScreenVariant === 'reset'
        && this.config.showEmptyMessages !== false
      );
    }

    prepareEmptyEntranceIfNeeded() {
      if (!this.shouldPlayEmptyEntrance()) return false;
      if (this.emptyEntranceTimer) {
        window.clearTimeout(this.emptyEntranceTimer);
        this.emptyEntranceTimer = null;
      }
      this.rootEl.classList.remove('is-empty-entrance-active');
      // 重新開始後先讓空訊息卡片進入準備狀態，避免畫面先閃出來再開始動畫。
      this.rootEl.classList.add('is-empty-entrance-preparing');
      return true;
    }

    playEmptyEntranceIfNeeded(prepared = false) {
      if (!prepared && !this.shouldPlayEmptyEntrance()) return;
      if (this.emptyEntranceTimer) {
        window.clearTimeout(this.emptyEntranceTimer);
        this.emptyEntranceTimer = null;
      }
      if (!prepared && this.rootEl) {
        this.rootEl.classList.remove('is-empty-entrance-active');
        this.rootEl.classList.add('is-empty-entrance-preparing');
      }
      // v263：重新開始畫面先完成狀態切換，再讓空訊息卡片淡入上浮，維持與歡迎區塊一致的出場節奏。
      this.emptyEntranceTimer = window.setTimeout(() => {
        if (!this.rootEl || !this.rootEl.classList.contains('open') || !this.emptyStateEl || !this.shouldPlayEmptyEntrance()) {
          if (this.rootEl) this.rootEl.classList.remove('is-empty-entrance-preparing');
          this.emptyEntranceTimer = null;
          return;
        }
        this.rootEl.classList.remove('is-empty-entrance-preparing');
        this.rootEl.classList.remove('is-empty-entrance-active');
        // 強制重算樣式，確保 class 加回去時動畫能穩定觸發。
        void this.rootEl.offsetWidth;
        this.rootEl.classList.add('is-empty-entrance-active');
        this.emptyEntranceTimer = window.setTimeout(() => {
          if (this.rootEl) this.rootEl.classList.remove('is-empty-entrance-active');
          this.emptyEntranceTimer = null;
        }, 1050);
      }, 360);
    }

    buildEmptyState() {
      const empty = createEl('div', 'ai-assistant-widget-empty ai-assistant-widget-empty-card');
      empty.appendChild(createEl('div', 'ai-assistant-widget-empty-kicker', this.config.emptyKicker));
      empty.appendChild(createEl('div', 'ai-assistant-widget-empty-title', this.config.emptyTitle));
      empty.appendChild(buildSafeEmbedMarkdownContent(this.config.emptyMessage, 'ai-assistant-widget-empty-text ai-assistant-widget-embed-markdown'));
      if (Array.isArray(this.config.emptyItems)) {
        const list = createEl('ul', 'ai-assistant-widget-empty-list');
        this.config.emptyItems.forEach((itemText) => {
          const item = createEl('li', 'ai-assistant-widget-empty-list-item');
          appendInlineMarkdownContent(item, itemText);
          list.appendChild(item);
        });
        empty.appendChild(list);
      } else {
        empty.appendChild(buildSafeEmbedMarkdownContent(this.config.emptyItems, 'ai-assistant-widget-empty-items-markdown ai-assistant-widget-embed-markdown'));
      }
      return empty;
    }

    renderEmptyState() {
      if (!this.messagesEl) return;
      this.messagesEl.innerHTML = '';
      this.emptyStateEl = this.buildEmptyState();
      this.messagesEl.appendChild(this.emptyStateEl);
      this.handleMessagesScroll();
    }

    clearEmptyState() {
      if (!this.messagesEl) return;
      const empty = this.messagesEl.querySelector('.ai-assistant-widget-empty');
      if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
      this.emptyStateEl = null;
      if (this.emptyEntranceTimer) {
        window.clearTimeout(this.emptyEntranceTimer);
        this.emptyEntranceTimer = null;
      }
      if (this.rootEl) {
        this.rootEl.classList.remove('is-empty-entrance-active');
        this.rootEl.classList.remove('is-empty-entrance-preparing');
      }
    }

    scrollMessagesToBottom(behavior = 'auto') {
      if (!this.messagesEl) return;
      try {
        this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior });
      } catch (_) {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
      this.handleMessagesScroll();
    }

    handleMessagesScroll() {
      if (!this.messagesEl || !this.scrollToBottomBtnEl) return;
      const distance = this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight;
      const shouldShow = distance > 120 && this.hasConversationStarted;
      this.scrollToBottomBtnEl.classList.toggle('is-visible', shouldShow);
    }

    /**
     * 送訊息後的分段 loading 文案。
     * 讓使用者知道目前是在檢索、整理回答或準備引用資訊。
     */
    startLoadingStages() {
      this.stopLoadingStages();
      this.loadingStageIndex = 0;
      const applyStage = () => {
        const stageText = this.loadingStages[this.loadingStageIndex % this.loadingStages.length] || '正在整理回答';
        this.updatePendingTypingText(stageText);
        this.setStatus(stageText, { loading: true, tone: 'info', persist: true });
        this.loadingStageIndex += 1;
      };
      applyStage();
      this.loadingStageTimer = window.setInterval(applyStage, 1400);
    }

    stopLoadingStages() {
      if (this.loadingStageTimer) {
        window.clearInterval(this.loadingStageTimer);
      }
      this.loadingStageTimer = null;
    }

    updatePendingTypingText(text) {
      if (!this.pendingAssistantEl) return;
      const target = this.pendingAssistantEl.querySelector('.ai-assistant-widget-typing-text');
      if (target) target.textContent = text || '正在整理回答';
    }

    clearStatusTimer() {
      if (this.statusClearTimer) {
        window.clearTimeout(this.statusClearTimer);
      }
      this.statusClearTimer = null;
    }

    copyUserQuestionToInput(text) {
      if (!this.textareaEl) return;
      if (this.isBusy || this.textareaEl.disabled) {
        this.setStatus('目前正在處理回答，完成後可再帶入提問。', { tone: 'info', duration: 3600 });
        return;
      }
      const normalizedText = String(text || '').trim();
      if (!normalizedText) return;
      this.textareaEl.value = normalizedText;
      this.autoResizeTextarea();
      this.textareaEl.focus();
      this.setStatus('已帶入提問，可修改後重新送出。', { tone: 'info', duration: 3600 });
    }

    retryLastMessage() {
      if (this.isBusy || !this.lastUserMessageText || !this.textareaEl) return;
      this.textareaEl.value = this.lastUserMessageText;
      this.autoResizeTextarea();
      this.sendCurrentMessage();
    }

    autoResizeTextarea() {
      if (!this.textareaEl) return;
      this.textareaEl.style.height = '0px';
      const nextHeight = Math.min(Math.max(this.textareaEl.scrollHeight, 40), 88);
      this.textareaEl.style.height = nextHeight + 'px';
    }

    /**
     * 確保目前已有對話 Session。
     * 若尚未建立，會同時建立 visitorId 與後端 session/create。
     */
    /**
     * 產生目前 Widget 的對話保存 key。
     * 使用 apiBase + siteCode + assistantCode 隔離不同環境、站台與助理，避免跨站台誤還原。
     */
    getConversationPersistenceKey() {
      if (this.conversationPersistenceKey) return this.conversationPersistenceKey;
      const apiBase = trimSingleTrailingSlash(String(this.config.apiBase || '').trim()) || 'same-origin';
      const siteCode = String(this.config.siteCode || '').trim() || 'default-site';
      const assistantCode = String(this.config.assistantCode || '').trim() || 'default-assistant';
      this.conversationPersistenceKey = [
        'ai-assistant-widget',
        'conversation',
        normalizePersistenceKeyPart(apiBase, 'api'),
        normalizePersistenceKeyPart(siteCode, 'site'),
        normalizePersistenceKeyPart(assistantCode, 'assistant')
      ].join(':');
      return this.conversationPersistenceKey;
    }

    addPersistentMessageRecord(record) {
      if (!record || this.isRestoringConversation) return;
      this.persistedMessages.push(record);
      if (this.persistedMessages.length > CONVERSATION_PERSISTENCE_MAX_MESSAGES) {
        this.persistedMessages = this.persistedMessages.slice(-CONVERSATION_PERSISTENCE_MAX_MESSAGES);
      }
    }

    persistConversationState() {
      if (this.isRestoringConversation) return;
      if (!Array.isArray(this.persistedMessages) || this.persistedMessages.length === 0) return;
      const now = Date.now();
      const snapshot = {
        schemaVersion: 1,
        savedAt: now,
        expiresAt: now + CONVERSATION_PERSISTENCE_TTL_MS,
        sessionId: this.sessionId || null,
        lastAssistantMessageId: this.lastAssistantMessageId || null,
        lastUserMessageText: trimPersistenceText(this.lastUserMessageText, 2000),
        hasConversationStarted: !!this.hasConversationStarted,
        firstScreenVariant: this.firstScreenVariant || 'conversation',
        suggestionsExpanded: !!this.suggestionsExpanded,
        activeGuidedFaqOptions: sanitizeGuidedOptionsForPersistence(this.activeGuidedFaqOptions),
        messages: this.persistedMessages
      };
      const saved = safeStorageSetItem(this.getConversationPersistenceKey(), JSON.stringify(snapshot));
      if (!saved) {
        // 若瀏覽器容量不足，退而保存最近 12 則較輕量的訊息，避免整個跨頁保留失效。
        const compactSnapshot = { ...snapshot, messages: this.persistedMessages.slice(-12) };
        safeStorageSetItem(this.getConversationPersistenceKey(), JSON.stringify(compactSnapshot));
      }
    }

    clearPersistentConversation() {
      safeStorageRemoveItem(this.getConversationPersistenceKey());
      this.persistedMessages = [];
    }

    restorePersistentConversation() {
      if (!this.messagesEl) return false;
      const raw = safeStorageGetItem(this.getConversationPersistenceKey());
      if (!raw) return false;
      let snapshot = null;
      try {
        snapshot = JSON.parse(raw);
      } catch (_) {
        this.clearPersistentConversation();
        return false;
      }

      const now = Date.now();
      if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.messages) || snapshot.messages.length === 0 || Number(snapshot.expiresAt || 0) <= now) {
        this.clearPersistentConversation();
        return false;
      }

      this.isRestoringConversation = true;
      try {
        this.messagesEl.innerHTML = '';
        this.emptyStateEl = null;
        this.sessionId = snapshot.sessionId || null;
        this.lastAssistantMessageId = snapshot.lastAssistantMessageId || null;
        this.lastUserMessageText = snapshot.lastUserMessageText || '';
        this.hasConversationStarted = true;
        this.firstScreenVariant = 'conversation';
        this.suggestionsExpanded = false;
        this.activeGuidedFaqOptions = [];
        this.pendingGuidedFaqAction = '';
        this.pendingAnswerCandidate = null;

        snapshot.messages.forEach((record) => this.restorePersistentMessageRecord(record));
        const restoredActiveOptions = Array.isArray(snapshot.activeGuidedFaqOptions) && snapshot.activeGuidedFaqOptions.length > 0 ? snapshot.activeGuidedFaqOptions : this.activeGuidedFaqOptions;
        this.activeGuidedFaqOptions = sanitizeGuidedOptionsForPersistence(restoredActiveOptions);
        this.persistedMessages = snapshot.messages.slice(-CONVERSATION_PERSISTENCE_MAX_MESSAGES);
        this.applySuggestionsState();
        this.updateFirstScreenState();
        this.syncDisclosureLabels(this.messagesEl);
        this.scrollMessagesToBottom();
        this.handleMessagesScroll();
        return true;
      } catch (_) {
        this.clearPersistentConversation();
        this.renderEmptyState();
        this.updateFirstScreenState();
        return false;
      } finally {
        this.isRestoringConversation = false;
      }
    }

    restorePersistentMessageRecord(record) {
      if (!record || typeof record !== 'object') return;
      if (record.type === 'message') {
        this.appendMessage(record.role === 'assistant' ? 'assistant' : 'user', record.text || '');
        return;
      }
      if (record.type !== 'assistantDetailed') return;
      this.appendAssistantMessage(
        record.assistantMessageId || null,
        record.text || '',
        record.references || [],
        record.modelName || '',
        record.finishReason || '',
        record.answerMode || '',
        record.responsePolicyCode || '',
        record.responsePolicyName || '',
        record.responseMode || '',
        record.responseModeMatchedBy || '',
        record.responseModeReason || '',
        !!record.usedOpenAi,
        !!record.usedRetrieval,
        record.retrievalMode || '',
        record.referenceCount || 0,
        record.groundingLevel || '',
        record.groundingLabel || '',
        record.groundingHint || '',
        record.citationSummary || '',
        record.guardReason || '',
        !!record.usedN8n,
        record.n8nWorkflowCode || '',
        record.n8nRoute || '',
        record.n8nTraceId || '',
        record.n8nResponseType || '',
        record.n8nResponseMode || '',
        record.n8nContractVersion || '',
        record.n8nLatencyMs || null,
        !!record.fallbackApplied,
        record.warnings || [],
        record.openAiCompletionStatus || '',
        !!record.openAiWasIncomplete,
        !!record.openAiContinuationUsed,
        record.openAiContinuationCount || 0,
        record.requestedMaxOutputTokens || 0,
        record.knowledgeRetrievalDiagnosis || null,
        record.runtimePromptTrace || null,
        record.n8nResponseData || null,
        record.n8nResponseMeta || null,
        record.guidedFaqOptions || [],
        record.answerSourceType || '',
        record.answerSourceQuestion || '',
        !!record.answerCandidateRequired,
        record.answerCandidates || []
      );
    }

    buildAssistantPersistenceRecord(assistantMessageId, text, references, modelName, finishReason, answerMode, responsePolicyCode, responsePolicyName, responseMode, responseModeMatchedBy, responseModeReason, usedOpenAi, usedRetrieval, retrievalMode, referenceCount, groundingLevel, groundingLabel, groundingHint, citationSummary, guardReason, usedN8n, n8nWorkflowCode, n8nRoute, n8nTraceId, n8nResponseType, n8nResponseMode, n8nContractVersion, n8nLatencyMs, fallbackApplied, warnings, openAiCompletionStatus, openAiWasIncomplete, openAiContinuationUsed, openAiContinuationCount, requestedMaxOutputTokens, knowledgeRetrievalDiagnosis, runtimePromptTrace, n8nResponseData, n8nResponseMeta, guidedFaqOptions, answerSourceType, answerSourceQuestion, answerCandidateRequired, answerCandidates) {
      return {
        type: 'assistantDetailed',
        assistantMessageId: assistantMessageId || null,
        text: trimPersistenceText(text, 12000),
        references: sanitizeReferencesForPersistence(references),
        modelName: trimPersistenceText(modelName, 100),
        finishReason: trimPersistenceText(finishReason, 80),
        answerMode: trimPersistenceText(answerMode, 80),
        responsePolicyCode: trimPersistenceText(responsePolicyCode, 100),
        responsePolicyName: trimPersistenceText(responsePolicyName, 200),
        responseMode: trimPersistenceText(responseMode, 80),
        responseModeMatchedBy: trimPersistenceText(responseModeMatchedBy, 120),
        responseModeReason: trimPersistenceText(responseModeReason, 500),
        usedOpenAi: !!usedOpenAi,
        usedRetrieval: !!usedRetrieval,
        retrievalMode: trimPersistenceText(retrievalMode, 80),
        referenceCount: Number(referenceCount || 0),
        groundingLevel: trimPersistenceText(groundingLevel, 80),
        groundingLabel: trimPersistenceText(groundingLabel, 120),
        groundingHint: trimPersistenceText(groundingHint, 500),
        citationSummary: trimPersistenceText(citationSummary, 500),
        guardReason: trimPersistenceText(guardReason, 500),
        usedN8n: !!usedN8n,
        n8nWorkflowCode: trimPersistenceText(n8nWorkflowCode, 120),
        n8nRoute: trimPersistenceText(n8nRoute, 200),
        n8nTraceId: trimPersistenceText(n8nTraceId, 120),
        n8nResponseType: trimPersistenceText(n8nResponseType, 80),
        n8nResponseMode: trimPersistenceText(n8nResponseMode, 80),
        n8nContractVersion: trimPersistenceText(n8nContractVersion, 80),
        n8nLatencyMs: n8nLatencyMs || null,
        fallbackApplied: !!fallbackApplied,
        warnings: Array.isArray(warnings) ? warnings.slice(0, 5).map((item) => trimPersistenceText(item, 300)) : [],
        openAiCompletionStatus: trimPersistenceText(openAiCompletionStatus, 80),
        openAiWasIncomplete: !!openAiWasIncomplete,
        openAiContinuationUsed: !!openAiContinuationUsed,
        openAiContinuationCount: Number(openAiContinuationCount || 0),
        requestedMaxOutputTokens: Number(requestedMaxOutputTokens || 0),
        knowledgeRetrievalDiagnosis: cloneForPersistence(knowledgeRetrievalDiagnosis, 60000),
        runtimePromptTrace: cloneForPersistence(runtimePromptTrace, 60000),
        n8nResponseData: cloneForPersistence(n8nResponseData, 80000),
        n8nResponseMeta: cloneForPersistence(n8nResponseMeta, 30000),
        guidedFaqOptions: sanitizeGuidedOptionsForPersistence(guidedFaqOptions),
        answerSourceType: trimPersistenceText(answerSourceType, 80),
        answerSourceQuestion: trimPersistenceText(answerSourceQuestion, 1000),
        answerCandidateRequired: !!answerCandidateRequired,
        answerCandidates: sanitizeAnswerCandidatesForPersistence(answerCandidates)
      };
    }

    /**
     * 取得目前訪客識別碼。
     * - 已存在則沿用，讓多次開啟 Widget 仍維持同一訪客視角。
     * - 不存在則建立新 UUID，並寫回 localStorage。
     */
    getOrCreateVisitorId() {
      const storageKey = 'ai-assistant-widget-visitor-id';
      const existingVisitorId = localStorage.getItem(storageKey);
      if (existingVisitorId) return existingVisitorId;
      const createdVisitorId = crypto.randomUUID();
      localStorage.setItem(storageKey, createdVisitorId);
      return createdVisitorId;
    }

    async ensureSession() {
      if (this.sessionId) return this.sessionId;
      const visitorId = this.getOrCreateVisitorId();

      const data = await apiFetch(this.config.apiBase, this.config.sessionEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          siteCode: this.config.siteCode,
          assistantCode: this.config.assistantCode,
          visitorId,
          languageCode: this.config.languageCode,
          referrerUrl: this.config.referrerUrl,
          metadataJson: this.config.metadataJson
        })
      });

      this.sessionId = data.sessionId;
      return this.sessionId;
    }

    showResetConfirmation() {
      if (!this.resetConfirmEl) {
        return Promise.resolve(global.confirm ? global.confirm('確定要重新開始對話？\n重新開始後，畫面上的目前對話會清空，並建立新的對話。') : false);
      }
      if (this.resetConfirmResolve) return Promise.resolve(false);
      this.resetConfirmLastFocusedEl = document.activeElement;
      this.resetConfirmEl.hidden = false;
      this.resetConfirmEl.classList.add('is-visible');
      if (this.rootEl) this.rootEl.classList.add('is-reset-confirm-open');
      return new Promise((resolve) => {
        this.resetConfirmResolve = resolve;
        window.setTimeout(() => {
          const confirmButton = this.resetConfirmEl && this.resetConfirmEl.querySelector('.ai-assistant-widget-reset-confirm-ok');
          if (confirmButton && typeof confirmButton.focus === 'function') confirmButton.focus();
          else if (this.resetConfirmEl && typeof this.resetConfirmEl.focus === 'function') this.resetConfirmEl.focus();
        }, 0);
      });
    }

    closeResetConfirmation(confirmed) {
      const resolver = this.resetConfirmResolve;
      this.resetConfirmResolve = null;
      if (this.resetConfirmEl) {
        this.resetConfirmEl.classList.remove('is-visible');
        this.resetConfirmEl.hidden = true;
      }
      if (this.rootEl) this.rootEl.classList.remove('is-reset-confirm-open');
      const focusTarget = this.resetConfirmLastFocusedEl;
      this.resetConfirmLastFocusedEl = null;
      if (!confirmed && focusTarget && typeof focusTarget.focus === 'function') {
        window.setTimeout(() => focusTarget.focus(), 0);
      }
      if (resolver) resolver(!!confirmed);
    }

    async confirmResetConversation() {
      if (this.isBusy) {
        this.setStatus('目前正在處理回答，完成後再重新開始。', { tone: 'info', duration: 3600 });
        return false;
      }
      return await this.showResetConfirmation();
    }

    async resetConversationFromInput() {
      if (!(await this.confirmResetConversation())) return;
      await this.performResetConversation();
      if (this.textareaEl && !this.textareaEl.disabled) this.textareaEl.focus();
    }

    async resetConversation() {
      if (!(await this.confirmResetConversation())) return;
      await this.performResetConversation();
    }

    async performResetConversation() {
      this.closeResetConfirmation(false);
      this.stopLoadingStages();
      this.clearPendingAssistant();
      this.clearPersistentConversation();
      this.sessionId = null;
      this.lastAssistantMessageId = null;
      this.lastUserMessageText = '';
      this.activeGuidedFaqOptions = [];
      this.pendingGuidedFaqAction = '';
      this.pendingAnswerCandidate = null;
      this.hasConversationStarted = false;
      this.firstScreenVariant = 'reset';
      const shouldAnimateEmptyEntrance = this.prepareEmptyEntranceIfNeeded();
      this.suggestionsExpanded = this.config.suggestionsMode === 'collapsed' ? false : true;
      this.renderEmptyState();
      this.applySuggestionsState();
      this.updateFirstScreenState();
      this.playEmptyEntranceIfNeeded(shouldAnimateEmptyEntrance);
      this.autoResizeTextarea();
      this.setStatus('已重新建立新對話。', { tone: 'success' });
      await this.ensureSession();
    }

    /**
     * 建立 chat/send 的 payload。
     * 把送出契約集中在同一個 method，後續若要補 metadata 或 trace 欄位時較容易維護。
     */
    buildSendMessagePayload(messageText) {
      const payload = {
        sessionId: this.sessionId,
        messageText,
        answerCandidateLimit: this.config.answerCandidateLimit
      };
      if (this.pendingSuggestedQuestion && this.pendingSuggestedQuestion.suggestedQuestionId) {
        payload.suggestedQuestionId = this.pendingSuggestedQuestion.suggestedQuestionId;
        payload.suggestedQuestionHitTargetMode = this.pendingSuggestedQuestion.hitTargetMode || 'DEFAULT';
      }
      if (this.pendingGuidedFaqAction) {
        payload.guidedFaqAction = this.pendingGuidedFaqAction;
      }
      if (this.pendingAnswerCandidate) {
        payload.answerCandidateAction = 'Select';
        payload.answerCandidateSourceType = this.pendingAnswerCandidate.sourceType;
        payload.answerCandidateSourceId = this.pendingAnswerCandidate.sourceId;
      }
      return payload;
    }

    /**
     * 目前輸入框送出主流程。
     * 會負責：
     * 1. 建立 / 確保 session
     * 2. 更新前端狀態與 pending UI
     * 3. 呼叫 chat/send
     * 4. 將回答、引用、依據狀態綁到正確的 assistant message
     */
    async sendCurrentMessage() {
      if (this.isBusy) return;
      const messageText = (this.textareaEl.value || '').trim();
      if (!messageText) return;

      this.lastUserMessageText = messageText;
      this.isBusy = true;
      this.updateBusyState(true);
      this.startLoadingStages();

      try {
        await this.ensureSession();
        this.hasConversationStarted = true;
        this.firstScreenVariant = 'conversation';
        this.suggestionsExpanded = false;
        this.applySuggestionsState();
        this.updateFirstScreenState();
        this.appendMessage('user', messageText);
        this.textareaEl.value = '';
        this.autoResizeTextarea();
        this.showPendingAssistant();

        const data = await apiFetch(this.config.apiBase, this.config.sendEndpoint, {
          method: 'POST',
          body: JSON.stringify(this.buildSendMessagePayload(messageText))
        });

        this.stopLoadingStages();
        this.clearPendingAssistant();
        this.lastAssistantMessageId = data.assistantMessageId;
        if (this.rootEl) {
          this.rootEl.dataset.runtimeLastAnswerMode = String(data.answerMode || '');
          this.rootEl.dataset.runtimeLastResponseMode = String(data.responseMode || '');
          this.rootEl.dataset.runtimeLastResponsePolicy = String(data.responsePolicyCode || '');
          this.rootEl.dataset.runtimeLastWorkflow = String(data.n8nWorkflowCode || '');
          this.rootEl.dataset.runtimeLastRoute = String(data.n8nRoute || '');
          this.rootEl.dataset.runtimeLastUsedN8n = String(!!data.usedN8n);
        }
        this.appendAssistantMessage(data.assistantMessageId, data.assistantMessageText, data.references || [], data.modelName, data.finishReason, data.answerMode, data.responsePolicyCode || '', data.responsePolicyName || '', data.responseMode || '', data.responseModeMatchedBy || '', data.responseModeReason || '', data.usedOpenAi, data.usedRetrieval, data.retrievalMode, data.referenceCount, data.knowledgeGroundingLevel, data.knowledgeGroundingLabel, data.knowledgeGroundingHint, data.citationSummary, data.guardReason, !!data.usedN8n, data.n8nWorkflowCode || '', data.n8nRoute || '', data.n8nTraceId || '', data.n8nResponseType || '', data.n8nResponseMode || '', data.n8nContractVersion || '', data.n8nLatencyMs, !!data.fallbackApplied, data.warnings || [], data.openAiCompletionStatus || '', !!data.openAiWasIncomplete, !!data.openAiContinuationUsed, data.openAiContinuationCount || 0, data.requestedMaxOutputTokens || 0, data.knowledgeRetrievalDiagnosis || null, data.runtimePromptTrace || null, data.n8nResponseData || null, data.n8nResponseMeta || null, data.guidedFaqOptions || [], data.answerSourceType || '', data.answerSourceQuestion || '', !!data.answerCandidateRequired, data.answerCandidates || []);
        this.setStatus('回答已更新。', { tone: 'success' });
      } catch (error) {
        this.stopLoadingStages();
        this.clearPendingAssistant();
        this.appendMessage('assistant', `系統處理失敗：${error.message}`);
        this.setStatus('本次送出失敗，請稍後再試。', {
          tone: 'error',
          duration: 7000,
          actionLabel: '重新送出',
          action: () => this.retryLastMessage()
        });
      } finally {
        this.pendingSuggestedQuestion = null;
        this.pendingGuidedFaqAction = '';
        this.pendingAnswerCandidate = null;
        this.isBusy = false;
        this.updateBusyState(false);
      }
    }

    appendMessage(role, text) {
      this.clearEmptyState();

      const item = createEl('div', `ai-assistant-widget-message ${role}`);
      item.setAttribute('role', 'article');
      item.setAttribute('tabindex', '0');
      if (role === 'assistant') {
        const bubble = createEl('div', 'ai-assistant-widget-message-bubble');
        if (isSystemFailureText(text)) {
          item.classList.add('is-system-error');
          bubble.classList.add('ai-assistant-widget-message-bubble-error');
          bubble.appendChild(buildSystemErrorContent(text || ''));
        } else {
          bubble.appendChild(buildAnswerContent(text || ''));
        }
        item.appendChild(bubble);
      } else {
        item.textContent = text;
        item.title = '雙擊可將這則提問帶回輸入框';
        item.addEventListener('dblclick', () => this.copyUserQuestionToInput(text));
      }

      this.messagesEl.appendChild(item);
      this.scrollMessagesToBottom();
      if (!this.isRestoringConversation) {
        this.addPersistentMessageRecord({
          type: 'message',
          role: role === 'assistant' ? 'assistant' : 'user',
          text: trimPersistenceText(text, 12000)
        });
        this.persistConversationState();
      }
    }

    normalizeGuidedOptionText(value) {
      return String(value || '').trim().replace(/\s+/g, '');
    }

    shouldShowGuidedFaqRequiredHint(nextOptions) {
      const nextItems = Array.isArray(nextOptions) ? nextOptions.filter(x => x && x.optionText) : [];
      const previousItems = Array.isArray(this.activeGuidedFaqOptions) ? this.activeGuidedFaqOptions.filter(x => x && x.optionText) : [];
      if (nextItems.length === 0 || previousItems.length === 0) return false;

      const userText = this.normalizeGuidedOptionText(this.lastUserMessageText);
      if (!userText) return false;

      return !previousItems.some((item) => this.normalizeGuidedOptionText(item.optionText) === userText);
    }

    markGuidedFaqControlSelected(button, labelPrefix = '已選擇') {
      if (!button) return;
      const originalText = String(button.textContent || '').trim();
      button.classList.add('is-selected');
      button.setAttribute('aria-pressed', 'true');
      if (originalText) button.setAttribute('aria-label', `${labelPrefix}：${originalText}`);
    }

    disableGuidedFaqControls(scope, reasonText = '此引導選項已失效。') {
      const root = scope || this.messagesEl || this.rootEl;
      if (!root || typeof root.querySelectorAll !== 'function') return;

      root.querySelectorAll('.ai-assistant-widget-guided-option, .ai-assistant-widget-guided-exit').forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('is-disabled');
        button.title = button.classList.contains('is-selected') ? '你剛剛選擇的是這一項。' : reasonText;
      });
    }

    exitGuidedFaqFlow() {
      if (this.isBusy || !this.textareaEl) return;
      this.disableGuidedFaqControls(this.messagesEl, '已離開引導，此按鈕已失效。');
      this.pendingGuidedFaqAction = 'Exit';
      this.textareaEl.value = '離開引導';
      this.sendCurrentMessage();
    }

    renderAnswerSourceQuestion(sourceType, sourceQuestion) {
      const question = String(sourceQuestion || '').trim();
      if (!question) return null;
      const normalizedType = String(sourceType || '').toUpperCase();
      if (normalizedType !== 'FAQ' && normalizedType !== 'GUIDED_FAQ') return null;
      const panel = createEl('div', 'ai-assistant-widget-answer-source-question');
      // v28.6.19.18.155：來源問題區改為只顯示問題文字，視覺上不再顯示「來源問題 / 入口問題」標籤。
      panel.setAttribute('aria-label', (normalizedType === 'GUIDED_FAQ' ? '入口問題：' : '來源問題：') + question);
      panel.appendChild(createEl('span', 'ai-assistant-widget-answer-source-question-text', question));
      return panel;
    }

    renderAnswerCandidates(candidates, required) {
      const items = Array.isArray(candidates) ? candidates.filter(x => x && x.question && x.sourceId) : [];
      if (!required || items.length === 0) return null;
      const isFaqDirectoryConfirm = items.some((item) => String(item.sourceType || '').toUpperCase() === 'FAQ_DIRECTORY_CONFIRM');
      const isFaqDirectory = !isFaqDirectoryConfirm && items.some((item) => String(item.matchReason || '').includes('清單導覽'));
      const faqDirectoryHasOnlyGuided = isFaqDirectory && items.every((item) => String(item.sourceType || '').toUpperCase() === 'GUIDED_FAQ');
      const faqDirectoryHasOnlyFaq = isFaqDirectory && items.every((item) => String(item.sourceType || '').toUpperCase() === 'FAQ');
      const directoryTitle = faqDirectoryHasOnlyGuided ? '請選擇要開始的引導式常見問題' : '請選擇要查看的常見問題';
      const directoryHint = faqDirectoryHasOnlyGuided
        ? '點選後會開始引導流程。'
        : (faqDirectoryHasOnlyFaq ? '點選 FAQ 會直接顯示答案。' : '點選 FAQ 會直接顯示答案；點選引導式 FAQ 會開始引導流程。');
      const panelTitle = isFaqDirectoryConfirm ? '請確認是否要查看常見問題清單' : (isFaqDirectory ? directoryTitle : '請選擇最接近的問題');
      const panelHint = isFaqDirectoryConfirm ? '若選擇「是」，系統會列出目前可查看的常見問題；若選擇「不是」，本次導覽會取消。' : (isFaqDirectory ? directoryHint : '系統找到多筆可能符合的 FAQ 或引導式 FAQ，選定後再繼續。');
      const panel = createEl('div', 'ai-assistant-widget-answer-candidates');
      panel.appendChild(createEl('div', 'ai-assistant-widget-answer-candidates-title', panelTitle));
      panel.appendChild(createEl('div', 'ai-assistant-widget-answer-candidates-hint', panelHint));
      const list = createEl('div', 'ai-assistant-widget-answer-candidates-list');
      items.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).forEach((item) => {
        const sourceType = String(item.sourceType || '').toUpperCase();
        const btn = createEl('button', 'ai-assistant-widget-answer-candidate', '');
        btn.type = 'button';
        btn.title = item.question;
        const typeLabel = sourceType === 'FAQ_DIRECTORY_CONFIRM' ? '確認' : (sourceType === 'GUIDED_FAQ' ? '引導式 FAQ' : 'FAQ');
        btn.appendChild(createEl('span', 'ai-assistant-widget-answer-candidate-type', typeLabel));
        btn.appendChild(createEl('span', 'ai-assistant-widget-answer-candidate-question', item.question));
        if (item.matchReason) btn.appendChild(createEl('span', 'ai-assistant-widget-answer-candidate-reason', item.matchReason));
        btn.addEventListener('click', () => {
          if (this.isBusy) return;
          this.pendingAnswerCandidate = { sourceType, sourceId: item.sourceId };
          this.pendingGuidedFaqAction = '';
          this.textareaEl.value = item.question;
          this.sendCurrentMessage();
        });
        list.appendChild(btn);
      });
      panel.appendChild(list);
      return panel;
    }

    renderGuidedFaqOptions(options, showRequiredHint = false) {
      const items = Array.isArray(options) ? options.filter(x => x && x.optionText) : [];
      if (items.length === 0) return null;
      const panel = createEl('div', showRequiredHint ? 'ai-assistant-widget-guided-options is-guided-required' : 'ai-assistant-widget-guided-options');
      panel.appendChild(createEl('div', 'ai-assistant-widget-guided-options-title', showRequiredHint ? '請先從下方選項選擇一項繼續' : '請選擇一個選項繼續'));
      if (showRequiredHint) {
        panel.appendChild(createEl('div', 'ai-assistant-widget-guided-options-hint', '這是引導式 FAQ。請點選其中一個選項；若直接輸入其他內容，系統會再次提醒你選擇。'));
      }
      const list = createEl('div', 'ai-assistant-widget-guided-options-list');
      items.sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0)).forEach((item) => {
        const btn = createEl('button', 'ai-assistant-widget-guided-option', item.optionText);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          if (this.isBusy || btn.disabled) return;
          this.markGuidedFaqControlSelected(btn, '已選擇');
          this.disableGuidedFaqControls(panel, '此引導選項已送出，請查看下方回覆。');
          this.pendingGuidedFaqAction = 'SelectOption';
          this.textareaEl.value = item.optionText;
          this.sendCurrentMessage();
        });
        list.appendChild(btn);
      });
      panel.appendChild(list);
      const exitRow = createEl('div', 'ai-assistant-widget-guided-options-actions');
      const exitBtn = createEl('button', 'ai-assistant-widget-guided-exit', '離開引導');
      exitBtn.type = 'button';
      exitBtn.title = '離開目前的引導式 FAQ，回到一般提問模式。';
      exitBtn.setAttribute('aria-label', '離開引導式 FAQ');
      exitBtn.addEventListener('click', () => {
        if (this.isBusy || exitBtn.disabled) return;
        this.markGuidedFaqControlSelected(exitBtn, '已選擇');
        this.disableGuidedFaqControls(panel, '已離開引導，此按鈕已失效。');
        this.exitGuidedFaqFlow();
      });
      exitRow.appendChild(exitBtn);
      panel.appendChild(exitRow);
      return panel;
    }

    /**
     * 依回答依據狀態回傳對應樣式 class。
     * 讓『強依據 / 部分依據 / 低信度阻擋』有穩定視覺語意。
     */
    buildGroundingTheme(level) {
      switch (level) {
        case 'GROUNDED_STRONG': return 'is-grounded-strong';
        case 'GROUNDED_PARTIAL': return 'is-grounded-partial';
        case 'LOW_CONFIDENCE_BLOCKED': return 'is-grounded-blocked';
        default: return 'is-grounded-plain';
      }
    }

    buildSourceTypeLabel(sourceType) {
      const normalized = String(sourceType || '').toUpperCase();
      if (normalized === 'GUIDED_FAQ') return '引導式 FAQ';
      return normalized === 'FAQ' ? 'FAQ' : '文件';
    }

    /**
     * 依引用來源組成可讀的摘要文字。
     * 例如：高相關 2 則、需留意 1 則。
     */
    buildCitationQualitySummary(references) {
      if (!Array.isArray(references) || references.length === 0) {
        return '未顯示站內引用來源';
      }

      const counts = { HIGH: 0, MEDIUM: 0, REVIEW: 0 };
      references.forEach((ref) => {
        const key = String(ref.confidenceLevel || '').toUpperCase();
        if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
      });

      const parts = [];
      if (counts.HIGH > 0) parts.push(`高相關 ${counts.HIGH} 則`);
      if (counts.MEDIUM > 0) parts.push(`中相關 ${counts.MEDIUM} 則`);
      if (counts.REVIEW > 0) parts.push(`需留意 ${counts.REVIEW} 則`);
      return parts.length ? parts.join('、') : `${references.length} 則來源`;
    }

    /**
     * v28.6.19.15.10：在答案正文結尾建立「答案來源」極簡摘要。
     * 只顯示一般使用者看得懂的四類：FAQ / 文件 / 模型 / n8n，
     * 並固定順序與自動去重，避免把內部技術細節露在答案主體。
     */
    buildAnswerSourceSummary(references, usedOpenAi, usedRetrieval, usedN8n) {
      const refs = Array.isArray(references) ? references : [];
      const hasGuidedFaq = refs.some((ref) => String(ref?.sourceType || '').toUpperCase() === 'GUIDED_FAQ');
      const hasFaq = refs.some((ref) => String(ref?.sourceType || '').toUpperCase() === 'FAQ' || !!ref?.faqId);
      const hasDocument = refs.some((ref) => {
        const sourceType = String(ref?.sourceType || '').toUpperCase();
        return sourceType === 'DOCUMENT' || sourceType === 'KNOWLEDGE_DOCUMENT' || sourceType === 'KNOWLEDGE_CHUNK' || !!ref?.documentId || !!ref?.chunkId;
      });

      // 引導式 FAQ 是完整的選項式回答來源，不應因為 usedRetrieval=true 或 reference 存在而額外顯示「文件」。
      // 例如答案來源應顯示「引導式 FAQ」，不可顯示成「引導式 FAQ、文件」。
      if (hasGuidedFaq) return '引導式 FAQ';

      const items = [];
      if (hasFaq) items.push('FAQ');
      if (hasDocument || (usedRetrieval && refs.length > 0 && !hasFaq)) items.push('文件');
      if (usedOpenAi) items.push('模型');
      if (usedN8n) items.push('n8n');

      return items.length ? items.join('、') : '';
    }

    renderAnswerSourceFooter(references, usedOpenAi, usedRetrieval, usedN8n) {
      const summary = this.buildAnswerSourceSummary(references, usedOpenAi, usedRetrieval, usedN8n);
      if (!summary) return null;

      const footer = createEl('aside', 'ai-assistant-widget-answer-source-footer');
      footer.setAttribute('aria-label', '答案來源');
      footer.textContent = `答案來源：${summary}`;
      return footer;
    }

    safeUrlHost(url) {
      if (!url) return '';
      try {
        return new URL(url).host || '';
      } catch (_) {
        return '';
      }
    }

    isGuidedFaqRequiredHintOnlyText(value) {
      const normalized = String(value || '').replace(/\s+/g, '').trim();
      if (!normalized) return false;
      return normalized === '請從下方選項中選擇一項，讓我繼續引導您。'.replace(/\s+/g, '')
        || normalized === '請先從下方選項選擇一項繼續'.replace(/\s+/g, '');
    }

    /**
     * 將 assistant 回答渲染成完整回應卡。
     * 除了回答本文，也會綁定：引用來源、依據狀態、進階資訊與 feedback。
     */
    appendAssistantMessage(assistantMessageId, text, references, modelName, finishReason, answerMode, responsePolicyCode, responsePolicyName, responseMode, responseModeMatchedBy, responseModeReason, usedOpenAi, usedRetrieval, retrievalMode, referenceCount, groundingLevel, groundingLabel, groundingHint, citationSummary, guardReason, usedN8n, n8nWorkflowCode, n8nRoute, n8nTraceId, n8nResponseType, n8nResponseMode, n8nContractVersion, n8nLatencyMs, fallbackApplied, warnings, openAiCompletionStatus, openAiWasIncomplete, openAiContinuationUsed, openAiContinuationCount, requestedMaxOutputTokens, knowledgeRetrievalDiagnosis, runtimePromptTrace, n8nResponseData, n8nResponseMeta, guidedFaqOptions, answerSourceType, answerSourceQuestion, answerCandidateRequired, answerCandidates) {
      warnings = sanitizeUserVisibleWarnings(warnings);
      text = ensureAssistantAnswerText(text, responseMode);
      const hadActiveGuidedFaqOptionsBefore = Array.isArray(this.activeGuidedFaqOptions) && this.activeGuidedFaqOptions.length > 0;
      this.clearEmptyState();

      const item = createEl('div', 'ai-assistant-widget-message assistant');
      item.setAttribute('role', 'article');
      item.setAttribute('tabindex', '0');
      const assistantShell = createEl('div', 'ai-assistant-widget-assistant-shell');
      const assistantBadge = createEl('div', 'ai-assistant-widget-assistant-badge');
      assistantBadge.innerHTML = '<span>' + buildBrandShort(this.config) + '</span>';
      assistantShell.appendChild(assistantBadge);

      const answerBlock = createEl('div', 'ai-assistant-widget-answer-block');
      const hasFaqAnswerSource = Array.isArray(references) && references.some((ref) => {
        const sourceType = String(ref?.sourceType || '').toUpperCase();
        return sourceType === 'FAQ' || sourceType === 'GUIDED_FAQ' || !!ref?.faqId;
      });
      if (hasFaqAnswerSource) answerBlock.classList.add('is-faq-source');
      const answerTop = createEl('div', 'ai-assistant-widget-answer-topbar');
      const answerTopMeta = createEl('div', 'ai-assistant-widget-answer-topmeta');
      const normalizedGroundingLabel = groundingLabel || (Array.isArray(references) && references.length > 0
        ? '已引用站內來源'
        : (usedOpenAi ? '未引用站內來源' : '系統整理'));
      const normalizedGroundingHint = groundingHint || (Array.isArray(references) && references.length > 0
        ? `本次回答引用 ${references.length} 則站內來源。`
        : (retrievalMode === 'LOW_CONFIDENCE_BLOCKED' ? '站內知識命中不足，已避免引用不可靠來源。' : '本次回答未引用站內來源。'));
      answerTopMeta.appendChild(createEl('div', 'ai-assistant-widget-answer-kicker', '回答'));
      // v28.6.19.19.273：回答狀態摘要列改由 showAnswerStatusSubtitle 控制，預設關閉，避免一般訪客看到偏維運用語。
      if (this.config.showAnswerStatusSubtitle === true) {
        answerTopMeta.appendChild(createEl('div', 'ai-assistant-widget-answer-subtitle', responseMode ? `${normalizedGroundingLabel}｜${formatResponseModeLabel(responseMode)}` : normalizedGroundingLabel));
      }
      answerTop.appendChild(answerTopMeta);

      // v28.6.19.15.11：回答依據按鈕與依據內容區塊已移除。
      // 目前答案主體只保留右下方極簡「答案來源」與可選的引用來源/進階資訊，
      // 避免同一份來源資訊在答案頂部、正文尾端與下方區塊重複出現。
      answerBlock.appendChild(answerTop);
      const sourceQuestionPanel = this.renderAnswerSourceQuestion(answerSourceType, answerSourceQuestion);
      if (sourceQuestionPanel) answerBlock.appendChild(sourceQuestionPanel);
      const shouldShowGuidedRequiredHint = this.shouldShowGuidedFaqRequiredHint(guidedFaqOptions);
      // v28.6.19.18.152：只隱藏「重複提示文字」本身，不隱藏目前引導節點的提問。
      // 使用者直接輸入一般文字時，下方 guided options 會提示要點選選項；上方仍需保留原本引導提問，避免使用者不知道目前要回答哪一題。
      const shouldHideMainAnswerForGuidedRequiredHint = shouldShowGuidedRequiredHint
        && Array.isArray(guidedFaqOptions)
        && guidedFaqOptions.length > 0
        && this.isGuidedFaqRequiredHintOnlyText(text);
      // v28.6.19.15.1.5.5.2.2：主回答文字必須永遠優先顯示。
      // visibleAnswerTypes 只用來控制 n8n 結構化區塊（table / links / cards 等），
      // 不可把 Web API 已回傳的 assistantMessageText 判定為「已依 Widget 顯示設定隱藏」，
      // 否則會出現 API 有答案、Widget 卻只顯示隱藏提醒的錯誤。
      const hasStructuredN8nPayload = usedN8n && isStructuredObject(n8nResponseData);
      const answerContent = shouldHideMainAnswerForGuidedRequiredHint
        ? null
        : (hasStructuredN8nPayload
          ? buildStructuredAnswerContent(text || '', n8nResponseType || '', n8nResponseData, this.config)
          : buildAnswerContent(text || ''));
      if (answerContent) {
        answerContent.classList.add('is-pending-reveal');
        answerBlock.appendChild(answerContent);
      }
      const answerCandidatesPanel = this.renderAnswerCandidates(answerCandidates, answerCandidateRequired);
      if (answerCandidatesPanel) answerBlock.appendChild(answerCandidatesPanel);
      const guidedOptionsPanel = this.renderGuidedFaqOptions(guidedFaqOptions, shouldShowGuidedRequiredHint);
      if (guidedOptionsPanel) answerBlock.appendChild(guidedOptionsPanel);
      const nextGuidedFaqOptions = Array.isArray(guidedFaqOptions) && guidedFaqOptions.length > 0 ? guidedFaqOptions : [];
      if (nextGuidedFaqOptions.length > 0 && hadActiveGuidedFaqOptionsBefore) {
        this.disableGuidedFaqControls(this.messagesEl, '已有新的引導選項，舊按鈕已失效。');
      }
      this.activeGuidedFaqOptions = nextGuidedFaqOptions;
      if (nextGuidedFaqOptions.length === 0 && (hadActiveGuidedFaqOptionsBefore || this.pendingGuidedFaqAction === 'Exit')) {
        this.disableGuidedFaqControls(this.messagesEl, '此引導流程已結束，按鈕已失效。');
      }
      const resultCountHint = usedN8n ? buildResultCountHint(n8nResponseData, n8nResponseMeta, warnings, this.config) : null;
      if (resultCountHint) {
        answerBlock.appendChild(resultCountHint);
      }
      if (Array.isArray(warnings) && warnings.length > 0) {
        const warningPanel = createEl('div', 'ai-assistant-widget-inline-warning');
        warningPanel.appendChild(createEl('div', 'ai-assistant-widget-inline-warning-title', '提醒'));
        warningPanel.appendChild(createEl('div', 'ai-assistant-widget-inline-warning-text', warnings.join('；')));
        answerBlock.appendChild(warningPanel);
      }
      // v28.6.19.19.225：答案來源摘要列改由 showAnswerSourceFooter 控制，預設關閉。
      // 此設定只影響答案正文尾端小摘要，不影響引用來源區塊、references 回傳或進階資訊。
      const shouldShowAnswerSourceFooter = this.config.showAnswerSourceFooter === true;
      const answerSourceFooter = shouldShowAnswerSourceFooter ? this.renderAnswerSourceFooter(references, usedOpenAi, usedRetrieval, usedN8n) : null;
      if (answerSourceFooter) answerBlock.appendChild(answerSourceFooter);
      assistantShell.appendChild(answerBlock);
      item.appendChild(assistantShell);

      const answerModeText = answerMode || '-';
      const retrievalText = retrievalMode === 'LOW_CONFIDENCE_BLOCKED' ? '低命中已抑制' : (retrievalMode || 'NONE');
      const shouldShowAdvancedInfo = this.config.showAdvancedInfo !== false;
      const shouldShowReferencesPanel = this.config.showReferencesPanel === true;
      const shouldShowFeedbackPanel = this.config.showFeedbackPanel !== false;
      if (shouldShowAdvancedInfo) {
      const meta = createEl('details', 'ai-assistant-widget-message-meta');
      meta.setAttribute('aria-label', '回答資訊');
      const metaSummary = createEl('summary', 'ai-assistant-widget-message-meta-summary');
      metaSummary.appendChild(createEl('span', 'ai-assistant-widget-message-meta-title', '進階資訊'));
      metaSummary.appendChild(createEl('span', 'ai-assistant-widget-message-meta-hint', '展開'));
      meta.appendChild(metaSummary);
      const metaBody = createEl('div', 'ai-assistant-widget-message-meta-body');
      const metaOverview = createEl('div', 'ai-assistant-widget-message-meta-overview');
      const referenceTotal = String(referenceCount || (Array.isArray(references) ? references.length : 0));
      const retrievalDiagnosis = normalizeKnowledgeRetrievalDiagnosis(knowledgeRetrievalDiagnosis);
      const continuationCountText = Number.isFinite(Number(openAiContinuationCount)) ? Number(openAiContinuationCount) : 0;
      const requestedTokensText = Number.isFinite(Number(requestedMaxOutputTokens)) && Number(requestedMaxOutputTokens) > 0 ? `${Number(requestedMaxOutputTokens)} tokens` : '-';
      const formatPromptPart = (part) => {
        if (!part) return '-';
        if (part.usedDefault) return `${part.promptType || ''} 預設提示詞`.trim();
        const versionText = part.versionNo ? `v${part.versionNo}` : 'v-';
        const nameText = part.versionName ? ` ${part.versionName}` : '';
        return part.displayName || `${part.templateName || part.templateCode || '-'} / ${versionText}${nameText}`;
      };
      const shortHash = (value) => {
        const textValue = String(value || '').trim();
        return textValue.length > 16 ? textValue.slice(0, 16) : textValue;
      };
      const appendMetaCard = (title, value, note) => {
        const card = createEl('div', 'ai-assistant-widget-message-meta-card');
        card.appendChild(createEl('span', 'ai-assistant-widget-message-meta-card-title', title));
        card.appendChild(createEl('span', 'ai-assistant-widget-message-meta-card-value', value || '-'));
        if (note) card.appendChild(createEl('span', 'ai-assistant-widget-message-meta-card-note', note));
        metaOverview.appendChild(card);
      };
      appendMetaCard('依據狀態', normalizedGroundingLabel || '-', citationSummary || this.buildCitationQualitySummary(references));
      appendMetaCard('執行流程', answerModeText, usedRetrieval ? `檢索：${retrievalText}` : '未使用檢索');
      appendMetaCard('套用模式', formatResponseModeLabel(responseMode) || '-', responseModeMatchedBy ? `命中：${responseModeMatchedBy}` : '');
      appendMetaCard('引用數', referenceTotal, usedOpenAi ? '模型：有' : '模型：無');
      metaBody.appendChild(metaOverview);

      const appendMetaSection = (title, rows) => {
        const visibleRows = rows.filter((row) => row && row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== '');
        if (visibleRows.length === 0) return;
        const section = createEl('section', 'ai-assistant-widget-message-meta-section');
        const sectionHeader = createEl('div', 'ai-assistant-widget-message-meta-section-header');
        sectionHeader.appendChild(createEl('div', 'ai-assistant-widget-message-meta-section-title', title));
        sectionHeader.appendChild(createEl('span', 'ai-assistant-widget-message-meta-section-count', `${visibleRows.length} 項`));
        section.appendChild(sectionHeader);
        const list = createEl('div', 'ai-assistant-widget-message-meta-list');
        visibleRows.forEach(([label, value]) => {
          const valueText = String(value || '-');
          const row = createEl('div', 'ai-assistant-widget-message-meta-row');
          // v28.6.19.15.5：進階資訊明細改為資訊卡片式呈現。
          // 長文字欄位自動跨欄，避免「套用原因、警告」擠在窄欄內不好閱讀。
          if (valueText.length > 34 || ['套用原因', '警告', '保護機制'].includes(label)) {
            row.classList.add('is-wide');
          }
          row.appendChild(createEl('span', 'ai-assistant-widget-message-meta-label', label));
          row.appendChild(createEl('span', 'ai-assistant-widget-message-meta-value', valueText));
          list.appendChild(row);
        });
        section.appendChild(list);
        metaBody.appendChild(section);
      };

      appendMetaSection('回答判讀', [
        ['依據狀態', normalizedGroundingLabel || '-'],
        ['引用摘要', citationSummary || this.buildCitationQualitySummary(references) || '-'],
        ['引用數', referenceTotal],
        ['完成狀態', finishReason || '-']
      ]);
      appendMetaSection('策略與流程', [
        ['套用策略', responsePolicyName || responsePolicyCode || '-'],
        ['套用回答模式(ResponseMode)', formatResponseModeLabel(responseMode) || '-'],
        ['策略命中', responseModeMatchedBy || '-'],
        ['套用原因', responseModeReason || '-'],
        ['執行流程(AnswerMode)', answerModeText],
        ['檢索', `${usedRetrieval ? '有' : '無'} (${retrievalText})`]
      ]);
      appendMetaSection('模型與外部整合', [
        ['模型名稱', modelName || '-'],
        ['模型呼叫', usedOpenAi ? '有' : '無'],
        ['n8n', usedN8n ? '有' : '無'],
        usedN8n ? ['n8n Workflow', n8nWorkflowCode || '-'] : null,
        usedN8n ? ['n8n Route', n8nRoute || '-'] : null,
        usedN8n ? ['n8n 回應型態', n8nResponseType || '-'] : null,
        usedN8n ? ['n8n 回應模式', n8nResponseMode || '-'] : null,
        usedN8n ? ['n8n 契約版本', n8nContractVersion || '-'] : null,
        usedN8n && n8nTraceId ? ['n8n Trace', n8nTraceId] : null,
        usedN8n && n8nLatencyMs != null ? ['n8n 延遲', `${n8nLatencyMs} ms`] : null
      ]);
      if (runtimePromptTrace && runtimePromptTrace.promptBuilt) {
        appendMetaSection('Runtime Prompt 診斷', [
          ['是否送入模型', runtimePromptTrace.sentToModel ? '是，已送入 instructions' : (runtimePromptTrace.modelRequestAttempted ? '有嘗試模型呼叫，但未確認完成送出' : '否，本次未呼叫模型')],
          ['SYSTEM Prompt', formatPromptPart(runtimePromptTrace.systemPrompt)],
          ['RETRIEVAL Prompt', formatPromptPart(runtimePromptTrace.retrievalPrompt)],
          ['SAFETY Prompt', formatPromptPart(runtimePromptTrace.safetyPrompt)],
          ['Prompt 長度', runtimePromptTrace.systemPromptLength ? `${runtimePromptTrace.systemPromptLength} 字元` : '-'],
          ['Prompt Hash', shortHash(runtimePromptTrace.systemPromptHash) || '-'],
          ['檢索內容', runtimePromptTrace.retrievalContextIncluded ? '已納入 Prompt' : '未納入或無足夠檢索內容']
        ]);
      }
      appendMetaSection('回答截斷防護', [
        ['完成狀態', openAiCompletionStatus || finishReason || '-'],
        ['本次輸出上限', requestedTokensText],
        ['是否偵測未完整', openAiWasIncomplete ? '是，已保守收尾' : '否'],
        ['自動續寫', openAiContinuationUsed ? `有（${continuationCountText} 次）` : '無']
      ]);
      if (retrievalDiagnosis) {
        appendMetaSection('知識文件檢索診斷', [
          ['檢索方式', retrievalDiagnosis.retrievalProvider || '-'],
          ['問題關鍵詞', `${retrievalDiagnosis.keywordCount} 個`],
          ['FAQ 候選 / 通過', `${retrievalDiagnosis.faqCandidateCount} / ${retrievalDiagnosis.faqPassedGuardCount}`],
          ['知識文件切塊候選 / 通過', `${retrievalDiagnosis.documentCandidateCount} / ${retrievalDiagnosis.documentPassedGuardCount}`],
          ['通過方式', `文字 ${retrievalDiagnosis.documentLexicalPassedCount} / 向量 ${retrievalDiagnosis.documentSemanticPassedCount}`],
          ['最高分', `總分 ${retrievalDiagnosis.bestDocumentScore} / 文字 ${retrievalDiagnosis.bestDocumentKeywordScore} / 向量 ${retrievalDiagnosis.bestDocumentVectorScore}`],
          ['文件向量可用 / 可比對', `${retrievalDiagnosis.documentVectorAvailableCount} / ${retrievalDiagnosis.documentVectorComparableCount}`],
          ['問題向量', retrievalDiagnosis.queryEmbeddingAvailable ? '已產生' : '未產生或未啟用'],
          retrievalDiagnosis.diagnosticSummary ? ['診斷摘要', retrievalDiagnosis.diagnosticSummary] : null
        ]);
      }
      appendMetaSection('例外與提醒', [
        guardReason ? ['保護機制', guardReason === 'LOW_CONFIDENCE_BLOCKED' ? '低命中已抑制' : guardReason] : null,
        fallbackApplied ? ['保守/降級處理', '本次採用保守回覆或降級流程；不代表一定改走其他回答來源'] : null,
        Array.isArray(warnings) && warnings.length > 0 ? ['警告', warnings.join('；')] : null
      ]);
      meta.appendChild(metaBody);
      item.appendChild(meta);
      }

      if (shouldShowReferencesPanel && Array.isArray(references) && references.length > 0) {
        const refs = createEl('details', 'ai-assistant-widget-references');
        refs.setAttribute('aria-label', '引用資訊');
        const refsSummary = createEl('summary', 'ai-assistant-widget-references-summary');
        const refsSummaryText = createEl('span', 'ai-assistant-widget-references-summary-text', '引用來源');
        const refsSummaryHint = createEl('span', 'ai-assistant-widget-references-summary-hint', `${references.length} 則`);
        refsSummary.appendChild(refsSummaryText);
        refsSummary.appendChild(refsSummaryHint);
        refs.appendChild(refsSummary);

        const refsBody = createEl('div', 'ai-assistant-widget-references-body');
        references.forEach((ref) => {
          const refItem = createEl('div', 'ai-assistant-widget-reference-item');
          const refTop = createEl('div', 'ai-assistant-widget-reference-top');
          refTop.appendChild(createEl('span', 'ai-assistant-widget-reference-type', this.buildSourceTypeLabel(ref.sourceType)));
          refTop.appendChild(createEl('span', `ai-assistant-widget-reference-confidence is-${String(ref.confidenceLevel || 'review').toLowerCase()}`, ref.confidenceLabel || '需留意'));
          refItem.appendChild(refTop);
          if (ref.sourceUrl) {
            const link = createEl('a', 'ai-assistant-widget-reference-title ai-assistant-widget-reference-link', ref.sourceTitle || '引用來源');
            link.href = ref.sourceUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            refItem.appendChild(link);
          } else {
            refItem.appendChild(createEl('div', 'ai-assistant-widget-reference-title', ref.sourceTitle || '引用來源'));
          }
          if (ref.snippetText) {
            refItem.appendChild(createEl('div', 'ai-assistant-widget-reference-snippet', ref.snippetText || ''));
          }
          const refFoot = createEl('div', 'ai-assistant-widget-reference-foot');
          refFoot.appendChild(createEl('span', 'ai-assistant-widget-reference-hint', ref.citationHint || ''));
          const host = this.safeUrlHost(ref.sourceUrl);
          if (host) {
            refFoot.appendChild(createEl('span', 'ai-assistant-widget-reference-host', host));
          }
          refItem.appendChild(refFoot);
          refsBody.appendChild(refItem);
        });
        refs.appendChild(refsBody);
        item.appendChild(refs);
      } else if (shouldShowReferencesPanel) {
        const refsEmpty = createEl('div', `ai-assistant-widget-reference-state ${this.buildGroundingTheme(groundingLevel)}`);
        refsEmpty.appendChild(createEl('div', 'ai-assistant-widget-reference-state-title', normalizedGroundingLabel));
        refsEmpty.appendChild(createEl('div', 'ai-assistant-widget-reference-state-text', normalizedGroundingHint));
        item.appendChild(refsEmpty);
      }

      if (shouldShowFeedbackPanel) {
      const feedback = createEl('div', 'ai-assistant-widget-feedback');
      feedback.appendChild(createEl('div', 'ai-assistant-widget-feedback-label', '這則回答有幫助嗎？'));
      const feedbackActions = createEl('div', 'ai-assistant-widget-feedback-actions');
      const goodBtn = createEl('button', '', '👍 有幫助');
      const badBtn = createEl('button', '', '↺ 待改善');
      goodBtn.type = 'button';
      badBtn.type = 'button';
      goodBtn.setAttribute('aria-label', '這則回答有幫助');
      badBtn.setAttribute('aria-label', '這則回答沒有幫助');
      goodBtn.setAttribute('aria-pressed', 'false');
      badBtn.setAttribute('aria-pressed', 'false');
      goodBtn.addEventListener('click', () => this.sendFeedback(assistantMessageId, true, { goodBtn, badBtn }));
      badBtn.addEventListener('click', () => this.sendFeedback(assistantMessageId, false, { goodBtn, badBtn }));
      feedbackActions.appendChild(goodBtn);
      feedbackActions.appendChild(badBtn);
      feedback.appendChild(feedbackActions);
      item.appendChild(feedback);
      }

      this.messagesEl.appendChild(item);
      this.scrollMessagesToBottom();
      this.syncDisclosureLabels(item);
      if (answerContent) {
        window.setTimeout(() => {
          answerContent.classList.remove('is-pending-reveal');
          this.animateAnswerReveal(answerContent);
        }, 60);
      }
      if (!this.isRestoringConversation) {
        this.addPersistentMessageRecord(this.buildAssistantPersistenceRecord(assistantMessageId, text, references, modelName, finishReason, answerMode, responsePolicyCode, responsePolicyName, responseMode, responseModeMatchedBy, responseModeReason, usedOpenAi, usedRetrieval, retrievalMode, referenceCount, groundingLevel, groundingLabel, groundingHint, citationSummary, guardReason, usedN8n, n8nWorkflowCode, n8nRoute, n8nTraceId, n8nResponseType, n8nResponseMode, n8nContractVersion, n8nLatencyMs, fallbackApplied, warnings, openAiCompletionStatus, openAiWasIncomplete, openAiContinuationUsed, openAiContinuationCount, requestedMaxOutputTokens, knowledgeRetrievalDiagnosis, runtimePromptTrace, n8nResponseData, n8nResponseMeta, guidedFaqOptions, answerSourceType, answerSourceQuestion, answerCandidateRequired, answerCandidates));
        this.persistConversationState();
      }
    }

    async sendFeedback(messageId, isHelpful, controls) {
      if (!this.sessionId || !messageId) return;
      const goodBtn = controls && controls.goodBtn ? controls.goodBtn : null;
      const badBtn = controls && controls.badBtn ? controls.badBtn : null;
      const buttons = [goodBtn, badBtn].filter(Boolean);
      if (buttons.length) {
        buttons.forEach((btn) => {
          btn.disabled = true;
          btn.classList.add('is-submitting');
        });
      }
      try {
        await apiFetch(this.config.apiBase, this.config.feedbackEndpoint, {
          method: 'POST',
          body: JSON.stringify({
            sessionId: this.sessionId,
            messageId,
            isHelpful,
            feedbackType: isHelpful ? 'HELPFUL' : 'NEEDS_IMPROVEMENT',
            feedbackText: null
          })
        });
        this.setStatus('已收到你的回饋。', { tone: 'success' });
        if (goodBtn && badBtn) {
          const selectedBtn = isHelpful ? goodBtn : badBtn;
          const otherBtn = isHelpful ? badBtn : goodBtn;
          selectedBtn.disabled = false;
          selectedBtn.classList.remove('is-submitting');
          selectedBtn.classList.add('is-selected');
          selectedBtn.setAttribute('aria-pressed', 'true');
          otherBtn.classList.remove('is-submitting', 'is-selected');
          otherBtn.setAttribute('aria-pressed', 'false');
          otherBtn.disabled = true;
        }
      } catch (_) {
        this.setStatus('回饋送出失敗。', { tone: 'error', duration: 5000 });
        buttons.forEach((btn) => {
          btn.disabled = false;
          btn.classList.remove('is-submitting');
          btn.setAttribute('aria-pressed', 'false');
        });
      }
    }

    updateBusyState(isBusy) {
      if (this.textareaEl) {
        this.textareaEl.disabled = !!isBusy;
        this.textareaEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
      }
      if (this.sendBtnEl) {
        this.sendBtnEl.disabled = !!isBusy;
        this.sendBtnEl.classList.toggle('is-busy', !!isBusy);
        this.sendBtnEl.setAttribute('aria-disabled', isBusy ? 'true' : 'false');
      }
      if (this.inputResetBtnEl) {
        this.inputResetBtnEl.disabled = !!isBusy;
        this.inputResetBtnEl.classList.toggle('is-disabled', !!isBusy);
        this.inputResetBtnEl.setAttribute('aria-disabled', isBusy ? 'true' : 'false');
      }
      if (this.suggestionsEl) {
        this.suggestionsEl.querySelectorAll('button').forEach((btn) => {
          btn.disabled = !!isBusy;
          btn.classList.toggle('is-disabled', !!isBusy);
        });
      }
    }

    attachDisclosureBehavior(detailsEl) {
      if (!detailsEl || detailsEl.dataset.bound === 'true') return;
      detailsEl.dataset.bound = 'true';
      const hint = detailsEl.querySelector('.ai-assistant-widget-message-meta-hint, .ai-assistant-widget-references-summary-hint');
      if (!hint) return;
      const apply = () => { hint.textContent = detailsEl.open ? '收合' : '查看'; };
      detailsEl.addEventListener('toggle', apply);
      apply();
    }

    syncDisclosureLabels(scope) {
      (scope || this.messagesEl || document).querySelectorAll('.ai-assistant-widget-message-meta, .ai-assistant-widget-references').forEach((detailsEl) => {
        this.attachDisclosureBehavior(detailsEl);
      });
    }

    showPendingAssistant() {
      if (!this.messagesEl || this.pendingAssistantEl) return;
      this.clearEmptyState();

      const item = createEl('div', 'ai-assistant-widget-message assistant assistant-pending');
      item.setAttribute('role', 'status');
      item.setAttribute('aria-live', 'polite');
      const shell = createEl('div', 'ai-assistant-widget-assistant-shell');
      const badge = createEl('div', 'ai-assistant-widget-assistant-badge');
      badge.innerHTML = '<span>' + buildBrandShort(this.config) + '</span>';
      shell.appendChild(badge);

      const block = createEl('div', 'ai-assistant-widget-answer-block ai-assistant-widget-answer-block-pending');
      const top = createEl('div', 'ai-assistant-widget-answer-topbar');
      top.appendChild(createEl('div', 'ai-assistant-widget-answer-kicker', '回答'));
      block.appendChild(top);

      const typing = createEl('div', 'ai-assistant-widget-typing');
      const typingTop = createEl('div', 'ai-assistant-widget-typing-top');
      const typingDots = createEl('div', 'ai-assistant-widget-typing-dots');
      typingDots.innerHTML = '<span></span><span></span><span></span>';
      const typingText = createEl('div', 'ai-assistant-widget-typing-text', this.loadingStages[0] || '正在整理回答');
      typingTop.appendChild(typingDots);
      typingTop.appendChild(typingText);
      typing.appendChild(typingTop);
      typing.appendChild(createAnswerSkeleton());
      block.appendChild(typing);

      shell.appendChild(block);
      item.appendChild(shell);
      this.messagesEl.appendChild(item);
      this.scrollMessagesToBottom();
      this.pendingAssistantEl = item;
    }

    clearPendingAssistant() {
      if (this.pendingAssistantEl && this.pendingAssistantEl.parentNode) {
        this.pendingAssistantEl.parentNode.removeChild(this.pendingAssistantEl);
      }
      this.pendingAssistantEl = null;
    }

    setStatus(text, options = false) {
      if (!this.statusEl) return;
      const normalized = typeof options === 'boolean' ? { loading: options } : (options || {});
      const tone = normalized.tone || (normalized.loading ? 'info' : 'neutral');
      const statusText = text || '';
      this.clearStatusTimer();
      this.statusEl.className = 'ai-assistant-widget-status';
      this.statusEl.classList.toggle('is-loading', !!normalized.loading);
      if (tone && tone !== 'neutral') this.statusEl.classList.add(`is-tone-${tone}`);
      this.statusEl.innerHTML = '';

      if (normalized.loading) {
        const inline = createEl('span', 'ai-assistant-widget-status-inline');
        inline.appendChild(createEl('span', 'ai-assistant-widget-status-spinner'));
        inline.appendChild(createEl('span', 'ai-assistant-widget-status-text', statusText || '正在整理回答'));
        const dots = createEl('span', 'ai-assistant-widget-status-dots');
        dots.setAttribute('aria-hidden', 'true');
        dots.innerHTML = '<span></span><span></span><span></span>';
        inline.appendChild(dots);
        this.statusEl.appendChild(inline);
        this.statusEl.setAttribute('aria-live', 'polite');
        return;
      }

      if (statusText) {
        this.statusEl.appendChild(createEl('span', 'ai-assistant-widget-status-text', statusText));
      }

      if (normalized.actionLabel && typeof normalized.action === 'function') {
        const actionBtn = createEl('button', 'ai-assistant-widget-status-action', normalized.actionLabel);
        actionBtn.type = 'button';
        actionBtn.addEventListener('click', normalized.action);
        this.statusEl.appendChild(actionBtn);
      }

      this.statusEl.setAttribute('aria-live', statusText ? 'polite' : 'off');
      if (statusText && !normalized.persist) {
        const duration = typeof normalized.duration === 'number' ? normalized.duration : (tone === 'error' ? 5200 : 2400);
        this.statusClearTimer = window.setTimeout(() => {
          if (this.statusEl) {
            this.statusEl.className = 'ai-assistant-widget-status';
            this.statusEl.textContent = '';
            this.statusEl.setAttribute('aria-live', 'off');
          }
          this.statusClearTimer = null;
        }, duration);
      }
    }



    getFocusableElements() {
      if (!this.rootEl) return [];
      return Array.from(this.rootEl.querySelectorAll('button:not([disabled]), [href], summary, textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
    }

    handleRootKeydown(e) {
      if (!this.rootEl || !this.rootEl.classList.contains('open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = this.getFocusableElements();
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !this.rootEl.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }


    getFullscreenElement() {
      const rootNode = this.rootEl && typeof this.rootEl.getRootNode === 'function' ? this.rootEl.getRootNode() : null;
      const shadowFullscreenElement = rootNode && rootNode !== document
        ? (rootNode.fullscreenElement || rootNode.webkitFullscreenElement || null)
        : null;
      return shadowFullscreenElement
        || document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
        || document.msFullscreenElement
        || null;
    }

    isWidgetFullscreenElement(fsEl) {
      if (!fsEl || !this.rootEl) return false;
      const candidates = [this.modalDialogEl, this.modalShellEl, this.rootEl].filter(Boolean);
      if (candidates.includes(fsEl)) return true;
      if (candidates.some((node) => typeof node.contains === 'function' && node.contains(fsEl))) return true;
      if (typeof fsEl.contains === 'function' && candidates.some((node) => fsEl.contains(node))) return true;
      const rootNode = typeof this.rootEl.getRootNode === 'function' ? this.rootEl.getRootNode() : null;
      return !!(rootNode && rootNode.host && fsEl === rootNode.host);
    }

    isFullscreenActive() {
      const fsEl = this.getFullscreenElement();
      const nativeActive = this.isWidgetFullscreenElement(fsEl);
      return nativeActive || !!(this.rootEl && this.rootEl.classList.contains('is-fullscreen-fallback'));
    }

    async exitFullscreenMode() {
      if (!this.rootEl) return;
      const fsEl = this.getFullscreenElement();
      const nativeActive = this.isWidgetFullscreenElement(fsEl);
      if (nativeActive) {
        const exit = document.exitFullscreen
          || document.webkitExitFullscreen
          || document.mozCancelFullScreen
          || document.msExitFullscreen;
        if (typeof exit === 'function') {
          try {
            await exit.call(document);
          } catch (_) {
            // 若瀏覽器拒絕同步退出，仍先清掉 Widget 自己的 fallback 狀態，避免 UI 殘留錯誤狀態。
          }
        }
      }
      this.rootEl.classList.remove('is-fullscreen-fallback', 'is-fullscreen-active', 'is-native-fullscreen-active');
      this.syncFullscreenButton();
    }

    syncFullscreenButton() {
      if (!this.fullscreenBtnEl) return;
      const fsEl = this.getFullscreenElement();
      const nativeActive = this.isWidgetFullscreenElement(fsEl);
      const fallbackActive = !!(this.rootEl && this.rootEl.classList.contains('is-fullscreen-fallback'));
      const active = nativeActive || fallbackActive;
      setIconOrText(this.fullscreenBtnEl, active ? 'fa-solid fa-compress' : 'fa-solid fa-expand', active ? '退出全螢幕' : '全螢幕');
      this.fullscreenBtnEl.title = active ? '退出全螢幕' : '全螢幕';
      this.fullscreenBtnEl.setAttribute('aria-label', active ? '退出全螢幕' : '全螢幕');
      this.fullscreenBtnEl.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (this.rootEl) {
        this.rootEl.classList.toggle('is-native-fullscreen-active', nativeActive);
        this.rootEl.classList.toggle('is-fullscreen-active', active);
        this.rootEl.classList.toggle('is-fullscreen-fallback', active && !nativeActive);
      }
      this.refreshFullscreenStructuredLayout();
    }

    refreshFullscreenStructuredLayout() {
      if (!this.rootEl) return;
      const refresh = () => {
        if (!this.rootEl) return;
        // v28.6.19.18.38：全螢幕切換後強制讓結構化回答重新計算寬度。
        // 這可避免 table / cards 在 native fullscreen 進入後仍沿用舊容器寬度。
        this.rootEl.style.setProperty('--ai-widget-layout-refresh-token', String(Date.now()));
        const structuredScrollers = this.rootEl.querySelectorAll('.ai-assistant-widget-structured-table-scroll');
        structuredScrollers.forEach((node) => {
          node.scrollLeft = 0;
        });
        if (this.messagesEl) {
          this.messagesEl.dispatchEvent(new Event('scroll'));
        }
      };
      window.requestAnimationFrame(refresh);
      window.setTimeout(refresh, 80);
    }

    async toggleFullscreen() {
      if (!this.rootEl) return;
      const target = this.modalDialogEl || this.modalShellEl || this.rootEl;
      const active = this.isFullscreenActive();
      try {
        if (active) {
          await this.exitFullscreenMode();
        } else if (target && typeof target.requestFullscreen === 'function') {
          await target.requestFullscreen();
        } else if (target && typeof target.webkitRequestFullscreen === 'function') {
          await target.webkitRequestFullscreen();
        } else {
          this.rootEl.classList.add('is-fullscreen-fallback');
        }
      } catch (_) {
        this.rootEl.classList.toggle('is-fullscreen-fallback', !active);
      }
      this.syncFullscreenButton();
    }

    animateAnswerReveal(container) {
      if (!container) return;
      if (prefersReducedMotion()) {
        container.querySelectorAll('.ai-assistant-widget-answer-heading, .ai-assistant-widget-answer-paragraph, .ai-assistant-widget-answer-list-item').forEach((node) => {
          node.classList.remove('is-revealing');
        });
        if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        return;
      }

      const nodes = Array.from(container.querySelectorAll('.ai-assistant-widget-answer-heading, .ai-assistant-widget-answer-paragraph, .ai-assistant-widget-answer-list-item'));
      if (!nodes.length) return;

      nodes.forEach((node) => {
        // v28.6.19.18.100：若回答內容含安全 Markdown 產生的 inline DOM（連結、粗體、斜體、行內代碼），
        // 不能再用 textContent 清空後逐字動畫，否則 <strong>/<em>/<code>/<a> 會被覆蓋成純文字。
        // 有語意子節點時直接保留完整 DOM，確保 FAQ / 引導式 FAQ 答案的基本樣式真的在 Widget 生效。
        const hasInlineMarkup = node.querySelector && node.querySelector('a.ai-assistant-widget-answer-link, strong.ai-assistant-widget-answer-strong, em.ai-assistant-widget-answer-emphasis-text, code.ai-assistant-widget-answer-code');
        // v28.6.19.18.149：若清單項目內含下一層清單，不可用逐字動畫清空 parent <li> 的 textContent。
        // 否則巢狀 <ul>/<ol> 會被移除，畫面會變成父層文字與子層文字全部黏在同一個第一層項目。
        const hasNestedAnswerList = node.querySelector && node.querySelector('.ai-assistant-widget-answer-list');
        if (hasInlineMarkup || hasNestedAnswerList) {
          node.dataset.fullText = '';
          node.classList.remove('is-revealing');
          return;
        }
        node.dataset.fullText = node.textContent || '';
        node.textContent = '';
        node.classList.add('is-revealing');
      });

      const scrollToBottom = () => {
        if (this.messagesEl) {
          this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }
      };

      const revealNode = (node, index) => {
        if (!node) return Promise.resolve();
        const fullText = node.dataset.fullText || '';
        const hasInlineMarkup = node.querySelector && node.querySelector('a.ai-assistant-widget-answer-link, strong.ai-assistant-widget-answer-strong, em.ai-assistant-widget-answer-emphasis-text, code.ai-assistant-widget-answer-code');
        const hasNestedAnswerList = node.querySelector && node.querySelector('.ai-assistant-widget-answer-list');
        if (!fullText || hasInlineMarkup || hasNestedAnswerList) {
          node.classList.remove('is-revealing');
          return Promise.resolve();
        }

        const isHeading = node.classList.contains('ai-assistant-widget-answer-heading');
        const chunkSize = isHeading
          ? Math.max(4, Math.min(14, Math.ceil(fullText.length / 10)))
          : Math.max(6, Math.min(20, Math.ceil(fullText.length / 14)));
        const delay = isHeading ? 14 : 10;

        return new Promise((resolve) => {
          let cursor = 0;
          const tick = () => {
            const nextSlice = fullText.slice(cursor, Math.min(fullText.length, cursor + chunkSize));
            cursor += nextSlice.length;
            node.textContent = fullText.slice(0, cursor);
            scrollToBottom();
            if (cursor >= fullText.length) {
              node.classList.remove('is-revealing');
              window.setTimeout(resolve, index === nodes.length - 1 ? 0 : 26);
              return;
            }
            const lastChar = node.textContent.slice(-1);
            const pause = /[，、；：]/.test(lastChar) ? delay + 18 : /[。！？]/.test(lastChar) ? delay + 40 : delay;
            window.setTimeout(tick, pause);
          };
          tick();
        });
      };

      nodes.reduce((chain, node, index) => chain.then(() => revealNode(node, index)), Promise.resolve())
        .then(() => {
          nodes.forEach((node) => node.classList.remove('is-revealing'));
          scrollToBottom();
        });
    }


    open() {
      if (!this.rootEl) return;
      this.applyResponsiveModes();
      if (this.rootEl.classList.contains('is-mobile-hidden-mode')) return;
      this.previouslyFocusedEl = document.activeElement;
      const shouldAnimateWelcomeEntrance = this.prepareWelcomeEntranceIfNeeded();
      this.rootEl.classList.add('open');
      if (this.launcherEl) {
        this.launcherEl.setAttribute('aria-expanded', 'true');
        if (this.config.launcherBehavior === 'hide-when-open') {
          this.launcherEl.classList.add('hidden-when-open');
        }
      }
      if (this.config.enableOverlay) document.body.classList.add('ai-assistant-widget-modal-open');
      if (this.modalShellEl) {
        this.modalShellEl.classList.add('show');
        this.modalShellEl.setAttribute('aria-hidden', 'false');
      }
      if (this.backdropEl) this.backdropEl.classList.toggle('show', !!this.config.enableOverlay);
      this.syncFullscreenButton();
      this.handleMessagesScroll();
      this.syncRuntimeSummary('open');
      this.playWelcomeEntranceIfNeeded(shouldAnimateWelcomeEntrance);
      window.setTimeout(() => {
        if (this.textareaEl && !this.textareaEl.disabled) this.textareaEl.focus();
        else if (this.container) this.container.focus();
      }, 20);
    }
    close() {
      if (!this.rootEl) return;
      if (this.welcomeEntranceTimer) {
        window.clearTimeout(this.welcomeEntranceTimer);
        this.welcomeEntranceTimer = null;
      }
      this.rootEl.classList.remove('is-welcome-entrance-active');
      this.rootEl.classList.remove('is-welcome-entrance-preparing');
      if (this.emptyEntranceTimer) {
        window.clearTimeout(this.emptyEntranceTimer);
        this.emptyEntranceTimer = null;
      }
      this.rootEl.classList.remove('is-empty-entrance-active');
      this.rootEl.classList.remove('is-empty-entrance-preparing');
      this.closeResetConfirmation(false);
      this.rootEl.classList.remove('open');
      if (this.launcherEl) {
        this.launcherEl.classList.remove('hidden-when-open');
        this.launcherEl.setAttribute('aria-expanded', 'false');
      }
      if (this.config.enableOverlay) document.body.classList.remove('ai-assistant-widget-modal-open');
      // v28.6.19.19.222：關閉 Widget 時若目前在 Widget 全螢幕狀態，需一併退出全螢幕，避免使用者還要自行按 ESC / F11。
      if (this.isFullscreenActive()) {
        this.exitFullscreenMode().catch(() => {});
      }
      if (this.rootEl) this.rootEl.classList.remove('is-fullscreen-fallback', 'is-fullscreen-active', 'is-native-fullscreen-active');
      if (this.modalShellEl) {
        this.modalShellEl.classList.remove('show');
        this.modalShellEl.setAttribute('aria-hidden', 'true');
      }
      if (this.backdropEl) this.backdropEl.classList.remove('show');
      if (this.scrollToBottomBtnEl) this.scrollToBottomBtnEl.classList.remove('is-visible');
      this.syncFullscreenButton();
      this.syncRuntimeSummary('close');
      const restoreTarget = this.previouslyFocusedEl && typeof this.previouslyFocusedEl.focus === 'function' ? this.previouslyFocusedEl : this.launcherEl;
      if (restoreTarget && typeof restoreTarget.focus === 'function') {
        window.setTimeout(() => restoreTarget.focus(), 10);
      }
    }
  }

  function parseScriptConfig(script) {
    const ds = script.dataset || {};
    // v28.6.19.19.273：空字串與純空白 data-* 都代表「使用後台設定」，不可被判定為嵌入碼覆寫。
    // 唯一例外是 data-subtitle=" "，仍保留用單一空白隱藏副標題的正式用法。
    const hasDatasetValue = (key) => Object.prototype.hasOwnProperty.call(ds, key) && String(ds[key] ?? '').length > 0;
    const hasDatasetText = (key) => Object.prototype.hasOwnProperty.call(ds, key) && String(ds[key] ?? '').trim().length > 0;
    const hasDatasetBoolean = (key) => {
      if (!Object.prototype.hasOwnProperty.call(ds, key)) return false;
      return parseOptionalBoolean(ds[key], undefined) !== undefined;
    };
    return {
      apiBase: ds.apiBase || '',
      siteCode: ds.siteCode || '',
      assistantCode: ds.assistantCode || '',
      languageCode: ds.languageCode || DEFAULTS.languageCode,
      hasCustomLanguageCode: hasDatasetText('languageCode'),
      title: ds.title || DEFAULTS.title,
      subtitle: ds.subtitle || DEFAULTS.subtitle,
      hasCustomTitle: hasDatasetText('title'),
      hasCustomSubtitle: hasDatasetValue('subtitle'),
      welcomeKicker: ds.welcomeKicker || DEFAULTS.welcomeKicker,
      welcomeTitle: ds.welcomeTitle || DEFAULTS.welcomeTitle,
      welcomeMessage: ds.welcomeMessage || DEFAULTS.welcomeMessage,
      emptyKicker: ds.emptyKicker || DEFAULTS.emptyKicker,
      emptyTitle: ds.emptyTitle || DEFAULTS.emptyTitle,
      emptyMessage: ds.emptyMessage || DEFAULTS.emptyMessage,
      emptyItems: ds.emptyItems || DEFAULTS.emptyItems,
      placeholder: ds.placeholder || DEFAULTS.placeholder,
      hasCustomWelcomeKicker: hasDatasetText('welcomeKicker'),
      hasCustomWelcomeTitle: hasDatasetText('welcomeTitle'),
      hasCustomWelcomeMessage: hasDatasetText('welcomeMessage'),
      hasCustomEmptyKicker: hasDatasetText('emptyKicker'),
      hasCustomEmptyTitle: hasDatasetText('emptyTitle'),
      hasCustomEmptyMessage: hasDatasetText('emptyMessage'),
      hasCustomEmptyItems: hasDatasetText('emptyItems'),
      hasCustomPlaceholder: hasDatasetText('placeholder'),
      primaryColor: ds.primaryColor || DEFAULTS.primaryColor,
      hasCustomPrimaryColor: hasDatasetText('primaryColor'),
      launcherIcon: ds.launcherIcon || DEFAULTS.launcherIcon,
      hasCustomLauncherIcon: hasDatasetText('launcherIcon'),
      launcherPosition: ds.launcherPosition || DEFAULTS.launcherPosition,
      hasCustomLauncherPosition: hasDatasetText('launcherPosition'),
      launcherStyle: ds.launcherStyle || DEFAULTS.launcherStyle,
      hasCustomLauncherStyle: hasDatasetText('launcherStyle'),
      launcherText: ds.launcherText || DEFAULTS.launcherText,
      hasCustomLauncherText: hasDatasetText('launcherText'),
      launcherOffsetX: ds.launcherOffsetX || DEFAULTS.launcherOffsetX,
      hasCustomLauncherOffsetX: hasDatasetText('launcherOffsetX'),
      launcherOffsetY: ds.launcherOffsetY || DEFAULTS.launcherOffsetY,
      hasCustomLauncherOffsetY: hasDatasetText('launcherOffsetY'),
      panelOffsetX: ds.panelOffsetX || DEFAULTS.panelOffsetX,
      hasCustomPanelOffsetX: hasDatasetText('panelOffsetX'),
      panelOffsetY: ds.panelOffsetY || DEFAULTS.panelOffsetY,
      hasCustomPanelOffsetY: hasDatasetText('panelOffsetY'),
      autoOpen: ds.autoOpen === 'true',
      hasCustomAutoOpen: hasDatasetBoolean('autoOpen'),
      metadataJson: ds.metadataJson || DEFAULTS.metadataJson,
      hasCustomMetadataJson: hasDatasetText('metadataJson'),
      themeMode: ds.themeMode || DEFAULTS.themeMode,
      hasCustomThemeMode: hasDatasetText('themeMode'),
      panelStyle: ds.panelStyle || DEFAULTS.panelStyle,
      hasCustomPanelStyle: hasDatasetText('panelStyle'),
      panelMode: ds.panelMode || DEFAULTS.panelMode,
      hasCustomPanelMode: hasDatasetText('panelMode'),
      mobileMode: ds.mobileMode || DEFAULTS.mobileMode,
      hasCustomMobileMode: hasDatasetText('mobileMode'),
      density: ds.density || DEFAULTS.density,
      hasCustomDensity: hasDatasetText('density'),
      enableOverlay: Object.prototype.hasOwnProperty.call(ds, 'enableOverlay') ? ds.enableOverlay === 'true' : undefined,
      hasCustomEnableOverlay: hasDatasetBoolean('enableOverlay'),
      showAdvancedInfo: parseOptionalBoolean(ds.showAdvancedInfo, DEFAULTS.showAdvancedInfo),
      hasCustomShowAdvancedInfo: hasDatasetBoolean('showAdvancedInfo'),
      showReferencesPanel: parseOptionalBoolean(ds.showReferencesPanel, DEFAULTS.showReferencesPanel),
      hasCustomShowReferencesPanel: hasDatasetBoolean('showReferencesPanel'),
      showAnswerSourceFooter: parseOptionalBoolean(ds.showAnswerSourceFooter, DEFAULTS.showAnswerSourceFooter),
      hasCustomShowAnswerSourceFooter: hasDatasetBoolean('showAnswerSourceFooter'),
      showAnswerStatusSubtitle: parseOptionalBoolean(ds.showAnswerStatusSubtitle, DEFAULTS.showAnswerStatusSubtitle),
      hasCustomShowAnswerStatusSubtitle: hasDatasetBoolean('showAnswerStatusSubtitle'),
      showFeedbackPanel: parseOptionalBoolean(ds.showFeedbackPanel, DEFAULTS.showFeedbackPanel),
      hasCustomShowFeedbackPanel: hasDatasetBoolean('showFeedbackPanel'),
      showResultCount: parseOptionalBoolean(ds.showResultCount, DEFAULTS.showResultCount),
      hasCustomShowResultCount: hasDatasetBoolean('showResultCount'),
      useThousandsSeparator: parseOptionalBoolean(ds.useThousandsSeparator, DEFAULTS.useThousandsSeparator),
      showWelcome: parseOptionalBoolean(ds.showWelcome, DEFAULTS.showWelcome),
      hasCustomShowWelcome: hasDatasetBoolean('showWelcome'),
      showEmptyMessages: parseOptionalBoolean(ds.showEmptyMessages, DEFAULTS.showEmptyMessages),
      hasCustomShowEmptyMessages: hasDatasetBoolean('showEmptyMessages'),
      showInputResetButton: parseOptionalBoolean(ds.showInputResetButton, DEFAULTS.showInputResetButton),
      hasCustomShowInputResetButton: hasDatasetBoolean('showInputResetButton'),
      hasCustomUseThousandsSeparator: hasDatasetBoolean('useThousandsSeparator'),
      visibleAnswerTypes: ds.visibleAnswerTypes || DEFAULTS.visibleAnswerTypes,
      hasCustomVisibleAnswerTypes: hasDatasetText('visibleAnswerTypes'),
      answerCandidateLimit: ds.answerCandidateLimit || DEFAULTS.answerCandidateLimit,
      hasCustomAnswerCandidateLimit: hasDatasetText('answerCandidateLimit'),
      launcherBehavior: ds.launcherBehavior || DEFAULTS.launcherBehavior,
      hasCustomLauncherBehavior: hasDatasetText('launcherBehavior'),
      themeMode: ds.themeMode || DEFAULTS.themeMode,
      brandShort: ds.brandShort || DEFAULTS.brandShort,
      hasCustomBrandShort: hasDatasetText('brandShort'),
      brandName: ds.brandName || DEFAULTS.brandName,
      hasCustomBrandName: hasDatasetText('brandName'),
      panelStyle: ds.panelStyle || DEFAULTS.panelStyle,
      compactHeader: ds.compactHeader ? ds.compactHeader !== 'false' : DEFAULTS.compactHeader,
      hasCustomCompactHeader: hasDatasetBoolean('compactHeader'),
      suggestionsMode: ds.suggestionsMode || DEFAULTS.suggestionsMode,
      hasCustomSuggestionsMode: hasDatasetText('suggestionsMode'),
      panelMode: ds.panelMode || DEFAULTS.panelMode,
      enableOverlay: parseOptionalBoolean(ds.enableOverlay, DEFAULTS.enableOverlay),
      startView: ds.startView || DEFAULTS.startView,
      hasCustomStartView: hasDatasetText('startView'),
      mobileMode: ds.mobileMode || DEFAULTS.mobileMode,
      density: ds.density || DEFAULTS.density,
      // 官方嵌入參數使用 data-panel-width；內部仍沿用 widgetWidth 變數承接 CSS 變數，避免大幅改動渲染流程。
      widgetWidth: ds.panelWidth || DEFAULTS.widgetWidth,
      hasCustomPanelWidth: hasDatasetText('panelWidth'),
      widgetHeight: ds.panelHeight || DEFAULTS.widgetHeight,
      hasCustomPanelHeight: hasDatasetText('panelHeight')
    };
  }

  global.AIAssistantWidget = {
    create(config) {
      const widget = new AIAssistantWidget(config);
      global.__AIAssistantWidgetLastInstance = widget;
      widget.init();
      return widget;
    },
    getLastInstance() {
      return global.__AIAssistantWidgetLastInstance || null;
    },
    autoInit() {
      const script = document.currentScript || document.querySelector('script[data-ai-assistant-widget]');
      if (!script) return null;
      return this.create(parseScriptConfig(script));
    }
  };
})(window);
