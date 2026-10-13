// ==UserScript==
// @name           Heliarc Ctrl+Tab & Spotlight Search
// @description    Arc-style single-row tab switcher with live previews and floating Spotlight tab & web search bar (SpotTab) for Zen Browser.
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

  // Always fetch full thumbnails for all cards in the strip
  const getThumb = tabPreviews.get.bind(tabPreviews);
  tabPreviews.get = (tab) => getThumb(tab);

  // Strictly deduplicate and sanitize tab list to prevent duplicate or zombie cards
  // (especially when tabs are hibernated/unloaded, in other workspaces, or closed)
  const getCleanTabList = () => {
    let rawList = [];
    if (Array.isArray(native._recentlyUsedTabs)) {
      rawList = native._recentlyUsedTabs;
    } else if (window.gBrowser?.tabs) {
      rawList = Array.from(window.gBrowser.tabs);
    }

    const showUnloaded = pref('show-unloaded', false);
    const seenTabs = new Set();
    const seenPanels = new Set();
    const cleanList = [];

    const addTab = (tab) => {
      if (!tab) return;
      if (tab.closing || tab.isConnected === false) return;
      if (tab.hidden && !tab.selected) return;
      if (!showUnloaded && isTabUnloaded(tab)) return;
      if (seenTabs.has(tab)) return;

      const panelId = tab.linkedPanel || tab.permanentKey;
      if (panelId && seenPanels.has(panelId)) return;

      seenTabs.add(tab);
      if (panelId) seenPanels.add(panelId);
      cleanList.push(tab);
    };

    for (const tab of rawList) {
      addTab(tab);
    }

    if (window.gBrowser?.tabs) {
      for (const tab of window.gBrowser.tabs) {
        addTab(tab);
      }
    }

    if (Array.isArray(native._recentlyUsedTabs)) {
      native._recentlyUsedTabs = cleanList.slice();
    }

    return cleanList;
  };

  try {
    Object.defineProperty(native, 'tabList', {
      get: getCleanTabList,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {
    console.error('Heliarc: Failed to define sanitized tabList getter', e);
  }

  // Ensure detachTab removes ALL occurrences of a tab (not just the first)
  if (typeof native.detachTab === 'function') {
    const originalDetachTab = native.detachTab;
    native.detachTab = function (tab) {
      if (Array.isArray(this._recentlyUsedTabs)) {
        this._recentlyUsedTabs = this._recentlyUsedTabs.filter(
          (t) => t !== tab && (!tab?.linkedPanel || t?.linkedPanel !== tab.linkedPanel)
        );
      } else {
        originalDetachTab.call(this, tab);
      }
    };
  }

  // Ensure attachTab deduplicates before inserting
  if (typeof native.attachTab === 'function') {
    const originalAttachTab = native.attachTab;
    native.attachTab = function (tab, pos) {
      if (!tab || tab.closing || (tab.hidden && !tab.selected)) return;
      if (!pref('show-unloaded', false) && isTabUnloaded(tab)) return;
      this.detachTab(tab);
      if (!Array.isArray(this._recentlyUsedTabs)) {
        originalAttachTab.call(this, tab, pos);
        return;
      }
      if (pos === 0) {
        this._recentlyUsedTabs.unshift(tab);
      } else if (typeof pos === 'number' && pos > 0) {
        this._recentlyUsedTabs.splice(pos, 0, tab);
      } else {
        this._recentlyUsedTabs.push(tab);
      }
    };
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
      const fallbackImg = preview.querySelector?.('.heliarc-fallback-icon');
      if (fallbackImg) fallbackImg.removeAttribute('src');
      originalUpdatePreview?.call(this, preview, tab);
      return;
    }

    preview.hidden = false;
    preview.style.removeProperty('display');
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
        if (tab.image) {
          fallbackImg.src = tab.image;
        } else {
          fallbackImg.removeAttribute('src');
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
    getCleanTabList();
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

    items[nextIndex].focus();
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

  // Smooth Tab repeat throttling (8 tabs per second) so holding Tab cycles predictably
  let lastStep = 0;
  window.addEventListener('keydown', (e) => {
    if (!prefs.getBoolPref('browser.ctrlTab.sortByRecentlyUsed', false)) return;
    if (window.ShortcutUtils?.getSystemActionForEvent(e) !== window.ShortcutUtils?.CYCLE_TABS) return;

    const rate = 8;
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

    syncBackdrop(totalWidth, totalHeight);
    panel.openPopup(root, 'overlap', startX, startY);
  };

  // Re-center on popupshown to guarantee sub-pixel center alignment across all screen scalings
  panel.addEventListener('popupshown', (e) => {
    if (e.target !== panel) return;
    const curW = (card && card.offsetWidth) || panel.clientWidth || (panel.getBoundingClientRect?.().width) || 0;
    const curH = (card && card.offsetHeight) || panel.clientHeight || (panel.getBoundingClientRect?.().height) || 0;
    const exactX = Math.round((window.innerWidth - curW) / 2);
    const exactY = Math.round((window.innerHeight - curH) / 2);
    panel.moveToAnchor(root, 'overlap', exactX, exactY);
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

  const searchIcon = el('div');
  searchIcon.id = 'heliarc-search-icon';
  searchIcon.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

  const searchInput = el('input');
  searchInput.id = 'heliarc-search-input';
  searchInput.setAttribute('type', 'text');
  searchInput.setAttribute('placeholder', 'Buscar pestañas abiertas, historial o en la web...');
  searchInput.setAttribute('spellcheck', 'false');
  searchInput.setAttribute('autocomplete', 'off');

  const searchBadge = el('span');
  searchBadge.id = 'heliarc-search-shortcut-badge';
  searchBadge.textContent = 'Esc para cerrar';

  const searchList = el('ul');
  searchList.id = 'heliarc-search-list';

  const searchEmpty = el('div');
  searchEmpty.id = 'heliarc-search-empty';
  searchEmpty.textContent = 'No se encontraron resultados';
  searchEmpty.style.setProperty('display', 'none');

  const searchFooter = el('div');
  searchFooter.id = 'heliarc-search-footer';
  searchFooter.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> Navegar</span><span><kbd>↵</kbd> Abrir</span><span><kbd>Del</kbd> Cerrar pestaña</span><span><kbd>Esc</kbd> Salir</span>';

  searchHeader.append(searchIcon, searchInput, searchBadge);
  searchModal.append(searchHeader, searchList, searchEmpty, searchFooter);
  searchOverlay.append(searchModal);

  const mainWindow = document.getElementById('main-window') || document.documentElement;
  if (mainWindow) {
    mainWindow.append(searchOverlay);
  }

  let searchIsOpen = false;
  let searchItems = [];
  let searchSelectedIndex = 0;

  // Resolve Zen Workspace name for a given tab
  const getTabWorkspaceName = (tab) => {
    if (!tab) return '';
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
      const url = tab.linkedBrowser?.currentURI?.spec || tab.getAttribute?.('zen-url') || tab.getAttribute?.('url') || '';
      const title = tab.label || tab.getAttribute?.('label') || 'Nueva pestaña';
      const icon = tab.getAttribute?.('image') || tab.image || '';
      const workspace = getTabWorkspaceName(tab);
      const isCurrent = tab === currentTab;

      tabs.push({
        type: 'tab',
        tab,
        title,
        url,
        icon,
        workspace,
        isCurrent,
        win: currentWin,
      });
    }
    return tabs;
  };

  const switchToTab = (item) => {
    closeSearch();
    if (!item?.tab) return;
    const win = item.win || item.tab.ownerGlobal || window;
    try { win.focus?.(); } catch {}
    const wsId = item.tab.getAttribute?.('zen-workspace-id');
    if (wsId && win.gZenWorkspaces && typeof win.gZenWorkspaces.changeWorkspace === 'function') {
      try { win.gZenWorkspaces.changeWorkspace(wsId); } catch {}
    }
    if (win.gBrowser) {
      win.gBrowser.selectedTab = item.tab;
    }
  };

  const closeSelectedTab = (item) => {
    if (!item?.tab) return;
    const win = item.win || item.tab.ownerGlobal || window;
    if (win.gBrowser && typeof win.gBrowser.removeTab === 'function') {
      win.gBrowser.removeTab(item.tab);
    }
    updateSearchResults(searchInput.value || '');
  };

  const openWebSearch = (query) => {
    closeSearch();
    const trimmed = (query || '').trim();
    if (!trimmed) return;
    try {
      if (window.BrowserSearch && typeof window.BrowserSearch.loadSearch === 'function') {
        window.BrowserSearch.loadSearch(trimmed, true);
        return;
      }
    } catch {}
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    if (typeof window.openTrustedLinkIn === 'function') {
      window.openTrustedLinkIn(searchUrl, 'tab');
    } else if (window.gBrowser) {
      window.gBrowser.addTab(searchUrl, { inBackground: false });
    }
  };

  const openUrl = (url) => {
    closeSearch();
    const fullUrl = /^[a-zA-Z]+:\/\//.test(url) ? url : `https://${url}`;
    if (typeof window.openTrustedLinkIn === 'function') {
      window.openTrustedLinkIn(fullUrl, 'tab');
    } else if (window.gBrowser) {
      window.gBrowser.addTab(fullUrl, { inBackground: false });
    }
  };

  const executeSearchItem = (item) => {
    if (!item) return;
    if (item.type === 'tab') {
      switchToTab(item);
    } else if (item.type === 'url') {
      openUrl(item.url);
    } else if (item.type === 'web') {
      openWebSearch(item.query || searchInput.value || '');
    }
  };

  const updateSearchResults = (query) => {
    const trimmed = (query || '').trim().toLowerCase();
    const allOpenTabs = collectOpenTabs();
    const maxResults = pref('search-max-results', 8);
    const allowWeb = pref('search-web-search', true);
    const filtered = [];

    if (!trimmed) {
      const recentList = getCleanTabList();
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
        if (matchTitle || matchUrl || matchWs) {
          filtered.push(item);
        }
        if (filtered.length >= maxResults) break;
      }

      const isUrl = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/.test(trimmed) || trimmed.startsWith('localhost');
      if (isUrl && allowWeb) {
        filtered.push({
          type: 'url',
          title: `Ir a https://${trimmed}`,
          url: trimmed,
        });
      }

      if (allowWeb) {
        filtered.push({
          type: 'web',
          title: `Buscar "${query.trim()}" en la web`,
          url: 'Motor de búsqueda predeterminado',
          query: query.trim(),
        });
      }
    }

    searchItems = filtered.slice(0, maxResults + 1);
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
      if (item.type === 'tab' && item.icon) {
        iconImg.src = item.icon;
      } else if (item.type === 'web') {
        iconImg.src = 'chrome://global/skin/icons/search-glass.svg';
      } else if (item.type === 'url') {
        iconImg.src = 'chrome://global/skin/icons/open-in-new.svg';
      } else {
        iconImg.src = 'chrome://global/skin/icons/defaultFavicon.svg';
      }
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
      if (item.type === 'tab') {
        if (item.workspace) {
          const badge = el('span', 'heliarc-search-badge workspace');
          badge.textContent = item.workspace;
          li.append(badge);
        } else if (item.isCurrent) {
          const badge = el('span', 'heliarc-search-badge current');
          badge.textContent = 'Actual';
          li.append(badge);
        }

        const closeBtn = el('button', 'heliarc-search-close-tab');
        closeBtn.setAttribute('title', 'Cerrar pestaña');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          closeSelectedTab(item);
        });
        li.append(closeBtn);
      } else if (item.type === 'web') {
        const badge = el('span', 'heliarc-search-badge web');
        badge.textContent = 'Web';
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

    setTimeout(() => {
      try { searchInput.focus(); } catch {}
    }, 20);
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
      if (searchSelectedIndex >= 0 && searchSelectedIndex < searchItems.length) {
        executeSearchItem(searchItems[searchSelectedIndex]);
      } else if (searchInput.value && searchInput.value.trim()) {
        openWebSearch(searchInput.value.trim());
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    } else if (e.key === 'Delete' || (e.ctrlKey && (e.key === 'w' || e.key === 'W'))) {
      if (searchSelectedIndex >= 0 && searchSelectedIndex < searchItems.length) {
        const item = searchItems[searchSelectedIndex];
        if (item && item.type === 'tab') {
          e.preventDefault();
          closeSelectedTab(item);
        }
      }
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

  const observer = { observe: apply };
  apply();
  prefs.addObserver(P, observer);
  window.addEventListener('unload', () => {
    prefs.removeObserver(P, observer);
    hideBackdrop();
    backdrop?.remove();
    searchOverlay?.remove();
  }, { once: true });
})();
