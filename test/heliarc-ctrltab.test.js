// Runs the mod script against stubs of the browser window: `node --test test/`
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '../JS/heliarc-ctrltab.uc.js'), 'utf8');

class El {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.attrs = new Map();
    this.children = [];
    this.listeners = {};
    this.style = {
      vars: {},
      setProperty(k, v) { this.vars[k] = v; },
      removeProperty(k) { delete this.vars[k]; },
    };
  }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  toggleAttribute(k, on) { on ? this.attrs.set(k, '') : this.attrs.delete(k); }
  insertBefore(node, ref) {
    const idx = this.children.indexOf(ref);
    if (idx >= 0) this.children.splice(idx, 0, node);
    else this.children.push(node);
  }
  after(node) {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx >= 0) this.parent.children.splice(idx + 1, 0, node);
      node.parent = this.parent;
    }
  }
  append(...nodes) {
    for (const n of nodes) {
      n.parent = this;
      this.children.push(n);
    }
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  querySelector(selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return this.children.find((c) => (c.className || '').split(/\s+/).includes(cls)) || null;
    }
    return null;
  }
  querySelectorAll(selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return this.children.filter((c) => (c.className || '').split(/\s+/).includes(cls));
    }
    return [];
  }
  addEventListener(t, f) {
    (this.listeners[t] ||= []).push(f);
  }
  hidePopup() { this.hidden = true; }
  openPopup() { this.opened = true; }
  focus() { env.document.activeElement = this; }
  getBoundingClientRect() { return { width: 100, height: 100 }; }
}

let env;
function load(prefValues = {}, customTabs = []) {
  const store = { ...prefValues };
  const types = (v) => (typeof v === 'boolean' ? 128 : typeof v === 'number' ? 64 : typeof v === 'string' ? 32 : 0);
  const Services = {
    prefs: {
      PREF_BOOL: 128,
      PREF_INT: 64,
      PREF_STRING: 32,
      getPrefType: (k) => types(store[k]),
      getBoolPref: (k) => store[k],
      getIntPref: (k) => store[k],
      getStringPref: (k) => store[k],
      setBoolPref: (k, v) => { store[k] = v; },
      setIntPref: (k, v) => { store[k] = v; },
      addObserver() {},
      removeObserver() {},
    },
  };

  const panel = new El('panel');
  const list = new El('div');
  const showAll = new El('div');
  const made = [];

  const doc = {
    activeElement: null,
    listeners: [],
    removed: [],
    getElementById: (id) => {
      if (id === 'ctrlTab-panel') return panel;
      if (id === 'ctrlTab-previews') return list;
      if (id === 'ctrlTab-showAll-container') return showAll;
      return null;
    },
    documentElement: new El('html'),
    createElementNS: (ns, tag) => {
      const e = new El(tag);
      made.push(e);
      return e;
    },
    removeEventListener(t) { this.removed.push(t); },
  };

  const calls = [];
  const native = {
    previewsPerRow: 6,
    onKeyDown(e) { calls.push('onKeyDown'); },
    isOpen: true,
    previews: [],
    updatePreview() {},
    open() { this._timer = 7; },
    handleEvent(e) { calls.push(e.type); },
    detachTab(tab) {
      if (Array.isArray(this._recentlyUsedTabs)) {
        const i = this._recentlyUsedTabs.indexOf(tab);
        if (i >= 0) this._recentlyUsedTabs.splice(i, 1);
      }
    },
    attachTab(tab, pos) {
      if (!Array.isArray(this._recentlyUsedTabs)) return;
      this.detachTab(tab);
      if (pos === 0) this._recentlyUsedTabs.unshift(tab);
      else this._recentlyUsedTabs.push(tab);
    },
  };

  const mockURLBar = {
    focused: false,
    searchMode: null,
    query: '',
    view: {
      isOpen: false,
      close() { this.isOpen = false; },
      open() { this.isOpen = true; },
    },
    focus() { this.focused = true; },
    blur() { this.focused = false; },
    handleRevert() {
      this.searchMode = null;
      this.query = '';
    },
    setSearchMode(mode, targetBrowser) {
      this.searchMode = mode;
      if (mode) this.view.isOpen = true;
      if (!mode) this.view.isOpen = false;
    },
    search(query) {
      this.query = query;
      this.focused = true;
      this.searchMode = { source: 4, entry: 'shortcut' };
      this.view.isOpen = true;
    },
  };

  const mockBrowser = {
    warmupTab() {},
    tabs: customTabs,
    selectedTab: customTabs[0] || null,
    selectedBrowser: {
      focus() { calls.push('browserFocused'); },
    },
    removeTab(t) {
      const idx = this.tabs.indexOf(t);
      if (idx >= 0) this.tabs.splice(idx, 1);
    },
  };

  const win = {
    tabPreviews: { aspectRatio: 0.625, get: () => Promise.resolve('thumb') },
    tabPreviewPanelHelper: { opening() { calls.push('opening'); } },
    innerWidth: 1200,
    innerHeight: 800,
    listeners: {},
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    gBrowser: mockBrowser,
    gURLBar: mockURLBar,
    UrlbarShared: {
      RESULT_SOURCE: {
        TABS: 4,
      },
    },
    MouseEvent: globalThis.MouseEvent || function (t) { this.type = t; },
  };

  const ShortcutUtils = {
    CYCLE_TABS: 'cycle',
    getSystemActionForEvent: (e) => e.action,
  };

  env = { document: doc };

  // Re-read file to pick up latest code changes in test runs
  const currentCode = fs.readFileSync(path.join(__dirname, '../JS/heliarc-ctrltab.uc.js'), 'utf8');

  new Function(
    'window',
    'document',
    'Services',
    'ctrlTab',
    'screen',
    'gBrowser',
    'ShortcutUtils',
    currentCode
  )(win, doc, Services, native, {}, mockBrowser, ShortcutUtils);

  return { store, panel, list, showAll, native, win, calls, made, gBrowser: mockBrowser, gURLBar: mockURLBar };
}

