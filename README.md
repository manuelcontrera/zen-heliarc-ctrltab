# Heliarc Ctrl+Tab & Native Tab Search for Zen Browser

An authentic **Arc Browser / Heliarc** tab switcher and **native floating tab search shortcut** mod for [Zen Browser](https://zen-browser.app).

- Holding `Ctrl+Tab` brings up a floating **Liquid Glass HUD** displaying a single horizontal strip of your most recent tabs with live screenshots and floating frosted title pills.
- Pressing `Ctrl+Space` (or Space while inside Ctrl+Tab) opens Zen Browser's native centered floating search bar pre-configured in **Tabs mode** (`@tabs` / `%`) to search and jump to tabs across Zen Workspaces.
- Pressing `Escape` or pressing `Ctrl+Space` again cleanly closes the search bar and returns focus to the active webpage.

---

## ✨ Features

- **Single-Row Arc Strip:** Clean, centered horizontal row of your most recently used (MRU) tabs.
- **Native Floating Tab Search (`Ctrl+Space`):** Seamless integration with Zen's native address bar in tab search mode (`@tabs` / `%`). Instant and ultra-lightweight.
- **Zen Workspaces Integration:** Filter and jump directly to tabs across any Zen Workspace. Zen switches workspace automatically when a tab is selected.
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

Configurable directly from Zen Settings → **Sine Mods** → **Heliarc Ctrl+Tab & Native Tab Search**:

| Setting | Description | Default |
| :--- | :--- | :--- |
| **Enable switcher** | Toggle the visual MRU switcher on or off. | `true` |
| **Interaction mode** | **Hold mode** (hold Ctrl, press Tab, release Ctrl to switch) or **Sticky mode** (press Ctrl+Tab once, navigate, Enter/Click to switch, Esc to cancel). | `Hold mode` |
| **Number of recent tabs** | Choose how many recent tabs appear in the strip (4, 5, 6, 7, 8, or 10). | `6 tabs` |
| **Delay before HUD** | Delay before the visual panel pops up (`0ms`, `100ms`, `200ms`, `300ms`). Quick Ctrl+Tab flips tabs immediately. | `200ms` |
| **Show unloaded tabs** | Whether to include hibernated/unloaded tabs in the switcher strip. | `false` |
| **Custom focus ring color** | Hex or CSS color string. Leave empty to use your live Zen theme accent. | *(Zen Accent)* |
| **Enable Native Tab Search** | Toggle the `Ctrl+Space` shortcut for Zen native tab search (`@tabs`). | `true` |

---

## ⌨️ Controls

### Visual Tab Strip (`Ctrl + Tab`)
- `Ctrl + Tab`: Advance to the next most recent tab.
- `Ctrl + Shift + Tab`: Move to the previous tab.
- `Arrow Right` / `Arrow Left`: Cycle through tabs horizontally (with automatic wrap-around).
- `Space`: Transition directly into Zen's native tab search.
- `Release Ctrl`: Switch to the highlighted tab (in hold mode).
- `Escape` or `Click outside HUD`: Close without switching tabs.
- `Click on any card`: Instantly switch to that tab.

### Native Tab Search (`Ctrl + Space`)
- `Ctrl + Space`: Open or close Zen's native floating tab search (`@tabs` mode).
- `Type query`: Filters open tabs natively by title or URL.
- `Arrow Down` / `Arrow Up`: Select item in results.
- `Enter`: Switch to the selected tab (Zen switches to that workspace automatically).
- `Escape`: Cleanly exit the search bar and restore focus to your webpage.

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
