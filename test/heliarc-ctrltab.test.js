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
  moveToAnchor(...args) { (this.moveToAnchorCalls ||= []).push(args); }
  focus(opts) {
    this.focusOpts = opts;
    env.document.activeElement = this;
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
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

  const mockBrowser = {
    warmupTab() {},
    tabs: customTabs,
    selectedTab: customTabs[0] || null,
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
    MouseEvent: globalThis.MouseEvent || function (t) { this.type = t; },
  };

  const ShortcutUtils = {
    CYCLE_TABS: 'cycle',
    getSystemActionForEvent: (e) => e.action,
  };

  env = { document: doc };

  new Function(
    'window',
    'document',
    'Services',
    'ctrlTab',
    'screen',
    'gBrowser',
    'ShortcutUtils',
    code
  )(win, doc, Services, native, {}, mockBrowser, ShortcutUtils);

  return { store, panel, list, showAll, native, win, calls, made, gBrowser: mockBrowser, doc };
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

test('tabList reads the browser\'s registered order of visited tabs from _recentlyUsedTabs without altering it', () => {
  const { native } = load();
  const tab1 = { linkedPanel: 'p1', isConnected: true, label: 'Tab 1' };
  const tab2 = { linkedPanel: 'p2', isConnected: true, label: 'Tab 2' };
  const tab3 = { linkedPanel: 'p3', isConnected: true, label: 'Tab 3' };

  native._recentlyUsedTabs = [tab2, tab3, tab1];

  const list = native.tabList;
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0], tab2);
  assert.strictEqual(list[1], tab3);
  assert.strictEqual(list[2], tab1);

  // Assert native._recentlyUsedTabs was not mutated or reordered
  assert.strictEqual(native._recentlyUsedTabs[0], tab2);
  assert.strictEqual(native._recentlyUsedTabs[1], tab3);
  assert.strictEqual(native._recentlyUsedTabs[2], tab1);
});

test('native.attachTab and native.detachTab are left untouched to let the browser manage visit history', () => {
  const { native } = load();
  const customAttach = () => {};
  const customDetach = () => {};
  native.attachTab = customAttach;
  native.detachTab = customDetach;

  // Verify the script does not overwrite the browser's native methods
  assert.strictEqual(native.attachTab, customAttach);
  assert.strictEqual(native.detachTab, customDetach);
});

test('native.open does not mutate or alter the browser\'s registered _recentlyUsedTabs array', () => {
  const tab1 = { linkedPanel: 'p1', label: 'Tab 1' };
  const tab2 = { linkedPanel: 'p2', label: 'Tab 2' };
  const tab3 = { linkedPanel: 'p3', label: 'Tab 3' };
  const { native } = load({}, [tab1, tab2, tab3]);

  // Suppose user visited tab 3, then tab 1
  native._recentlyUsedTabs = [tab1, tab3];

  native.open();

  // The array must NOT be mutated or overwritten with [tab1, tab2, tab3]
  assert.strictEqual(native._recentlyUsedTabs.length, 2);
  assert.strictEqual(native._recentlyUsedTabs[0], tab1);
  assert.strictEqual(native._recentlyUsedTabs[1], tab3);
});

test('reflects show-unloaded into Zen Browser native preference without altering tabList', () => {
  const { store, native } = load({ 'zen-heliarc-ctrltab.show-unloaded': true });
  assert.strictEqual(store['zen.ctrlTab.show-pending-tabs'], true);

  const activeTab = { linkedPanel: 'p1', isConnected: true, label: 'Active Tab' };
  const pendingTab = { linkedPanel: 'p2', isConnected: true, hasAttribute: (a) => a === 'pending' };

  native._recentlyUsedTabs = [activeTab, pendingTab];

  const list = native.tabList;
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0], activeTab);
  assert.strictEqual(list[1], pendingTab);
});