const ctrlUp = {
  type: 'keyup',
  keyCode: 17,
  DOM_VK_CONTROL: 17,
  preventDefault() {},
  stopPropagation() {},
};

test('reflects preferences into Firefox native switches and enforces single-row previewsPerRow', () => {
  const { store, native } = load({
    'zen-heliarc-ctrltab.max-tabs': 8,
    'zen-heliarc-ctrltab.show-unloaded': true,
  });

  assert.strictEqual(store['browser.ctrlTab.sortByRecentlyUsed'], true);
  assert.strictEqual(store['zen.ctrlTab.show-pending-tabs'], true);
  assert.strictEqual(store['browser.ctrlTab.maxPreviews'], 8);
  assert.strictEqual(native.previewsPerRow, 8);
});

test('constructs Heliarc HUD card and hides showAll container without unnecessary stage', () => {
  const { panel, showAll } = load();
  const card = panel.children.find((c) => c.id === 'heliarc-card');
  assert.ok(card, 'Card should exist directly inside panel');
  assert.strictEqual(showAll.style.display, 'none');
});

test('hold mode: releasing Ctrl calls native handleEvent', () => {
  const { native, calls } = load();
  native.handleEvent(ctrlUp);
  assert.deepStrictEqual(calls, ['keyup']);
});

test('sticky mode: releasing Ctrl is intercepted and keyup listener removed', () => {
  const { native, calls } = load({ 'zen-heliarc-ctrltab.open-mode': 1 });
  native.handleEvent(ctrlUp);
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(env.document.removed, ['keyup']);
});

test('decorates preview with floating Title Pill and fallback icon', () => {
  const { native } = load();
  const preview = new El('button');
  const inner = new El('div');
  inner.className = 'ctrlTab-preview-inner';

  const fav = new El('div');
  fav.className = 'ctrlTab-favicon-container';
  const label = new El('label');
  label.className = 'ctrlTab-label';

  inner.append(fav, label);
  preview.append(inner);

  native.updatePreview(preview, { hasAttribute: (a) => a === 'pending', image: 'icon.png' });

  assert.ok(preview.hasAttribute('heliarc-unloaded'));
  const pill = inner.children.find((c) => c.className === 'heliarc-title-pill');
  assert.ok(pill, 'Title pill should be constructed');
  const fallback = inner.children.find((c) => c.className === 'heliarc-fallback');
  assert.ok(fallback, 'Fallback should be constructed');
});

