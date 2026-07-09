(function () {
  /*
   * Widget loader 會自動補齊以下依賴：
   * - assets/vendor/bootstrap/bootstrap.min.css
   * - assets/vendor/fontawesome/css/all.min.css
   * - widget.css
   * - widget.bundle.js
   * 因此交付時不能只複製 loader，本版也會依 loader 版本參數替 CSS / JS 加上快取版本。
   */
  var currentScript = document.currentScript || document.querySelector('script[data-ai-assistant-widget]');
  if (!currentScript) return;
  var scriptUrl = new URL(currentScript.src, window.location.href);
  var baseUrl = scriptUrl.origin + scriptUrl.pathname.substring(0, scriptUrl.pathname.lastIndexOf('/') + 1);
  var loaderVersion = '28.6.19.19.296';
  var scriptVersion = (scriptUrl.searchParams.get('v') || scriptUrl.searchParams.get('ver') || '').trim();
  var dataAssetVersion = (currentScript.dataset.assetVersion || '').trim();
  var assetVersion = (dataAssetVersion || scriptVersion || loaderVersion || '').trim();

  function buildLoaderDiagnostics() {
    var rawScriptSrc = currentScript.getAttribute('src') || '';
    var hasVersionQuery = !!scriptVersion;
    var hasAssetVersion = !!dataAssetVersion;
    var issues = [];
    var suggestions = [];

    if (!hasVersionQuery) {
      issues.push('widget-loader.js 的 src 沒有帶 ?v 或 ?ver 版本參數。');
      suggestions.push('請檢查外部嵌入頁是否仍使用舊嵌入碼，並將 src 改為 widget-loader.js?v=' + loaderVersion + '。');
    }

    if (!hasAssetVersion) {
      issues.push('script 標籤沒有設定 data-asset-version。');
      suggestions.push('請在嵌入碼補上 data-asset-version="' + loaderVersion + '"，讓 loader 載入同版 widget.css / widget.bundle.js。');
    }

    if (scriptVersion && scriptVersion !== loaderVersion) {
      issues.push('widget-loader.js 的網址版本是 ' + scriptVersion + '，但目前 loader 程式版本是 ' + loaderVersion + '。');
      suggestions.push('請確認 IIS 實際部署目錄、公司對外頁面、Proxy/CDN 是否仍快取舊版 loader 或舊 HTML。');
    }

    if (dataAssetVersion && dataAssetVersion !== loaderVersion) {
      issues.push('data-asset-version 是 ' + dataAssetVersion + '，但目前 loader 程式版本是 ' + loaderVersion + '。');
      suggestions.push('請同步更新嵌入碼中的 data-asset-version，避免 loader 與 bundle/css 版本不同。');
    }

    if (rawScriptSrc && rawScriptSrc.indexOf('?') < 0 && !hasAssetVersion) {
      suggestions.push('若重新整理後時有時無版本號，通常是外部 HTML 頁面、Layout、CMS 區塊或 IIS/Proxy 快取仍有舊嵌入碼。');
    }

    return {
      loaderVersion: loaderVersion,
      scriptSrc: currentScript.src || rawScriptSrc,
      rawScriptSrc: rawScriptSrc,
      scriptVersion: scriptVersion || null,
      dataAssetVersion: dataAssetVersion || null,
      effectiveAssetVersion: assetVersion || null,
      hasVersionQuery: hasVersionQuery,
      hasAssetVersion: hasAssetVersion,
      pageUrl: window.location.href,
      issues: issues,
      suggestions: suggestions,
      checkedAt: new Date().toISOString()
    };
  }

  function publishLoaderDiagnostics() {
    var diagnostics = buildLoaderDiagnostics();
    window.AIAssistantWidgetLoaderDiagnostics = diagnostics;
    currentScript.setAttribute('data-ai-assistant-loader-version', loaderVersion);
    currentScript.setAttribute('data-ai-assistant-asset-version', assetVersion || '');

    if (diagnostics.issues.length > 0 && window.console && typeof window.console.warn === 'function') {
      console.warn('AI Assistant Widget 版本診斷：偵測到嵌入碼或快取設定可能不是最新版。', diagnostics);
    } else if (window.console && typeof window.console.info === 'function') {
      console.info('AI Assistant Widget 版本診斷：loader 與資源版本設定正常。', diagnostics);
    }

    return diagnostics;
  }

  var loaderDiagnostics = publishLoaderDiagnostics();

  function hasDatasetValue(key) {
    return Object.prototype.hasOwnProperty.call(currentScript.dataset, key) && String(currentScript.dataset[key] == null ? '' : currentScript.dataset[key]).length > 0;
  }

  function hasDatasetText(key) {
    return Object.prototype.hasOwnProperty.call(currentScript.dataset, key) && String(currentScript.dataset[key] == null ? '' : currentScript.dataset[key]).trim().length > 0;
  }

  function parseDatasetBoolean(key, fallback) {
    if (!Object.prototype.hasOwnProperty.call(currentScript.dataset, key)) return fallback;
    var text = String(currentScript.dataset[key] == null ? '' : currentScript.dataset[key]).trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes' || text === 'y') return true;
    if (text === 'false' || text === '0' || text === 'no' || text === 'n') return false;
    return fallback;
  }

  function hasDatasetBoolean(key) {
    return parseDatasetBoolean(key, undefined) !== undefined;
  }

  function withAssetVersion(url) {
    if (!assetVersion) return url;
    try {
      var versionedUrl = new URL(url, window.location.href);
      if (!versionedUrl.searchParams.has('v')) {
        versionedUrl.searchParams.set('v', assetVersion);
      }
      return versionedUrl.href;
    } catch (error) {
      var joiner = url.indexOf('?') >= 0 ? '&' : '?';
      return url + joiner + 'v=' + encodeURIComponent(assetVersion);
    }
  }

  function whenBodyReady() {
    if (document.body) return Promise.resolve();
    return new Promise(function (resolve) {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }

  function createStyleIsolatedMount() {
    var supportsShadowDom = !!(document.body && document.createElement && document.createElement('div').attachShadow);
    var isolationMode = (currentScript.dataset.styleIsolation || 'shadow').toLowerCase();
    var enableShadowDom = isolationMode !== 'scoped' && isolationMode !== 'none' && supportsShadowDom;
    var mount = {
      mode: enableShadowDom ? 'shadow' : 'scoped',
      host: null,
      root: document.body,
      styleRoot: document.head
    };

    if (!enableShadowDom) return mount;

    var host = document.createElement('ai-assistant-widget-host');
    host.setAttribute('data-ai-assistant-widget-host', 'true');
    host.setAttribute('data-style-isolation', 'shadow');
    host.style.cssText = [
      'all: initial !important',
      'position: fixed !important',
      'inset: 0 !important',
      'width: 100vw !important',
      'height: 100vh !important',
      'z-index: 2147483000 !important',
      'pointer-events: none !important',
      'overflow: visible !important',
      'contain: none !important'
    ].join(';');
    document.body.appendChild(host);
    mount.host = host;
    mount.root = host.attachShadow({ mode: 'open' });
    mount.styleRoot = mount.root;
    return mount;
  }

  var widgetMount = null;

  function ensureCss(id, href, targetRoot) {
    return new Promise(function (resolve, reject) {
      var target = targetRoot || document.head;
      if (target.querySelector && target.querySelector('#' + id)) { resolve(); return; }
      if (!targetRoot && document.getElementById(id)) { resolve(); return; }
      var link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      target.appendChild(link);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // 依序載入 CSS 與主程式。預設使用 Shadow DOM 掛載，讓 Widget 樣式與宿主網站隔離；不支援時才退回原本 scoped CSS 模式。
  Promise.resolve()
    .then(whenBodyReady)
    .then(function () {
      widgetMount = createStyleIsolatedMount();
      loaderDiagnostics.styleIsolation = widgetMount.mode;
      loaderDiagnostics.usesShadowDom = widgetMount.mode === 'shadow';
      currentScript.setAttribute('data-ai-assistant-style-isolation', widgetMount.mode);
      return widgetMount.styleRoot;
    })
    .then(function (styleRoot) { return ensureCss('gs-bootstrap-css', withAssetVersion(baseUrl + 'assets/vendor/bootstrap/bootstrap.min.css'), styleRoot); })
    .then(function () { return ensureCss('gs-fontawesome-css', withAssetVersion(baseUrl + 'assets/vendor/fontawesome/css/all.min.css'), widgetMount && widgetMount.styleRoot); })
    .then(function () { return ensureCss('gs-widget-css', withAssetVersion(baseUrl + 'widget.css'), widgetMount && widgetMount.styleRoot); })
    .then(function () { return loadScript(withAssetVersion(baseUrl + 'widget.bundle.js')); })
    .then(function () {
      if (window.AIAssistantWidget) {
        // 這一段是 Widget 對外公開的嵌入參數清單。
        // 若未來新增 / 更名 public option，務必同步更新：
        // 1. Widget/demo/index.html 的「嵌入到網站」說明
        // 2. Widget/docs/EMBED_GUIDE.md
        // 3. Build/HealthCheck/Check_Widget_Embed_Assets.ps1
        window.AIAssistantWidget.create({
          // v28.6.19.19.224：預設掛載到 Shadow DOM，避免宿主網站 reset.css / 全域 button 樣式影響 Widget。
          mountTarget: widgetMount && widgetMount.root,
          shadowHost: widgetMount && widgetMount.host,
          styleIsolation: widgetMount ? widgetMount.mode : 'scoped',
          apiBase: currentScript.dataset.apiBase || '',
          siteCode: currentScript.dataset.siteCode || '',
          assistantCode: currentScript.dataset.assistantCode || '',
          languageCode: currentScript.dataset.languageCode || 'zh-TW',
          hasCustomLanguageCode: hasDatasetText('languageCode'),
          title: currentScript.dataset.title || '小智',
          subtitle: currentScript.dataset.subtitle || '歡迎提問網站相關問題',
          hasCustomTitle: hasDatasetText('title'),
          hasCustomSubtitle: hasDatasetValue('subtitle'),
          // 首次使用 / 重新開始畫面文案：嵌入頁有明確設定 data-* 時，以嵌入頁為準；否則使用系統預設值。
          welcomeKicker: currentScript.dataset.welcomeKicker || '我是您的助理 小智 ~',
          welcomeTitle: currentScript.dataset.welcomeTitle || '您可直接輸入問題',
          welcomeMessage: currentScript.dataset.welcomeMessage || '- 可直接點上方 `快速提問區` 問題，開始對話。\n- 歡迎提問網站相關問題，謝謝~',
          emptyKicker: currentScript.dataset.emptyKicker || '您可直接提問',
          emptyTitle: currentScript.dataset.emptyTitle || '先提問您想了解的服務',
          emptyMessage: currentScript.dataset.emptyMessage || '系統會先整理回答，再視命中情況進行回答',
          emptyItems: currentScript.dataset.emptyItems || '問題越具體，回答通常越穩定。|也可直接點上方快速提問，開始對話。',
          // 首次歡迎與重新開始空訊息開關：只有嵌入頁真的帶 data-* 時才覆寫；未帶時交給 Widget 預設值。
          showWelcome: parseDatasetBoolean('showWelcome', undefined),
          hasCustomShowWelcome: hasDatasetBoolean('showWelcome'),
          showEmptyMessages: parseDatasetBoolean('showEmptyMessages', undefined),
          hasCustomShowEmptyMessages: hasDatasetBoolean('showEmptyMessages'),
          // 底部提問區的重新開始圖示鈕；未設定時預設顯示，設為 false 可隱藏。
          showInputResetButton: parseDatasetBoolean('showInputResetButton', undefined),
          hasCustomShowInputResetButton: hasDatasetBoolean('showInputResetButton'),
          placeholder: currentScript.dataset.placeholder || '請輸入您的問題…',
          hasCustomWelcomeKicker: hasDatasetText('welcomeKicker'),
          hasCustomWelcomeTitle: hasDatasetText('welcomeTitle'),
          hasCustomWelcomeMessage: hasDatasetText('welcomeMessage'),
          hasCustomEmptyKicker: hasDatasetText('emptyKicker'),
          hasCustomEmptyTitle: hasDatasetText('emptyTitle'),
          hasCustomEmptyMessage: hasDatasetText('emptyMessage'),
          hasCustomEmptyItems: hasDatasetText('emptyItems'),
          hasCustomPlaceholder: hasDatasetText('placeholder'),
          primaryColor: currentScript.dataset.primaryColor || '#2563eb',
          hasCustomPrimaryColor: hasDatasetText('primaryColor'),
          launcherIcon: currentScript.dataset.launcherIcon || 'fa-regular fa-comments',
          hasCustomLauncherIcon: hasDatasetText('launcherIcon'),
          launcherBehavior: currentScript.dataset.launcherBehavior || 'hide-when-open',
          hasCustomLauncherBehavior: hasDatasetText('launcherBehavior'),
          launcherPosition: currentScript.dataset.launcherPosition || 'bottom-right',
          hasCustomLauncherPosition: hasDatasetText('launcherPosition'),
          launcherStyle: currentScript.dataset.launcherStyle || 'bubble',
          hasCustomLauncherStyle: hasDatasetText('launcherStyle'),
          launcherText: currentScript.dataset.launcherText || '',
          hasCustomLauncherText: hasDatasetText('launcherText'),
          launcherOffsetX: currentScript.dataset.launcherOffsetX || '24px',
          hasCustomLauncherOffsetX: hasDatasetText('launcherOffsetX'),
          launcherOffsetY: currentScript.dataset.launcherOffsetY || '24px',
          hasCustomLauncherOffsetY: hasDatasetText('launcherOffsetY'),
          // 面板初始位置可與啟動按鈕分開設定；未設定時由 Widget 主程式沿用啟動按鈕偏移。
          panelOffsetX: currentScript.dataset.panelOffsetX || '',
          hasCustomPanelOffsetX: hasDatasetText('panelOffsetX'),
          panelOffsetY: currentScript.dataset.panelOffsetY || '',
          hasCustomPanelOffsetY: hasDatasetText('panelOffsetY'),
          themeMode: currentScript.dataset.themeMode || 'auto',
          hasCustomThemeMode: hasDatasetText('themeMode'),
          brandShort: currentScript.dataset.brandShort || '',
          hasCustomBrandShort: hasDatasetText('brandShort'),
          brandName: currentScript.dataset.brandName || '',
          hasCustomBrandName: hasDatasetText('brandName'),
          panelStyle: currentScript.dataset.panelStyle || 'soft',
          hasCustomPanelStyle: hasDatasetText('panelStyle'),
          compactHeader: parseDatasetBoolean('compactHeader', true),
          hasCustomCompactHeader: hasDatasetBoolean('compactHeader'),
          suggestionsMode: currentScript.dataset.suggestionsMode || 'auto',
          hasCustomSuggestionsMode: hasDatasetText('suggestionsMode'),
          panelMode: currentScript.dataset.panelMode || 'right-bottom-window',
          hasCustomPanelMode: hasDatasetText('panelMode'),
          enableOverlay: parseDatasetBoolean('enableOverlay', undefined),
          hasCustomEnableOverlay: hasDatasetBoolean('enableOverlay'),
          startView: currentScript.dataset.startView || 'home',
          hasCustomStartView: hasDatasetText('startView'),
          mobileMode: currentScript.dataset.mobileMode || 'auto-fullscreen',
          hasCustomMobileMode: hasDatasetText('mobileMode'),
          density: currentScript.dataset.density || 'comfortable',
          hasCustomDensity: hasDatasetText('density'),
          // 面板尺寸使用 data-panel-width / data-panel-height；widget 代表整體元件，不再用於對話面板寬高命名。
          widgetWidth: currentScript.dataset.panelWidth || '400px',
          hasCustomPanelWidth: hasDatasetText('panelWidth'),
          widgetHeight: currentScript.dataset.panelHeight || '700px',
          hasCustomPanelHeight: hasDatasetText('panelHeight'),
          autoOpen: parseDatasetBoolean('autoOpen', false),
          hasCustomAutoOpen: hasDatasetBoolean('autoOpen'),
          metadataJson: currentScript.dataset.metadataJson || '{}',
          hasCustomMetadataJson: hasDatasetText('metadataJson'),
          // 回答主體顯示區塊（進階資訊 / 引用來源 / 答案來源摘要 / 回答狀態摘要 / 回答回饋）現在也可由嵌入頁明確指定。
          // 注意：只有 script 標籤真的帶 data-* 屬性時，才視為嵌入頁覆寫。
          // 未帶屬性時保留 undefined，後續由 /api/widget/config/{siteCode} 的 Runtime 設定接手，避免後台開關失效。
          showAdvancedInfo: parseDatasetBoolean('showAdvancedInfo', undefined),
          hasCustomShowAdvancedInfo: hasDatasetBoolean('showAdvancedInfo'),
          showReferencesPanel: parseDatasetBoolean('showReferencesPanel', undefined),
          hasCustomShowReferencesPanel: hasDatasetBoolean('showReferencesPanel'),
          showAnswerSourceFooter: parseDatasetBoolean('showAnswerSourceFooter', undefined),
          hasCustomShowAnswerSourceFooter: hasDatasetBoolean('showAnswerSourceFooter'),
          showAnswerStatusSubtitle: parseDatasetBoolean('showAnswerStatusSubtitle', undefined),
          hasCustomShowAnswerStatusSubtitle: hasDatasetBoolean('showAnswerStatusSubtitle'),
          showFeedbackPanel: parseDatasetBoolean('showFeedbackPanel', undefined),
          hasCustomShowFeedbackPanel: hasDatasetBoolean('showFeedbackPanel'),
          // 表格型回答可顯示「共 N 筆」摘要；若嵌入頁明確設成 false，前端就不顯示結果筆數提示。
          showResultCount: parseDatasetBoolean('showResultCount', undefined),
          hasCustomShowResultCount: hasDatasetBoolean('showResultCount'),
          // 統計值千分位屬於 Widget 呈現層設定，主要影響 table / row count 這類數值可讀性。
          useThousandsSeparator: parseDatasetBoolean('useThousandsSeparator', undefined),
          hasCustomUseThousandsSeparator: hasDatasetBoolean('useThousandsSeparator'),
          // 回答型別白名單必須由 loader 一併往 widget.bundle.js 傳遞；否則 script 標籤雖然有設 data-visible-answer-types，
          // 但 create() 收到的 config 仍會是 null，造成 text / table / links 不會依嵌入設定過濾。
          visibleAnswerTypes: currentScript.dataset.visibleAnswerTypes || null,
          hasCustomVisibleAnswerTypes: hasDatasetText('visibleAnswerTypes'),
          // FAQ / 引導式 FAQ 同時命中多筆時，候選清單最多顯示幾筆；預設 5，Widget 端會限制在 1～10。
          answerCandidateLimit: currentScript.dataset.answerCandidateLimit || 5,
          hasCustomAnswerCandidateLimit: hasDatasetText('answerCandidateLimit')
        });
      }
    })
    .catch(function (error) {
      console.error('AI Assistant Widget 載入失敗：請確認 widget.css、widget.bundle.js、Bootstrap / Font Awesome vendor 資產都已正確部署。', { error: error, diagnostics: loaderDiagnostics });
    });
})();