test('Spotlight Tab Search initializes API and attaches overlay to document', () => {
  const { win, doc } = load();
  assert.ok(win.__zenHeliarcSearch);
  assert.strictEqual(typeof win.__zenHeliarcSearch.open, 'function');
  assert.strictEqual(typeof win.__zenHeliarcSearch.close, 'function');
  assert.strictEqual(typeof win.__zenHeliarcSearch.toggle, 'function');
  assert.strictEqual(win.__zenHeliarcSearch.isOpen(), false);

  const overlay = win.__zenHeliarcSearch.elements.overlay;
  assert.ok(overlay);
  assert.strictEqual(overlay.id, 'heliarc-search-overlay');
});

test('Spotlight Tab Search opens, marks overlay active, and lists open tabs', () => {
  const tab1 = { label: 'GitHub - Repository', linkedPanel: 'p1', isConnected: true, getAttribute: () => null };
  const tab2 = { label: 'YouTube - Video', linkedPanel: 'p2', isConnected: true, getAttribute: () => null };

  const { win } = load({}, [tab1, tab2]);
  const search = win.__zenHeliarcSearch;

  search.open();
  assert.strictEqual(search.isOpen(), true);
  assert.ok(search.elements.overlay.hasAttribute('active'));

  const items = search.getItems();
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].title, 'GitHub - Repository');
  assert.strictEqual(items[1].title, 'YouTube - Video');

  search.close();
  assert.strictEqual(search.isOpen(), false);
  assert.strictEqual(search.elements.overlay.hasAttribute('active'), false);
});

test('Spotlight Tab Search filters tabs by title and workspace', () => {
  const tab1 = {
    label: 'GitHub PR Review',
    linkedPanel: 'p1',
    isConnected: true,
    getAttribute: (attr) => (attr === 'zen-workspace-name' ? 'Development' : null),
  };
  const tab2 = {
    label: 'Figma Dashboard',
    linkedPanel: 'p2',
    isConnected: true,
    getAttribute: (attr) => (attr === 'zen-workspace-name' ? 'Design' : null),
  };

  const { win } = load({}, [tab1, tab2]);
  const search = win.__zenHeliarcSearch;

  search.open();
  search.updateQuery('figma');

  const items = search.getItems();
  assert.strictEqual(items[0].title, 'Figma Dashboard');
  assert.strictEqual(items[0].workspace, 'Design');

  search.updateQuery('Development');
  const itemsDev = search.getItems();
  assert.strictEqual(itemsDev[0].title, 'GitHub PR Review');
});

test('Spotlight Tab Search only searches open tabs and does not offer web or url search', () => {
  const { win } = load({}, []);
  const search = win.__zenHeliarcSearch;

  search.open();
  search.updateQuery('google.com');

  const items = search.getItems();
  assert.strictEqual(items.length, 0);
  assert.strictEqual(search.elements.empty.style.vars['display'], undefined);

  const hasFooter = search.elements.modal.children.some((c) => c.id === 'heliarc-search-footer');
  assert.strictEqual(hasFooter, false);
});


test('Spotlight Tab Search switches selected tab on execution and closes modal', () => {
  const tab1 = { label: 'Tab 1', linkedPanel: 'p1', isConnected: true, getAttribute: () => null };
  const tab2 = { label: 'Tab 2', linkedPanel: 'p2', isConnected: true, getAttribute: () => null };

  const { win, gBrowser } = load({}, [tab1, tab2]);
  const search = win.__zenHeliarcSearch;

  search.open();
  search.setSelectedIndex(1);
  search.executeSelected();

  assert.strictEqual(search.isOpen(), false);
  assert.strictEqual(gBrowser.selectedTab, tab2);
});

