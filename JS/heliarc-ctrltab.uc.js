// ==UserScript==
// @name           Heliarc Ctrl+Tab
// @description    Arc-style single-row tab switcher with live previews and Liquid Glass HUD for Zen Browser.
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
    } else {
      panel.style.removeProperty('--heliarc-accent');
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

    const popup = e.target.closest?.('panel, menupopup, [popover]');
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

  const observer = { observe: apply };
  apply();
  prefs.addObserver(P, observer);
  window.addEventListener('unload', () => {
    prefs.removeObserver(P, observer);
    hideBackdrop();
    backdrop?.remove();
  }, { once: true });
})();