test('arrow keys navigate left and right through the single-row cards with wrap', () => {
  const { native, panel } = load();
  const tiles = [new El(), new El(), new El()];
  native.previews = tiles;
  env.document.activeElement = tiles[0];

  const keyEvent = (key) => {
    panel.listeners.keydown[0]({ key, preventDefault() {} });
  };

  keyEvent('ArrowRight');
  assert.strictEqual(env.document.activeElement, tiles[1]);

  keyEvent('ArrowRight');
  assert.strictEqual(env.document.activeElement, tiles[2]);

  keyEvent('ArrowRight'); // wraps back to 0
  assert.strictEqual(env.document.activeElement, tiles[0]);

  keyEvent('ArrowLeft'); // wraps back to 2
  assert.strictEqual(env.document.activeElement, tiles[2]);
});

test('in-window gaussian blur backdrop lifecycle: attaches to documentElement and activates on open', () => {
  const { native, panel } = load();
  const backdrop = env.document.documentElement.children.find((c) => c.id === 'heliarc-backdrop');
  assert.ok(backdrop, 'Backdrop element should be attached to documentElement');
  assert.strictEqual(backdrop.hasAttribute('active'), false);

  // Simulate _openPanel execution
  native._openPanel();
  assert.strictEqual(backdrop.hasAttribute('active'), true);
  assert.ok(parseInt(backdrop.style.width, 10) > 0, 'Backdrop width should be calculated');
  assert.ok(parseInt(backdrop.style.height, 10) > 0, 'Backdrop height should be calculated');

  // Trigger popuphiding event
  for (const listener of (panel.listeners.popuphiding || [])) {
    listener();
  }
  assert.strictEqual(backdrop.hasAttribute('active'), false);
});

test('updatePreview with null/falsy tab: hides preview, resets unloaded attribute, and clears fallback icon', () => {
  const { native } = load();
  const preview = new El('button');
  const inner = new El('div');
  inner.className = 'ctrlTab-preview-inner';

  const fav = new El('div');
  fav.className = 'ctrlTab-favicon-container';
  const label = new El('label');
  label.className = 'ctrlTab-label';
  inner.append(fav, label);
  preview.append(inner);

  // First populate with an unloaded/pending tab
  native.updatePreview(preview, { hasAttribute: (a) => a === 'pending', image: 'icon.png' });
  assert.strictEqual(preview.hidden, false);
  assert.ok(preview.hasAttribute('heliarc-unloaded'));

  // Now call updatePreview with null tab
  native.updatePreview(preview, null);
  assert.strictEqual(preview.hidden, true);
  assert.strictEqual(preview.style.display, 'none');
  assert.strictEqual(preview.hasAttribute('heliarc-unloaded'), false);

  const fallback = inner.children.find((c) => c.className === 'heliarc-fallback');
  const icon = fallback?.children?.find((c) => c.className === 'heliarc-fallback-icon');
  assert.strictEqual(icon?.getAttribute('src'), null);
});

test('tabList deduplicates tabs and filters out closing, disconnected, or hidden tabs', () => {
  const { native } = load();
  const tab1 = { linkedPanel: 'p1', isConnected: true, label: 'Tab 1' };
  const tab2 = { linkedPanel: 'p2', isConnected: true, label: 'Tab 2' };
  const tab2Dup = { linkedPanel: 'p2', isConnected: true, label: 'Tab 2 Duplicate' };
  const tabClosing = { linkedPanel: 'p3', closing: true, isConnected: true };
  const tabDisconnected = { linkedPanel: 'p4', isConnected: false };
  const tabHidden = { linkedPanel: 'p5', hidden: true, selected: false, isConnected: true };

  native._recentlyUsedTabs = [tab1, tab2, tab2, tab2Dup, tabClosing, tabDisconnected, tabHidden, tab1];

  const list = native.tabList;
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0], tab1);
  assert.strictEqual(list[1], tab2);
});