test('Spotlight Tab Search only calls changeWorkspace when tab belongs to different workspace', () => {
  const wsChanged = [];
  const tab1 = {
    label: 'Tab 1',
    linkedPanel: 'p1',
    isConnected: true,
    getAttribute: (attr) => (attr === 'zen-workspace-id' ? 'ws-A' : null),
  };
  const tab2 = {
    label: 'Tab 2',
    linkedPanel: 'p2',
    isConnected: true,
    getAttribute: (attr) => (attr === 'zen-workspace-id' ? 'ws-B' : null),
  };

  const { win, gBrowser } = load({}, [tab1, tab2]);
  win.gZenWorkspaces = {
    activeWorkspace: { id: 'ws-A' },
    changeWorkspace(id) { wsChanged.push(id); },
  };

  const search = win.__zenHeliarcSearch;

  // Switching to tab1 (same workspace 'ws-A'): changeWorkspace should NOT be called
  search.open();
  search.setSelectedIndex(0);
  search.executeSelected();
  assert.strictEqual(wsChanged.length, 0);
  assert.strictEqual(gBrowser.selectedTab, tab1);

  // Switching to tab2 (different workspace 'ws-B'): changeWorkspace should be called with 'ws-B'
  search.open();
  search.setSelectedIndex(1);
  search.executeSelected();
  assert.strictEqual(wsChanged.length, 1);
  assert.strictEqual(wsChanged[0], 'ws-B');
  assert.strictEqual(gBrowser.selectedTab, tab2);
});

test('Spotlight Tab Search never changes workspace for essential tabs and activates them properly', () => {
  const wsChanged = [];
  const eventsDispatched = [];
  const essentialTab = {
    label: 'WhatsApp Essential',
    linkedPanel: 'p-ess',
    isConnected: true,
    hasAttribute: (a) => a === 'zen-essential',
    getAttribute: (a) => (a === 'zen-essential' ? 'true' : a === 'zen-workspace-id' ? 'ws-B' : null),
    dispatchEvent(ev) { eventsDispatched.push(ev.type); },
  };

  const { win, gBrowser } = load({}, [essentialTab]);
  win.gZenWorkspaces = {
    activeWorkspace: { id: 'ws-A' },
    changeWorkspace(id) { wsChanged.push(id); },
  };

  const search = win.__zenHeliarcSearch;
  search.open();
  search.setSelectedIndex(0);
  search.executeSelected();

  // Must not touch workspace despite tab having 'ws-B'
  assert.strictEqual(wsChanged.length, 0);
  assert.strictEqual(gBrowser.selectedTab, essentialTab);
  assert.ok(eventsDispatched.includes('mousedown'));
});

test('Spotlight Tab Search toggles via Ctrl+Space shortcut keydown and closes on Escape', () => {
  const { win } = load();
  const search = win.__zenHeliarcSearch;

  const keydownListeners = win.listeners['keydown'] || [];
  assert.ok(keydownListeners.length > 0);

  // Trigger Ctrl+Space shortcut
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
  assert.strictEqual(search.isOpen(), true);

  // Trigger Escape
  const escEvent = {
    key: 'Escape',
    preventDefault() {},
    stopPropagation() {},
  };
  for (const listener of keydownListeners) {
    listener(escEvent);
  }
  assert.strictEqual(search.isOpen(), false);
});

test('pressing Space inside Ctrl+Tab panel opens Spotlight Search', () => {
  const { win, panel } = load();
  const search = win.__zenHeliarcSearch;

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
  assert.strictEqual(search.isOpen(), true);
});

test('Spotlight Tab Search excludes blank and empty New Tab pages (about:blank, about:newtab, zen-empty-tab)', () => {
  const blankTab1 = {
    label: 'New Tab',
    linkedPanel: 'p-blank1',
    isConnected: true,
    linkedBrowser: { currentURI: { spec: 'about:blank' } },
    getAttribute: () => null,
  };
  const blankTab2 = {
    label: 'Nueva pestaña',
    linkedPanel: 'p-blank2',
    isConnected: true,
    hasAttribute: (a) => a === 'zen-empty-tab',
    getAttribute: () => null,
  };
  const validTab = {
    label: 'WhatsApp',
    linkedPanel: 'p-valid',
    isConnected: true,
    linkedBrowser: { currentURI: { spec: 'https://web.whatsapp.com/' } },
    getAttribute: () => null,
  };

  const { win } = load({}, [blankTab1, validTab, blankTab2]);
  const search = win.__zenHeliarcSearch;

  search.open();
  const items = search.getItems();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, 'WhatsApp');

  // Verify that even searching specifically for "New Tab" or "about:blank" yields 0 results
  search.updateQuery('New Tab');
  assert.strictEqual(search.getItems().length, 0);

  search.updateQuery('about:blank');
  assert.strictEqual(search.getItems().length, 0);
});

