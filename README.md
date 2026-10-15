# Better Tabs & Search for Zen Browser

An authentic **Arc Browser / Heliarc** tab switcher and **Spotlight command palette** mod for [Zen Browser](https://zen-browser.app).

- Holding `Ctrl+Tab` brings up a floating **Liquid Glass HUD** displaying a single horizontal strip of your most recent tabs with live screenshots and floating frosted title pills.
- Pressing `Ctrl+Space` (or Space while inside Ctrl+Tab) opens a centered **Spotlight Tab Search (SpotTab)** bar to search and jump to tabs across Zen Workspaces with backdrop glass blur.

---

## ✨ Features

- **Single-Row Arc Strip:** Clean, centered horizontal row of your most recently used (MRU) tabs.
- **Spotlight Tab Search (SpotTab):** Centered floating search modal running directly in Zen's chrome UI layer with Liquid Glass backdrop effect behind the modal—without blurring or darkening the rest of the web page.
- **Zen Workspaces Integration:** Filter and jump directly to tabs across any Zen Workspace. Shows workspace badges and switches workspace automatically.
- **Full-Bleed Visual Previews:** Live page screenshots scaled smoothly to fill each rounded preview card.
- **Floating Frosted Title Pills:** Glass capsule in the top-left corner of each card displaying the favicon and title with backdrop blur.
- **Luminous Focus Ring:** Continuous focus outline with an outer 3px gap, soft glow, and subtle scale effect matching your Zen theme's accent color (`--zen-primary-color`).
- **Liquid Glass HUD:** Translucent dark panel with high-saturation background blur (`backdrop-filter: blur(40px)`), refined border radii, and deep ambient drop shadow.
- **Graceful Fallbacks:** Tabs that are unloaded or pending display a frosted dark card with an enlarged central favicon and title pill.
- **Smooth Cycling:** Key-repeat throttled to 8 tabs per second so you never lose track of your selection while holding Tab. Arrow keys (`←` / `→`) navigate effortlessly.

---

## 🚀 Installation via Sine Marketplace

1. Open **Zen Settings** (`Ctrl + ,` or `Cmd + ,`).
2. Navigate to **Sine Mods** (or Sine Marketplace).
3. Paste this repository URL into the **Install from Link** field:
   ```text
   https://github.com/manuelcontrera/zen-heliarc-ctrltab
   ```
4. Click **Install** and restart Zen Browser once.

> [!NOTE]  
> If you have other mods that restyle `#ctrlTab-panel` (like *Better CtrlTab Panel* or generic tab switchers), disable them to prevent CSS conflicts.

---

## ⚙️ Settings

Configurable directly from Zen Settings → **Sine Mods** → **Better Tabs & Search**:

| Setting | Description | Default |
| :--- | :--- | :--- |
| **Enable switcher** | Toggle the visual MRU switcher on or off. | `true` |
| **Interaction mode** | **Hold mode** (hold Ctrl, press Tab, release Ctrl to switch) or **Sticky mode** (press Ctrl+Tab once, navigate, Enter/Click to switch, Esc to cancel). | `Hold mode` |
| **Number of recent tabs** | Choose how many recent tabs appear in the strip (4, 5, 6, 7, 8, or 10). | `6 tabs` |
| **Delay before HUD** | Delay before the visual panel pops up (`0ms`, `100ms`, `200ms`, `300ms`). Quick Ctrl+Tab flips tabs immediately. | `200ms` |
| **Show unloaded tabs** | Whether to include hibernated/unloaded tabs in the switcher strip. | `false` |
| **Custom focus ring color** | Hex or CSS color string. Leave empty to use your live Zen theme accent. | *(Zen Accent)* |
| **Enable Spotlight Search** | Toggle the floating Spotlight tab search bar. | `true` |
| **Spotlight shortcut** | Choose shortcut (`Ctrl+Space`, `Ctrl+Shift+A`, `Alt+Space`, `Ctrl+Alt+T`). | `Ctrl+Space` |
| **Max search results** | Maximum search results in Spotlight list (6, 8, 10, 12). | `8 results` |

---

## ⌨️ Controls

### Visual Tab Strip (`Ctrl + Tab`)
- `Ctrl + Tab`: Advance to the next most recent tab.
- `Ctrl + Shift + Tab`: Move to the previous tab.
- `Arrow Right` / `Arrow Left`: Cycle through tabs horizontally (with automatic wrap-around).
- `Space`: Transition directly into Spotlight Tab Search.
- `Release Ctrl`: Switch to the highlighted tab (in hold mode).
- `Escape` or `Click outside HUD`: Close without switching tabs.
- `Click on any card`: Instantly switch to that tab.

### Spotlight Search (`Ctrl + Space`)
- `Ctrl + Space`: Open or close Spotlight Search from any page or browser screen.
- `Type query`: Filters open tabs by title, URL, or Zen workspace name.
- `Arrow Down` / `Arrow Up`: Select item in results list.
- `Enter`: Switch to the selected tab.
- `Escape` or `Click outside`: Close Spotlight Search.

---

## 🛠️ Development & Testing

Run unit tests against simulated Firefox/Zen DOM stubs:

```bash
npm test
# or
node --test test/heliarc-ctrltab.test.js
```

---

## 📄 License

[MIT](LICENSE)