test('detachTab removes all duplicate occurrences of matching tab from _recentlyUsedTabs', () => {
  const { native } = load();
  const tabA = { linkedPanel: 'pA' };
  const tabB = { linkedPanel: 'pB' };
  native._recentlyUsedTabs = [tabA, tabB, tabA];

  native.detachTab(tabA);
  assert.strictEqual(native._recentlyUsedTabs.length, 1);
  assert.strictEqual(native._recentlyUsedTabs[0], tabB);
});

test('default show-unloaded is false and excludes pending, discarded, and zen-unloaded tabs', () => {
  const { store, native } = load();
  assert.strictEqual(store['zen.ctrlTab.show-pending-tabs'], false);

  const activeTab = { linkedPanel: 'p1', isConnected: true, label: 'Active Tab' };
  const pendingTab = { linkedPanel: 'p2', isConnected: true, hasAttribute: (a) => a === 'pending' };
  const discardedAttrTab = { linkedPanel: 'p3', isConnected: true, hasAttribute: (a) => a === 'discarded' };
  const zenUnloadedTab = { linkedPanel: 'p4', isConnected: true, hasAttribute: (a) => a === 'zen-unloaded' };
  const discardedPropTab = { linkedPanel: 'p5', isConnected: true, discarded: true };

  native._recentlyUsedTabs = [activeTab, pendingTab, discardedAttrTab, zenUnloadedTab, discardedPropTab];

  const list = native.tabList;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0], activeTab);
});

test('when show-unloaded is enabled, unloaded tabs are included in tabList', () => {
  const { native } = load({ 'zen-heliarc-ctrltab.show-unloaded': true });
  const activeTab = { linkedPanel: 'p1', isConnected: true, label: 'Active Tab' };
  const pendingTab = { linkedPanel: 'p2', isConnected: true, hasAttribute: (a) => a === 'pending' };

  native._recentlyUsedTabs = [activeTab, pendingTab];

  const list = native.tabList;
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0], activeTab);
  assert.strictEqual(list[1], pendingTab);
});

test('Native Tab Search initializes API and exposes open, close, toggle, and isOpen', () => {
  const { win } = load();
  assert.ok(win.__zenHeliarcSearch);
  assert.strictEqual(typeof win.__zenHeliarcSearch.open, 'function');
  assert.strictEqual(typeof win.__zenHeliarcSearch.close, 'function');
  assert.strictEqual(typeof win.__zenHeliarcSearch.toggle, 'function');
  assert.strictEqual(win.__zenHeliarcSearch.isOpen(), false);
});

test('Ctrl+Space shortcut triggers Native Tab Search in gURLBar with RESULT_SOURCE.TABS', () => {
  const { win, gURLBar } = load();

  const keydownListeners = win.listeners['keydown'] || [];
  assert.ok(keydownListeners.length > 0);

  const ctrlSpaceEvent = {
    code: 'Space',
    key: ' ',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
  };

  for (const listener of keydownListeners) {
    listener(ctrlSpaceEvent);
  }

  assert.strictEqual(gURLBar.focused, true);
  assert.ok(gURLBar.searchMode);
  assert.strictEqual(gURLBar.searchMode.source, 4);
  assert.strictEqual(gURLBar.view.isOpen, true);
  assert.strictEqual(win.__zenHeliarcSearch.isOpen(), true);
});

test('Toggle behavior: pressing Ctrl+Space again when gURLBar is active closes and blurs it', () => {
  const { win, gURLBar, calls } = load();

  const keydownListeners = win.listeners['keydown'] || [];
  const ctrlSpaceEvent = {
    code: 'Space',
    key: ' ',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
  };

  // First press: opens native search
  for (const listener of keydownListeners) {
    listener(ctrlSpaceEvent);
  }
  assert.strictEqual(gURLBar.focused, true);
  assert.strictEqual(gURLBar.view.isOpen, true);

  // Second press: toggles closed
  for (const listener of keydownListeners) {
    listener(ctrlSpaceEvent);
  }
  assert.strictEqual(gURLBar.focused, false);
  assert.strictEqual(gURLBar.searchMode, null);
  assert.strictEqual(gURLBar.view.isOpen, false);
  assert.ok(calls.includes('browserFocused'));
  assert.strictEqual(win.__zenHeliarcSearch.isOpen(), false);
});