test('Spotlight Tab Search distinguishes between Essential tabs and Pinned tabs with distinct badges', () => {
  const essentialTab = {
    label: 'WhatsApp',
    linkedPanel: 'p-ess',
    isConnected: true,
    pinned: true,
    hasAttribute: (a) => a === 'zen-essential',
    getAttribute: (a) => (a === 'zen-essential' ? 'true' : null),
  };
  const pinnedTab = {
    label: 'Cuentos de Andrómeda',
    linkedPanel: 'p-pin',
    isConnected: true,
    pinned: true,
    hasAttribute: (a) => a === 'pinned',
    getAttribute: (a) => (a === 'zen-workspace-name' ? 'Lecturas' : null),
  };
  const pinnedTabNoWs = {
    label: 'Libro de Cuentas',
    linkedPanel: 'p-pin2',
    isConnected: true,
    pinned: true,
    hasAttribute: (a) => a === 'pinned',
    getAttribute: () => null,
  };
  const normalTab = {
    label: 'Figma Dashboard',
    linkedPanel: 'p-norm',
    isConnected: true,
    pinned: false,
    hasAttribute: () => false,
    getAttribute: (a) => (a === 'zen-workspace-name' ? 'Diseño' : null),
  };

  const { win } = load({}, [essentialTab, pinnedTab, pinnedTabNoWs, normalTab]);
  const search = win.__zenHeliarcSearch;

  search.open();
  const items = search.getItems();
  assert.strictEqual(items.length, 4);

  const essItem = items.find((i) => i.title === 'WhatsApp');
  assert.strictEqual(essItem.isEssential, true);
  assert.strictEqual(essItem.isPinned, false);
  assert.strictEqual(essItem.badgeText, 'Essential');
  assert.strictEqual(essItem.badgeType, 'essential');

  const pinItem = items.find((i) => i.title === 'Cuentos de Andrómeda');
  assert.strictEqual(pinItem.isEssential, false);
  assert.strictEqual(pinItem.isPinned, true);
  assert.strictEqual(pinItem.badgeText, 'Pinned');
  assert.strictEqual(pinItem.badgeType, 'pinned');
  assert.strictEqual(pinItem.workspace, 'Lecturas');

  const pinItemNoWs = items.find((i) => i.title === 'Libro de Cuentas');
  assert.strictEqual(pinItemNoWs.isEssential, false);
  assert.strictEqual(pinItemNoWs.isPinned, true);
  assert.strictEqual(pinItemNoWs.badgeText, 'Pinned');

  const normItem = items.find((i) => i.title === 'Figma Dashboard');
  assert.strictEqual(normItem.isEssential, false);
  assert.strictEqual(normItem.isPinned, false);
  assert.strictEqual(normItem.badgeText, 'Diseño');
  assert.strictEqual(normItem.badgeType, 'workspace');
});

test('Spotlight Tab Search switches workspace for Pinned tabs belonging to other workspaces', () => {
  const wsChanged = [];
  const pinnedTabOtherWs = {
    label: 'Pinned in Workspace B',
    linkedPanel: 'p-pin-b',
    isConnected: true,
    pinned: true,
    hasAttribute: (a) => a === 'pinned',
    getAttribute: (a) => (a === 'zen-workspace-id' ? 'ws-B' : null),
  };

  const { win, gBrowser } = load({}, [pinnedTabOtherWs]);
  win.gZenWorkspaces = {
    activeWorkspace: { id: 'ws-A' },
    changeWorkspace(id) { wsChanged.push(id); },
  };

  const search = win.__zenHeliarcSearch;
  search.open();
  search.setSelectedIndex(0);
  search.executeSelected();

  assert.strictEqual(wsChanged.length, 1);
  assert.strictEqual(wsChanged[0], 'ws-B');
  assert.strictEqual(gBrowser.selectedTab, pinnedTabOtherWs);
});

