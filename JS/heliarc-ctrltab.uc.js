// ==UserScript==
// @name           Better Tabs & Search
// @description    Arc-style single-row tab switcher with live previews and floating Spotlight tab search bar for Zen Browser.
// @include        main
// ==/UserScript==

(() => {
  if (window.__zenHeliarcCtrlTab) return;
  window.__zenHeliarcCtrlTab = true;

  const HTML = 'http://www.w3.org/1999/xhtml';
  const P = 'zen-heliarc-ctrltab.';
  const prefs = Services.prefs;

  const pref = (name, def) => {
    const key = P + name;
    switch (prefs.getPrefType(key)) {
      case prefs.PREF_BOOL: return prefs.getBoolPref(key);
      case prefs.PREF_INT: return prefs.getIntPref(key);
      case prefs.PREF_STRING: return prefs.getStringPref(key);
    }
    return def;
  };

  // Touching ctrlTab loads Firefox's browser-ctrlTab.js
  const native = ctrlTab;
  const { tabPreviews, tabPreviewPanelHelper } = window;
  const panel = document.getElementById('ctrlTab-panel');
  const list = document.getElementById('ctrlTab-previews');
  const showAllContainer = document.getElementById('ctrlTab-showAll-container');

  if (!panel || !list) return;

  const el = (tag, cls) => {
    const e = document.createElementNS(HTML, tag);
    if (cls) e.className = cls;
    return e;
  };

  const isTabUnloaded = (tab) => {
    if (!tab) return false;
    return !!(
      tab.hasAttribute?.('pending') ||
      tab.hasAttribute?.('discarded') ||
      tab.hasAttribute?.('zen-unloaded') ||
      tab.discarded ||
      tab.pending
    );
  };

  const isBlankTab = (tab) => {
    if (!tab) return true;
    if (tab.hasAttribute?.('zen-empty-tab') || tab.getAttribute?.('zen-empty-tab') === 'true') return true;
    if (tab.hasAttribute?.('zen-empty') || tab.getAttribute?.('zen-empty') === 'true') return true;
    if (tab.isEmpty) return true;

    const rawUrl =
      tab.linkedBrowser?.currentURI?.spec ||
      tab.linkedBrowser?.documentURI?.spec ||
      tab.getAttribute?.('zen-url') ||
      tab.getAttribute?.('url') ||
      '';
    const url = String(rawUrl).trim().toLowerCase();
    const title = String(tab.label || tab.getAttribute?.('label') || '').trim().toLowerCase();

    if (
      url === 'about:blank' ||
      url.startsWith('about:blank') ||
      url === 'about:newtab' ||
      url.startsWith('about:newtab') ||
      url === 'about:home' ||
      url.startsWith('about:home') ||
      url === 'chrome://browser/content/blanktab.html'
    ) {
      return true;
    }

    if (!url && (title === 'new tab' || title === 'nueva pestaña' || title === 'about:blank')) {
      return true;
    }

    if (title === 'new tab' || title === 'nueva pestaña' || title === 'about:blank') {
      if (!url || url.startsWith('about:')) return true;
    }

    return false;
  };

  // Forward declarations for search modal
  let searchModal = null;

  // Sync settings with Firefox/Zen internal preferences
  const apply = () => {
    const enabled = pref('enabled', true);
    const maxTabs = pref('max-tabs', 6);
    const showUnloaded = pref('show-unloaded', false);

    prefs.setBoolPref('browser.ctrlTab.sortByRecentlyUsed', enabled);
    prefs.setBoolPref('zen.ctrlTab.show-pending-tabs', showUnloaded);
    prefs.setIntPref('browser.ctrlTab.maxPreviews', maxTabs);

    // Enforce single-row layout by setting previewsPerRow equal to maxTabs
    native.previewsPerRow = maxTabs;

    // Custom accent color if defined
    const accent = String(pref('accent', '')).trim();
    if (accent) {
      panel.style.setProperty('--heliarc-accent', accent);
      if (searchModal) searchModal.style.setProperty('--heliarc-accent', accent);
    } else {
      panel.style.removeProperty('--heliarc-accent');
      if (searchModal) searchModal.style.removeProperty('--heliarc-accent');
    }
  };

  // Mount the Liquid Glass HUD directly inside #ctrlTab-panel
  const card = el('div');
  card.id = 'heliarc-card';

  card.append(list);
  panel.append(card);

  // In-window backdrop blur element inside document.documentElement.
  // Blurs the web page directly in the window compositor context.
  let backdrop = document.getElementById('heliarc-backdrop');
  if (!backdrop && document.documentElement) {
    backdrop = el('div');
    backdrop.id = 'heliarc-backdrop';
    document.documentElement.append(backdrop);
  }

  const syncBackdrop = (w, h) => {
    if (!backdrop) return;
    const width = w || (card ? card.offsetWidth : 0) || 0;
    const height = h || (card ? card.offsetHeight : 0) || 0;
    if (width > 0 && height > 0) {
      backdrop.style.width = Math.round(width) + 'px';
      backdrop.style.height = Math.round(height) + 'px';
      backdrop.setAttribute('active', '');
    }
  };

  const hideBackdrop = () => {
    if (backdrop) {
      backdrop.removeAttribute('active');
    }
  };

  // Hide the legacy "List all tabs" button container
  if (showAllContainer) {
    showAllContainer.style.display = 'none';
  }

  // PageThumbs helper for direct in-memory tab canvas snapshots
  const getPageThumbs = () => {
    if (window.PageThumbs) return window.PageThumbs;
    try {
      if (window.ChromeUtils?.importESModule) {
        const { PageThumbs } = window.ChromeUtils.importESModule('resource://gre/modules/PageThumbs.sys.mjs');
        return PageThumbs;
      }
    } catch {}
    return null;
  };

  // Directly captures the rendered content of a visible tab into an in-memory canvas
  const captureTabThumbnail = async (tab) => {
    if (!tab || tab.closing || isTabUnloaded(tab) || isBlankTab(tab)) return null;
    const browser = tab.linkedBrowser;
    if (!browser || !browser.browsingContext) return null;
    const uri = browser.currentURI?.spec || tab.getAttribute?.('zen-url') || tab.getAttribute?.('url') || '';
    if (!uri || uri.startsWith('about:')) return null;

    try {
      const pt = getPageThumbs();
      if (!pt) return null;
      const canvas = pt.createCanvas(window, 440, 292);
      await pt.captureToCanvas(browser, canvas);
      tab.__thumbnail = canvas;
      tab.__thumbnail_lastURI = uri;
      return canvas;
    } catch {
      return null;
    }
  };

  // Fast tab preview retrieval:
  // 1. Returns in-memory thumbnail immediately if present.
  // 2. Skips slow 1s disk search for unloaded tabs.
  // 3. Races native capture against a 160ms timeout to avoid Wayland/WebRender IPC freezes on Linux.
  const originalGetThumb = tabPreviews.get ? tabPreviews.get.bind(tabPreviews) : async () => null;
  tabPreviews.get = async function (tab) {
    if (!tab || isBlankTab(tab)) return null;

    const browser = tab.linkedBrowser;
    const uri = browser?.currentURI?.spec || tab.getAttribute?.('zen-url') || tab.getAttribute?.('url') || '';

    if (tab.__thumbnail_lastURI && tab.__thumbnail_lastURI !== uri) {
      tab.__thumbnail = null;
      tab.__thumbnail_lastURI = null;
    }

    if (tab.__thumbnail) {
      const preview = native.previews?.find?.((p) => p._tab === tab);
      if (preview) preview.setAttribute('has-thumbnail', '');
      return tab.__thumbnail;
    }

    if (isTabUnloaded(tab) || (browser && !browser.browsingContext)) {
      return null;
    }

    let result = null;
    try {
      result = await Promise.race([
        originalGetThumb(tab),
        new Promise((resolve) => setTimeout(() => resolve(null), 160)),
      ]);
    } catch {
      result = null;
    }

    if (result) {
      tab.__thumbnail = result;
      tab.__thumbnail_lastURI = uri;
      const preview = native.previews?.find?.((p) => p._tab === tab);
      if (preview) preview.setAttribute('has-thumbnail', '');
    }

    return result;
  };

  // Read-only access to the browser's native recently used tabs order.
  // The mod does not modify, alter, or reorder the browser's registered visit history.
  const getBrowserRecentTabs = () => {
    if (Array.isArray(native._recentlyUsedTabs)) {
      return native._recentlyUsedTabs;
    }
    if (window.gBrowser?.tabs) {
      return Array.from(window.gBrowser.tabs).sort(
        (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
      );
    }
    return [];
  };

  if (!('tabList' in native)) {
    try {
      Object.defineProperty(native, 'tabList', {
        get: getBrowserRecentTabs,
        configurable: true,
        enumerable: true,
      });
    } catch {}
  }

  // Decorate each preview card to match Heliarc:
  // - Full bleed canvas thumbnail
  // - Top-left floating frosted pill (.heliarc-title-pill) with favicon + title
  // - Center fallback icon for unloaded or pending tabs
  const originalUpdatePreview = native.updatePreview;
  native.updatePreview = function (preview, tab) {
    if (preview === this.showAllButton) return;

    if (!tab) {
      preview.hidden = true;
      preview.style.display = 'none';
      preview.removeAttribute('heliarc-unloaded');
      preview.removeAttribute('has-thumbnail');
      const inner = preview.querySelector?.('.ctrlTab-preview-inner') || preview;
      const fallback = inner.querySelector?.('.heliarc-fallback');
      const fallbackImg = fallback?.querySelector?.('.heliarc-fallback-icon') || preview.querySelector?.('.heliarc-fallback-icon');
      if (fallbackImg) {
        fallbackImg.removeAttribute('src');
        try { fallbackImg.src = ''; } catch {}
      }
      originalUpdatePreview?.call(this, preview, tab);
      return;
    }

    preview.hidden = false;
    preview.style.removeProperty('display');

    if (tab.__thumbnail) {
      preview.setAttribute('has-thumbnail', '');
    } else {
      preview.removeAttribute('has-thumbnail');
    }

    originalUpdatePreview.call(this, preview, tab);

    const inner = preview.querySelector('.ctrlTab-preview-inner') || preview;
    const isPending = isTabUnloaded(tab);
    preview.toggleAttribute('heliarc-unloaded', isPending);

    // 1. Setup or update the floating Title Pill
    let pill = inner.querySelector('.heliarc-title-pill');
    const fav = inner.querySelector('.ctrlTab-favicon-container');
    const label = inner.querySelector('.ctrlTab-label');

    if (!pill && fav && label) {
      pill = el('div', 'heliarc-title-pill');
      fav.after(pill);
      pill.append(fav, label);
    }

    // 2. Setup or update center fallback for unloaded / blank tabs
    let fallback = inner.querySelector('.heliarc-fallback');
    if (!fallback) {
      fallback = el('div', 'heliarc-fallback');
      const fallbackIcon = el('img', 'heliarc-fallback-icon');
      fallback.append(fallbackIcon);
      inner.insertBefore(fallback, pill || inner.firstChild);
    }

    if (fallback) {
      const fallbackImg = fallback.querySelector('.heliarc-fallback-icon');
      if (fallbackImg) {
        const iconSrc =
          tab.image ||
          tab.getAttribute?.('image') ||
          (window.gBrowser?.getIcon && window.gBrowser.getIcon(tab)) ||
          'chrome://global/skin/icons/defaultFavicon.svg';
        if (iconSrc) {
          fallbackImg.setAttribute('src', iconSrc);
          try { fallbackImg.src = iconSrc; } catch {}
        } else {
          fallbackImg.removeAttribute('src');
          try { fallbackImg.src = ''; } catch {}
        }
      }
    }
  };

  // Calculate responsive card width so cards NEVER overflow the container
  const updateLayoutMetrics = () => {
    const visiblePreviews = native.previews.filter(
      (p) => !p.hidden && p !== native.showAllButton && p.style.display !== 'none'
    );
    const count = Math.max(1, visiblePreviews.length || pref('max-tabs', 6));
    const winW = window.innerWidth;
    const maxAvailableWidth = Math.min(winW * 0.92, 1440);
    const gap = 16;
    const padding = 20;

    // Adapt card width dynamically to screen resolution & tab count
    const calculatedWidth = Math.floor((maxAvailableWidth - (padding * 2) - ((count - 1) * gap)) / count);
    const cardWidth = Math.max(120, Math.min(220, calculatedWidth));
    const cardHeight = Math.round(cardWidth * (146 / 220));

    panel.style.setProperty('--heliarc-card-width', cardWidth + 'px');
    panel.style.setProperty('--heliarc-card-height', cardHeight + 'px');

    const totalWidth = count * cardWidth + (count - 1) * gap + (padding * 2);
    const totalHeight = cardHeight + (padding * 2);
    return { totalWidth, totalHeight };
  };

  // Customizable delay before HUD appears (quick tap switches without showing HUD)
  const originalOpen = native.open;
  native.open = function () {
    const beforeTimer = this._timer;
    originalOpen.call(this);
    const delay = pref('open-delay', 200);

    if (!this._timer || this._timer === beforeTimer || delay === 200) return;

    clearTimeout(this._timer);
    this._timer = null;

    if (delay === 0) {
      this._openPanel();
    } else {
      this._timer = setTimeout(() => {
        this._timer = null;
        this._openPanel();
      }, delay);
    }
  };

  // Sticky mode: releasing Ctrl doesn't auto-switch; awaits Enter, Click, or Esc
  const originalHandleEvent = native.handleEvent;
  native.handleEvent = function (event) {
    if (
      event.type === 'keyup' &&
      event.keyCode === event.DOM_VK_CONTROL &&
      pref('open-mode', 0) === 1 &&
      this.isOpen
    ) {
      event.preventDefault();
      event.stopPropagation();
      document.removeEventListener('keyup', this, { mozSystemGroup: true });
      return undefined;
    }
    return originalHandleEvent.call(this, event);
  };

  // Keyboard navigation within the strip
  const move = (step, wrap = true) => {
    const items = native.previews.filter(
      (p) => !p.hidden && p !== native.showAllButton && p.style.display !== 'none'
    );
    const currentIndex = items.indexOf(document.activeElement);
    if (currentIndex < 0) return;

    const nextIndex = wrap
      ? (currentIndex + step + items.length) % items.length
      : Math.min(items.length - 1, Math.max(0, currentIndex + step));

    try {
      items[nextIndex].focus({ preventScroll: true });
    } catch {
      items[nextIndex].focus();
    }
    if (items[nextIndex]._tab && window.gBrowser?.warmupTab) {
      window.gBrowser.warmupTab(items[nextIndex]._tab);
    }
  };

  panel.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      move(1, true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1, true);
    } else if (e.key === ' ' || e.code === 'Space') {
      if (pref('search-enabled', true)) {
        e.preventDefault();
        e.stopPropagation();
        openSearch();
      }
    }
  });

  // Fluid Tab repeat throttling (18 tabs per second) so holding Tab cycles smoothly without stutter
  let lastStep = 0;
  window.addEventListener('keydown', (e) => {
    if (!prefs.getBoolPref('browser.ctrlTab.sortByRecentlyUsed', false)) return;
    if (window.ShortcutUtils?.getSystemActionForEvent(e) !== window.ShortcutUtils?.CYCLE_TABS) return;

    const rate = 18;
    if (e.repeat && rate && e.timeStamp - lastStep < 1000 / rate) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    lastStep = e.timeStamp;

    const popup = e.target?.closest?.('panel, menupopup, [popover]');
    if (popup && popup !== panel) {
      native.onKeyDown(e);
    }
  }, true);

  // Position and open centered in the browser window
  const root = document.documentElement;
  native._openPanel = function () {
    tabPreviewPanelHelper.opening(this);
    const { totalWidth, totalHeight } = updateLayoutMetrics();

    const w = window.innerWidth;
    const h = window.innerHeight;

    // Pre-calculate exact center coordinates so it appears centered immediately
    const startX = Math.max(0, Math.round((w - totalWidth) / 2));
    const startY = Math.max(0, Math.round((h - totalHeight) / 2));

    panel._lastStartX = startX;
    panel._lastStartY = startY;

    syncBackdrop(totalWidth, totalHeight);
    panel.openPopup(root, 'overlap', startX, startY);
  };

  // Re-center on popupshown only if discrepancy > 4px to avoid Wayland xdg_popup reposition loops
  panel.addEventListener('popupshown', (e) => {
    if (e.target !== panel) return;
    const curW = (card && card.offsetWidth) || panel.clientWidth || (panel.getBoundingClientRect?.().width) || 0;
    const curH = (card && card.offsetHeight) || panel.clientHeight || (panel.getBoundingClientRect?.().height) || 0;
    const exactX = Math.round((window.innerWidth - curW) / 2);
    const exactY = Math.round((window.innerHeight - curH) / 2);

    const prevX = panel._lastStartX ?? exactX;
    const prevY = panel._lastStartY ?? exactY;
    if (Math.abs(exactX - prevX) > 4 || Math.abs(exactY - prevY) > 4) {
      panel.moveToAnchor(root, 'overlap', exactX, exactY);
      panel._lastStartX = exactX;
      panel._lastStartY = exactY;
    }
    syncBackdrop(curW, curH);
  });

  panel.addEventListener('popuphiding', hideBackdrop);
  panel.addEventListener('popuphidden', hideBackdrop);

  // =========================================================================
  // Spotlight Tab & Web Search (SpotTab) Module
  // Runs in browser chrome context, completely isolated from webpage CSS/extensions
  // =========================================================================

  const searchOverlay = el('div', 'heliarc-search-overlay');
  searchOverlay.id = 'heliarc-search-overlay';

  searchModal = el('div');
  searchModal.id = 'heliarc-search-modal';

  const searchHeader = el('div');
  searchHeader.id = 'heliarc-search-header';

  const searchIcon = el('img');
  searchIcon.id = 'heliarc-search-icon';
  searchIcon.src = 'chrome://global/skin/icons/search-glass.svg';

  const searchInput = el('input');
  searchInput.id = 'heliarc-search-input';
  searchInput.setAttribute('type', 'text');
  searchInput.setAttribute('placeholder', 'Buscar pestañas abiertas...');
  searchInput.setAttribute('spellcheck', 'false');
  searchInput.setAttribute('autocomplete', 'off');

  const searchBadge = el('span');
  searchBadge.id = 'heliarc-search-shortcut-badge';
  searchBadge.textContent = 'Esc para cerrar';

  const searchList = el('ul');
  searchList.id = 'heliarc-search-list';

  const searchEmpty = el('div');
  searchEmpty.id = 'heliarc-search-empty';
  searchEmpty.textContent = 'No se encontraron pestañas abiertas';
  searchEmpty.style.setProperty('display', 'none');

  searchHeader.append(searchIcon, searchInput, searchBadge);
  searchHeader.addEventListener('click', (e) => {
    if (e.target !== searchBadge) {
      try { searchInput.focus(); } catch {}
    }
  });
  searchModal.append(searchHeader, searchList, searchEmpty);
  searchOverlay.append(searchModal);

  const mainWindow = document.getElementById('main-window') || document.documentElement;
  if (mainWindow) {
    mainWindow.append(searchOverlay);
  }

  let searchIsOpen = false;
  let searchItems = [];
  let searchSelectedIndex = 0;

  const isEssentialTab = (tab) => {
    if (!tab) return false;
    return !!(
      tab.hasAttribute?.('zen-essential') ||
      tab.getAttribute?.('zen-essential') === 'true' ||
      tab.hasAttribute?.('zen-pin-essential') ||
      tab.hasAttribute?.('zen-essential-id') ||
      tab.classList?.contains?.('zen-essential-tab') ||
      tab.closest?.('#zen-essentials-container') ||
      tab.parentNode?.id === 'zen-essentials-container'
    );
  };

  const isPinnedTab = (tab) => {
    if (!tab) return false;
    if (isEssentialTab(tab)) return false;
    return !!(tab.pinned || tab.hasAttribute?.('pinned'));
  };

  // Resolve Zen Workspace name for a given tab
  const getTabWorkspaceName = (tab) => {
    if (!tab) return '';
    if (isEssentialTab(tab)) return 'Essential';
    const directName = tab.getAttribute?.('zen-workspace-name');
    if (directName) return directName;
    const wsId = tab.getAttribute?.('zen-workspace-id');
    if (!wsId) return '';
    try {
      if (window.gZenWorkspaces) {
        if (typeof window.gZenWorkspaces.getWorkspace === 'function') {
          const ws = window.gZenWorkspaces.getWorkspace(wsId);
          if (ws?.name) return ws.name;
        }
        if (Array.isArray(window.gZenWorkspaces.workspaces)) {
          const ws = window.gZenWorkspaces.workspaces.find((w) => w.id === wsId);
          if (ws?.name) return ws.name;
        }
      }
    } catch {}
    return '';
  };

  // Collect all currently open tabs from the window
  const collectOpenTabs = () => {
    const tabs = [];
    const currentWin = window;
    const currentTab = currentWin.gBrowser?.selectedTab;

    const rawTabs = currentWin.gBrowser?.tabs ? Array.from(currentWin.gBrowser.tabs) : [];
    for (const tab of rawTabs) {
      if (!tab || tab.closing || tab.isConnected === false) continue;
      if (isBlankTab(tab)) continue;

      const url = tab.linkedBrowser?.currentURI?.spec || tab.getAttribute?.('zen-url') || tab.getAttribute?.('url') || '';
      const title = tab.label || tab.getAttribute?.('label') || 'Nueva pestaña';
      const icon = tab.getAttribute?.('image') || tab.image || '';
      const isEssential = isEssentialTab(tab);
      const isPinned = isPinnedTab(tab);
      const wsName = getTabWorkspaceName(tab);
      const workspace = isEssential ? 'Essential' : wsName;
      const isCurrent = tab === currentTab;

      let badgeText = '';
      let badgeType = '';

      if (isEssential) {
        badgeText = 'Essential';
        badgeType = 'essential';
      } else if (isPinned) {
        badgeText = 'Pinned';
        badgeType = 'pinned';
      } else if (workspace) {
        badgeText = workspace;
        badgeType = 'workspace';
      } else if (isCurrent) {
        badgeText = 'Actual';
        badgeType = 'current';
      }

      tabs.push({
        type: 'tab',
        tab,
        title,
        url,
        icon,
        workspace,
        badgeText,
        badgeType,
        isEssential,
        isPinned,
        isCurrent,
        win: currentWin,
      });
    }
    return tabs;
  };

  const switchToTab = (item) => {
    if (!item?.tab) {
      closeSearch();
      return;
    }

    const tab = item.tab;
    const win = item.win || tab.ownerGlobal || window;

    closeSearch();

    try { win.focus?.(); } catch {}

    const isEssential = isEssentialTab(tab);

    // Only change workspace if NOT an essential tab and tab belongs to a DIFFERENT workspace
    if (!isEssential) {
      const tabWsId = tab.getAttribute?.('zen-workspace-id');
      const activeWs = win.gZenWorkspaces?.activeWorkspace;
      const currentWsId =
        (typeof activeWs === 'object' && activeWs?.id) ||
        (typeof activeWs === 'string' && activeWs) ||
        win.gZenWorkspaces?.activeWorkspaceId ||
        win.gZenWorkspaces?.currentWorkspaceId ||
        win.gBrowser?.selectedTab?.getAttribute?.('zen-workspace-id');

      if (tabWsId && currentWsId && tabWsId !== currentWsId && win.gZenWorkspaces) {
        if (typeof win.gZenWorkspaces.changeWorkspace === 'function') {
          try { win.gZenWorkspaces.changeWorkspace(tabWsId); } catch {}
        }
      }
    }

    if (win.gBrowser) {
      try {
        win.gBrowser.selectedTab = tab;
      } catch {}
      try {
        if (typeof win.gBrowser.warmupTab === 'function') {
          win.gBrowser.warmupTab(tab);
        }
      } catch {}
    }

    // Trigger native mousedown & click events so Zen's tab activation (especially essentials) runs
    try {
      if (typeof win.MouseEvent === 'function') {
        tab.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win, button: 0 }));
        tab.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win, button: 0 }));
      }
    } catch {}

    try {
      if (typeof tab.click === 'function') {
        tab.click();
      }
    } catch {}

    try {
      const browser = tab.linkedBrowser || win.gBrowser?.selectedBrowser;
      browser?.focus?.();
    } catch {}
  };

  const executeSearchItem = (item) => {
    if (!item) return;
    if (item.type === 'tab') {
      switchToTab(item);
    }
  };

  const updateSearchResults = (query) => {
    const trimmed = (query || '').trim().toLowerCase();
    const allOpenTabs = collectOpenTabs();
    const maxResults = pref('search-max-results', 8);
    const filtered = [];

    if (!trimmed) {
      const recentList = getBrowserRecentTabs();
      const seen = new Set();
      for (const t of recentList) {
        const match = allOpenTabs.find((item) => item.tab === t);
        if (match && !seen.has(match.tab)) {
          seen.add(match.tab);
          filtered.push(match);
        }
        if (filtered.length >= maxResults) break;
      }
      if (filtered.length < maxResults) {
        for (const item of allOpenTabs) {
          if (!seen.has(item.tab)) {
            seen.add(item.tab);
            filtered.push(item);
          }
          if (filtered.length >= maxResults) break;
        }
      }
    } else {
      for (const item of allOpenTabs) {
        const matchTitle = (item.title || '').toLowerCase().includes(trimmed);
        const matchUrl = (item.url || '').toLowerCase().includes(trimmed);
        const matchWs = (item.workspace || '').toLowerCase().includes(trimmed);
        const matchBadge = (item.badgeText || '').toLowerCase().includes(trimmed);
        const matchPinned = item.isPinned && ('pinned'.includes(trimmed) || 'fijada'.includes(trimmed) || 'fijadas'.includes(trimmed));
        const matchEssential = item.isEssential && ('essential'.includes(trimmed) || 'esencial'.includes(trimmed) || 'esenciales'.includes(trimmed));
        if (matchTitle || matchUrl || matchWs || matchBadge || matchPinned || matchEssential) {
          filtered.push(item);
        }
        if (filtered.length >= maxResults) break;
      }
    }

    searchItems = filtered.slice(0, maxResults);
    if (searchItems.length > 0) {
      if (!trimmed && searchItems.length > 1 && searchItems[0].isCurrent) {
        searchSelectedIndex = 1;
      } else {
        searchSelectedIndex = 0;
      }
    } else {
      searchSelectedIndex = -1;
    }

    renderSearchList();
  };

  const renderSearchList = () => {
    if (typeof searchList.replaceChildren === 'function') {
      searchList.replaceChildren();
    } else {
      while (searchList.firstChild) {
        searchList.removeChild(searchList.firstChild);
      }
    }

    if (searchItems.length === 0) {
      searchEmpty.style.removeProperty('display');
      return;
    }
    searchEmpty.style.setProperty('display', 'none');

    searchItems.forEach((item, index) => {
      const li = el('li', 'heliarc-search-item');
      if (index === searchSelectedIndex) {
        li.className = 'heliarc-search-item selected';
        li.setAttribute('selected', '');
      }

      // Icon
      const iconImg = el('img', 'heliarc-search-item-icon');
      iconImg.src = item.icon || 'chrome://global/skin/icons/defaultFavicon.svg';
      li.append(iconImg);

      // Content
      const content = el('div', 'heliarc-search-item-content');
      const titleSpan = el('span', 'heliarc-search-item-title');
      titleSpan.textContent = item.title;
      content.append(titleSpan);

      if (item.url) {
        const sepSpan = el('span', 'heliarc-search-item-sep');
        sepSpan.textContent = '—';
        const urlSpan = el('span', 'heliarc-search-item-url');
        urlSpan.textContent = item.url.replace(/^https?:\/\//, '');
        content.append(sepSpan, urlSpan);
      }
      li.append(content);

      // Badges
      if (item.isPinned && item.workspace && item.workspace !== 'Pinned' && item.workspace !== 'Essential') {
        const wsBadge = el('span', 'heliarc-search-badge workspace');
        wsBadge.textContent = item.workspace;
        li.append(wsBadge);
      }
      if (item.badgeText) {
        const badge = el('span', `heliarc-search-badge ${item.badgeType}`);
        badge.textContent = item.badgeText;
        li.append(badge);
      }

      li.addEventListener('click', () => {
        executeSearchItem(item);
      });

      searchList.append(li);
    });
  };

  const openSearch = () => {
    if (searchIsOpen) return;
    if (!pref('search-enabled', true)) return;

    if (panel && typeof panel.hidePopup === 'function') {
      try { panel.hidePopup(); } catch {}
    }

    searchIsOpen = true;
    searchOverlay.setAttribute('active', '');
    searchInput.value = '';
    updateSearchResults('');

    try {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        searchInput.setSelectionRange(0, 0);
      }
    } catch {}
  };

  const closeSearch = () => {
    if (!searchIsOpen) return;
    searchIsOpen = false;
    searchOverlay.removeAttribute('active');
    searchInput.value = '';
    try {
      if (window.gBrowser?.selectedBrowser) {
        window.gBrowser.selectedBrowser.focus();
      }
    } catch {}
  };

  const toggleSearch = () => {
    if (searchIsOpen) {
      closeSearch();
    } else {
      openSearch();
    }
  };

  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) {
      closeSearch();
    }
  });

  searchInput.addEventListener('input', () => {
    updateSearchResults(searchInput.value || '');
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchItems.length > 0) {
        searchSelectedIndex = (searchSelectedIndex + 1) % searchItems.length;
        renderSearchList();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchItems.length > 0) {
        searchSelectedIndex = (searchSelectedIndex - 1 + searchItems.length) % searchItems.length;
        renderSearchList();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const targetIndex = (searchSelectedIndex >= 0 && searchSelectedIndex < searchItems.length)
        ? searchSelectedIndex
        : (searchItems.length > 0 ? 0 : -1);
      if (targetIndex >= 0) {
        executeSearchItem(searchItems[targetIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
    }
  });

  const matchesSearchShortcut = (e) => {
    const configured = pref('search-shortcut', 'Ctrl+Space');
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;

    if (configured === 'Ctrl+Space') {
      return (e.code === 'Space' || e.key === ' ') && isCtrlOrMeta && !e.altKey && !e.shiftKey;
    }
    if (configured === 'Ctrl+Shift+A') {
      return (e.code === 'KeyA' || e.key === 'a' || e.key === 'A') && isCtrlOrMeta && e.shiftKey && !e.altKey;
    }
    if (configured === 'Alt+Space') {
      return (e.code === 'Space' || e.key === ' ') && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    }
    if (configured === 'Ctrl+Alt+T') {
      return (e.code === 'KeyT' || e.key === 't' || e.key === 'T') && isCtrlOrMeta && e.altKey && !e.shiftKey;
    }
    return (e.code === 'Space' || e.key === ' ') && isCtrlOrMeta && !e.altKey && !e.shiftKey;
  };

  window.addEventListener('keydown', (e) => {
    if (matchesSearchShortcut(e)) {
      if (!pref('search-enabled', true)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleSearch();
      return;
    }
    if (searchIsOpen && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
      return;
    }
  }, true);

  // Expose Spotlight Search API for tests and internal control
  window.__zenHeliarcSearch = {
    open: openSearch,
    close: closeSearch,
    toggle: toggleSearch,
    isOpen: () => searchIsOpen,
    getItems: () => searchItems,
    getSelectedIndex: () => searchSelectedIndex,
    setSelectedIndex: (idx) => {
      searchSelectedIndex = idx;
      renderSearchList();
    },
    updateQuery: (q) => {
      searchInput.value = q;
      updateSearchResults(q);
    },
    executeSelected: () => {
      if (searchSelectedIndex >= 0 && searchSelectedIndex < searchItems.length) {
        executeSearchItem(searchItems[searchSelectedIndex]);
      }
    },
    elements: {
      overlay: searchOverlay,
      modal: searchModal,
      input: searchInput,
      list: searchList,
      empty: searchEmpty,
    },
  };

  // Proactive background thumbnail capture:
  // Caches thumbnails while user is active on a tab so Ctrl+Tab opens instantaneously without IPC delays
  let proactiveCaptureTimer = null;
  const scheduleActiveTabCapture = (delay = 400) => {
    if (proactiveCaptureTimer) clearTimeout(proactiveCaptureTimer);
    proactiveCaptureTimer = setTimeout(() => {
      proactiveCaptureTimer = null;
      try {
        const activeTab = window.gBrowser?.selectedTab;
        if (activeTab) captureTabThumbnail(activeTab);
      } catch {}
    }, delay);
  };

  const onTabSelectListener = () => {
    scheduleActiveTabCapture(350);
  };

  if (window.gBrowser?.tabContainer?.addEventListener) {
    window.gBrowser.tabContainer.addEventListener('TabSelect', onTabSelectListener);
  }

  const onPageLoadListener = (e) => {
    try {
      if (e.target && e.target.defaultView === window.gBrowser?.selectedBrowser?.contentWindow) {
        scheduleActiveTabCapture(500);
      }
    } catch {}
  };
  window.addEventListener('pageshow', onPageLoadListener, true);

  const observer = { observe: apply };
  apply();
  prefs.addObserver(P, observer);
  window.addEventListener('unload', () => {
    prefs.removeObserver(P, observer);
    if (window.gBrowser?.tabContainer?.removeEventListener) {
      window.gBrowser.tabContainer.removeEventListener('TabSelect', onTabSelectListener);
    }
    window.removeEventListener('pageshow', onPageLoadListener, true);
    if (proactiveCaptureTimer) clearTimeout(proactiveCaptureTimer);
    hideBackdrop();
    backdrop?.remove();
    searchOverlay?.remove();
  }, { once: true });
})();