test('Escape keydown cleanly closes Native Tab Search and restores focus to webpage', () => {
  const { win, gURLBar, calls } = load();

  const keydownListeners = win.listeners['keydown'] || [];
  const ctrlSpaceEvent = {
    code: 'Space',
    key: ' ',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
  };

  // Open native search
  for (const listener of keydownListeners) {
    listener(ctrlSpaceEvent);
  }
  assert.strictEqual(gURLBar.focused, true);

  // Escape key event
  let prevented = false;
  let stopped = false;
  const escEvent = {
    key: 'Escape',
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  };

  for (const listener of keydownListeners) {
    listener(escEvent);
  }

  assert.strictEqual(prevented, true);
  assert.strictEqual(stopped, true);
  assert.strictEqual(gURLBar.focused, false);
  assert.strictEqual(gURLBar.searchMode, null);
  assert.strictEqual(gURLBar.view.isOpen, false);
  assert.ok(calls.includes('browserFocused'));
  assert.strictEqual(win.__zenHeliarcSearch.isOpen(), false);
});

test('Pressing Space inside Ctrl+Tab panel closes panel and opens Native Tab Search', () => {
  const { panel, gURLBar } = load();

  const keydownListeners = panel.listeners['keydown'] || [];
  assert.ok(keydownListeners.length > 0);

  const spaceEvent = {
    key: ' ',
    code: 'Space',
    preventDefault() {},
    stopPropagation() {},
  };

  for (const listener of keydownListeners) {
    listener(spaceEvent);
  }

  assert.strictEqual(panel.hidden, true);
  assert.strictEqual(gURLBar.focused, true);
  assert.strictEqual(gURLBar.searchMode.source, 4);
  assert.strictEqual(gURLBar.view.isOpen, true);
});

test('When search-enabled preference is false, Ctrl+Space does not activate gURLBar', () => {
  const { win, gURLBar } = load({ 'zen-heliarc-ctrltab.search-enabled': false });

  const keydownListeners = win.listeners['keydown'] || [];
  const ctrlSpaceEvent = {
    code: 'Space',
    key: ' ',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
  };

  for (const listener of keydownListeners) {
    listener(ctrlSpaceEvent);
  }

  assert.strictEqual(gURLBar.focused, false);
  assert.strictEqual(gURLBar.searchMode, null);
  assert.strictEqual(gURLBar.view.isOpen, false);
});

test('Fallback to setSearchMode and startQuery if gURLBar.search is not available', () => {
  const { win, gURLBar } = load();
  delete gURLBar.search;

  win.__zenHeliarcSearch.open();
  assert.strictEqual(gURLBar.focused, true);
  assert.strictEqual(gURLBar.searchMode.source, 4);
  assert.strictEqual(gURLBar.view.isOpen, true);
});

test('Ctrl+Tab switcher ignores blank and empty New Tab pages in tabList, attachTab, and updatePreview', () => {
  const blankTab = {
    label: 'New Tab',
    linkedPanel: 'p-blank',
    isConnected: true,
    linkedBrowser: { currentURI: { spec: 'about:blank' } },
  };
  const activeTab = {
    label: 'Active Web Tab',
    linkedPanel: 'p-active',
    isConnected: true,
    linkedBrowser: { currentURI: { spec: 'https://example.com' } },
  };

  const { native } = load({}, [activeTab, blankTab]);
  native._recentlyUsedTabs = [blankTab, activeTab];

  // tabList should only contain the active web tab, excluding blankTab
  const list = native.tabList;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0], activeTab);

  // attachTab should reject blankTab
  native.attachTab(blankTab, 0);
  assert.strictEqual(native._recentlyUsedTabs.includes(blankTab), false);

  // updatePreview should hide preview for blankTab
  const preview = new El('button');
  native.updatePreview(preview, blankTab);
  assert.strictEqual(preview.hidden, true);
  assert.strictEqual(preview.style.display, 'none');
});