test('Spotlight Tab Search query matches "pinned" and "fijada" for pinned tabs and "essential" / "esencial" for essentials', () => {
  const essentialTab = {
    label: 'WhatsApp',
    linkedPanel: 'p-ess',
    isConnected: true,
    hasAttribute: (a) => a === 'zen-essential',
    getAttribute: (a) => (a === 'zen-essential' ? 'true' : null),
  };
  const pinnedTab = {
    label: 'Cuentos de Andrómeda',
    linkedPanel: 'p-pin',
    isConnected: true,
    pinned: true,
    hasAttribute: (a) => a === 'pinned',
    getAttribute: () => null,
  };
  const normalTab = {
    label: 'Google Search',
    linkedPanel: 'p-norm',
    isConnected: true,
    pinned: false,
    getAttribute: () => null,
  };

  const { win } = load({}, [essentialTab, pinnedTab, normalTab]);
  const search = win.__zenHeliarcSearch;

  search.open();

  search.updateQuery('pinned');
  assert.strictEqual(search.getItems().length, 1);
  assert.strictEqual(search.getItems()[0].title, 'Cuentos de Andrómeda');

  search.updateQuery('fijada');
  assert.strictEqual(search.getItems().length, 1);
  assert.strictEqual(search.getItems()[0].title, 'Cuentos de Andrómeda');

  search.updateQuery('essential');
  assert.strictEqual(search.getItems().length, 1);
  assert.strictEqual(search.getItems()[0].title, 'WhatsApp');

  search.updateQuery('esencial');
  assert.strictEqual(search.getItems().length, 1);
  assert.strictEqual(search.getItems()[0].title, 'WhatsApp');
});

test('Ctrl+Tab switcher preserves browser recorded tab order even when tabs are newly created or blank', () => {
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
  // Browser recorded order: blankTab was visited/selected most recently
  native._recentlyUsedTabs = [blankTab, activeTab];

  // tabList reads the browser's registered order without altering it
  const list = native.tabList;
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0], blankTab);
  assert.strictEqual(list[1], activeTab);

  // updatePreview does not throw and renders preview when tab is present
  const preview = new El('button');
  native.updatePreview(preview, blankTab);
  assert.strictEqual(preview.hidden, false);
});

test('Spotlight Tab Search focuses input, resets caret at index 0, and header click focuses input', () => {
  const { win, doc } = load();
  const search = win.__zenHeliarcSearch;
  const input = search.elements.input;
  const header = search.elements.modal.children[0];

  search.open();
  assert.strictEqual(doc.activeElement, input);
  assert.strictEqual(input.selectionStart, 0);
  assert.strictEqual(input.selectionEnd, 0);

  // Blur input
  doc.activeElement = null;
  assert.notStrictEqual(doc.activeElement, input);

  // Click on header
  for (const listener of (header.listeners.click || [])) {
    listener({ target: header });
  }
  assert.strictEqual(doc.activeElement, input);
});

test('updatePreview manages has-thumbnail attribute when thumbnail is present vs missing', () => {
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

  // Tab without thumbnail
  const tabNoThumb = { isConnected: true, label: 'Tab without thumbnail' };
  native.updatePreview(preview, tabNoThumb);
  assert.strictEqual(preview.hasAttribute('has-thumbnail'), false);

  // Tab with in-memory thumbnail
  const tabWithThumb = { isConnected: true, label: 'Tab with thumbnail', __thumbnail: 'canvas-mock' };
  native.updatePreview(preview, tabWithThumb);
  assert.strictEqual(preview.hasAttribute('has-thumbnail'), true);

  // Clear preview
  native.updatePreview(preview, null);
  assert.strictEqual(preview.hasAttribute('has-thumbnail'), false);
});

test('tabPreviews.get fast path returns in-memory cached thumbnail immediately', async () => {
  const { win } = load();
  const cachedCanvas = { id: 'cached-canvas' };
  const tab = {
    isConnected: true,
    linkedBrowser: {
      currentURI: { spec: 'https://example.com' },
      browsingContext: {},
    },
    __thumbnail: cachedCanvas,
    __thumbnail_lastURI: 'https://example.com',
  };

  const res = await win.tabPreviews.get(tab);
  assert.strictEqual(res, cachedCanvas);
});

test('tabPreviews.get returns null immediately for unloaded tabs without waiting for disk thumbnail', async () => {
  const { win } = load();
  const unloadedTab = {
    isConnected: true,
    hasAttribute: (a) => a === 'pending',
    pending: true,
    linkedBrowser: {
      currentURI: { spec: 'https://unloaded.example.com' },
    },
  };

  const res = await win.tabPreviews.get(unloadedTab);
  assert.strictEqual(res, null);
});

test('popupshown avoids redundant moveToAnchor reposition on Wayland when popup coordinates match', () => {
  const { native, panel } = load();
  native.previews = [new El(), new El()];
  native._openPanel();

  assert.strictEqual(panel.opened, true);
  const card = panel.children.find((c) => c.id === 'heliarc-card');
  card.offsetWidth = 1200 - (panel._lastStartX * 2);
  card.offsetHeight = 800 - (panel._lastStartY * 2);
  const initialStartX = panel._lastStartX;
  const initialStartY = panel._lastStartY;

  // Trigger popupshown when dimensions match
  for (const listener of (panel.listeners.popupshown || [])) {
    listener({ target: panel });
  }

  // moveToAnchor should NOT be called because discrepancy <= 4px
  assert.strictEqual((panel.moveToAnchorCalls || []).length, 0);
  assert.strictEqual(panel._lastStartX, initialStartX);
  assert.strictEqual(panel._lastStartY, initialStartY);
});

test('keyboard navigation uses preventScroll to avoid layout thrashing and repeat throttle allows 18 tabs/sec', () => {
  const { native, panel, win } = load({ 'browser.ctrlTab.sortByRecentlyUsed': true });
  const tile0 = new El();
  const tile1 = new El();
  native.previews = [tile0, tile1];
  env.document.activeElement = tile0;

  // Trigger ArrowRight navigation
  panel.listeners.keydown[0]({ key: 'ArrowRight', preventDefault() {} });
  assert.strictEqual(env.document.activeElement, tile1);
  assert.deepStrictEqual(tile1.focusOpts, { preventScroll: true });

  // Test repeat throttling at 18 tabs/sec (1000/18 ~ 55.5ms)
  const keydownListener = win.listeners.keydown[0];
  let prevented = false;
  const evt1 = {
    action: 'cycle',
    repeat: true,
    timeStamp: 1000,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => {},
  };
  keydownListener(evt1);
  assert.strictEqual(prevented, false);

  // Less than 55ms later: should be throttled
  let prevented2 = false;
  const evt2 = {
    action: 'cycle',
    repeat: true,
    timeStamp: 1030,
    preventDefault: () => { prevented2 = true; },
    stopPropagation: () => {},
  };
  keydownListener(evt2);
  assert.strictEqual(prevented2, true);

  // 60ms later: should NOT be throttled
  let prevented3 = false;
  const evt3 = {
    action: 'cycle',
    repeat: true,
    timeStamp: 1065,
    preventDefault: () => { prevented3 = true; },
    stopPropagation: () => {},
  };
  keydownListener(evt3);
  assert.strictEqual(prevented3, false);
});

test('Spotlight Tab Search respects the browser\'s registered recent visit order when query is empty', () => {
  const tabA = { label: 'Doc A', linkedPanel: 'pA', isConnected: true, getAttribute: () => null };
  const tabB = { label: 'Doc B', linkedPanel: 'pB', isConnected: true, getAttribute: () => null };
  const tabC = { label: 'Doc C', linkedPanel: 'pC', isConnected: true, getAttribute: () => null };

  const { win, native } = load({}, [tabA, tabB, tabC]);
  // Browser recorded visit order: Tab C visited most recently, then Tab A, then Tab B
  native._recentlyUsedTabs = [tabC, tabA, tabB];

  const search = win.__zenHeliarcSearch;
  search.open();
  const items = search.getItems();

  assert.strictEqual(items.length, 3);
  assert.strictEqual(items[0].title, 'Doc C');
  assert.strictEqual(items[1].title, 'Doc A');
  assert.strictEqual(items[2].title, 'Doc B');
});









