# READMEIA: Guía de Arquitectura e Instrucciones para Agentes de Antigravity

> **Propósito de este documento:** Este archivo está diseñado específicamente para que cualquier instancia de Antigravity (o agente de IA) pueda retomar, entender, mantener o extender este proyecto de forma inmediata y sin pérdida de contexto.

---

## 1. Contexto y Origen del Proyecto

* **Objetivo del usuario:** Crear un mod para **Zen Browser** que replique con fidelidad total la experiencia de intercambio de pestañas (`Ctrl+Tab`) de **Arc Browser** y **Heliarc** (el add-on de macOS para el navegador Helium).
* **Problema identificado en proyectos previos:**
  * [robin-liquidium/heliarc](https://github.com/robin-liquidium/heliarc) es una app nativa de macOS en Swift que depende de AppleScript y ScreenCaptureKit; no funciona en Windows ni dentro de Zen.
  * [dvgmdvgm/zen-arc-ctrltab](https://github.com/dvgmdvgm/zen-arc-ctrltab) intentó implementar esto en Zen pero añadió demasiada complejidad (múltiples vistas: grid, list, split; menús de configuración abultados con 15+ opciones; títulos colocados debajo de las tarjetas en vez de flotantes).
* **Nuestra solución:** Un mod específico para el **Sine Marketplace** de Zen Browser que elimina todos los protocolos de selección de vista y se enfoca en una sola experiencia: **Fila única horizontal en panel Liquid Glass flotante con tarjetas full-bleed, cápsulas de título esmeriladas y anillo de foco radiante.**

---

## 2. Estructura de Archivos del Proyecto

```text
F:\My Drive\Documentos\Personal\Codigo\13 Zen Mods\01 Ctrl Tab Mod\
├── theme.json                 # Manifiesto canónico de Sine Marketplace
├── preferences.json           # Declaración de opciones en Ajustes de Zen -> Sine Mods
├── chrome.css                 # Hoja de estilos del HUD, tarjetas, focus ring y animaciones
├── JS/
│   └── heliarc-ctrltab.uc.js  # Script UserChrome inyectado en browser.xhtml
├── test/
│   └── heliarc-ctrltab.test.js# Suite de pruebas unitarias sobre stubs de Firefox
├── package.json               # Configuración para ejecutar pruebas con `npm test`
├── LICENSE                    # Licencia MIT
├── README.md                  # Documentación para usuarios finales y Sine Marketplace
└── READMEIA.md                # Este documento técnico para el agente
```

---

## 3. Arquitectura Interna del Mod

### 3.1 Integración con el Motor de Zen Browser (Firefox Gecko)
Zen Browser hereda de Mozilla Firefox el subsistema interno de cambio de pestañas definido en `chrome://browser/content/browser-ctrlTab.js`:
* **`window.ctrlTab`**: Objeto global que gestiona la apertura, cierre y navegación del panel.
* **`window.tabPreviews`**: Módulo que genera y almacena en caché las capturas de pantalla de las pestañas (`tabPreviews.get(tab)`).
* **Preferencias nativas manipuladas:**
  * `browser.ctrlTab.sortByRecentlyUsed = true`: Habilita el orden MRU (Most Recently Used).
  * `zen.ctrlTab.show-pending-tabs = true`: Permite mostrar pestañas hibernadas o descargadas.
  * `browser.ctrlTab.maxPreviews = N`: Límite máximo de pestañas almacenadas en el buffer de previsualización.
  * `ctrlTab.previewsPerRow = N`: **Punto crítico:** al igualar `previewsPerRow` a `maxTabs`, obligamos a Firefox a distribuir todos los elementos en una sola fila horizontal.

### 3.2 Modificación Dinámica del DOM (`JS/heliarc-ctrltab.uc.js`)
El script inyecta la siguiente jerarquía dentro de `#ctrlTab-panel`:
```html
<panel id="ctrlTab-panel">
  <!-- 1. Stage transparente que cubre la ventana para centrado y clics exteriores -->
  <div id="heliarc-stage">
    <!-- 2. HUD flotante tipo Liquid Glass -->
    <div id="heliarc-card">
      <!-- 3. Lista nativa de previsualizaciones (en fila única flex) -->
      <div id="ctrlTab-previews">
        <button class="ctrlTab-preview">
          <div class="ctrlTab-preview-inner">
            <!-- Canvas con screenshot full-bleed -->
            <div class="ctrlTab-canvas">
              <canvas /> <!-- o <img> -->
            </div>
            <!-- Fallback para pestañas sin thumbnail / descargadas -->
            <div class="heliarc-fallback">
              <img class="heliarc-fallback-icon" src="..." />
            </div>
            <!-- Cápsula flotante superior izquierda con Favicon + Título -->
            <div class="heliarc-title-pill">
              <div class="ctrlTab-favicon-container">
                <image class="ctrlTab-favicon" />
              </div>
              <label class="ctrlTab-label">Título de la pestaña</label>
            </div>
          </div>
        </button>
      </div>
    </div>
  </div>
</panel>
```

### 3.3 Reglas Geométricas y Estilos (`chrome.css`)
Heliarc sigue un diseño geométrico concéntrico estricto extraído de su implementación nativa en Swift:
* **Tarjeta de previsualización:**
  * Ancho: `220px`
  * Alto: `146px`
  * Radio de borde (`cardRadius`): `14px`
* **Panel HUD exterior:**
  * Padding: `20px`
  * Gap entre tarjetas: `16px`
  * Radio de borde (`panelRadius`): `34px` (`cardRadius (14px) + padding (20px) = 34px`)
  * Material: `backdrop-filter: blur(32px) saturate(180%)`, fondo oscuro translúcido `rgba(20, 20, 25, 0.76)`.
* **Anillo de Foco (Focus Ring):**
  * Posición: Exterior a la tarjeta con separación (`outline-offset: 3px`).
  * Grosor de línea: `3px solid var(--heliarc-ring-color)`.
  * Escala: `transform: scale(1.025) translateY(-2px)`.
  * Resplandor: `box-shadow: 0 0 22px color-mix(in srgb, var(--heliarc-ring-color) 50%, transparent)`.

---

## 4. Cómo Probar y Validar el Código

El proyecto cuenta con un entorno de pruebas unitarias automatizado en Node.js sin dependencias externas:

```bash
# Navegar a la carpeta del proyecto
cd "F:\My Drive\Documentos\Personal\Codigo\13 Zen Mods\01 Ctrl Tab Mod"

# Ejecutar la suite de pruebas
npm test
# o directamente:
node --test test/heliarc-ctrltab.test.js
```

### Qué verifican las pruebas:
1. Sincronización correcta de preferencias con las variables internas de Firefox.
2. Forzado de fila única (`native.previewsPerRow === maxTabs`).
3. Construcción del stage y del card en el DOM, así como ocultamiento de `#ctrlTab-showAll-container`.
4. Manejo de modo Hold (suelta Ctrl para cambiar) vs Sticky (retiene con Enter/Esc).
5. Decoración de las tarjetas con la píldora flotante `.heliarc-title-pill` y el fallback `.heliarc-fallback`.
6. Navegación por teclado con flechas izquierda/derecha y wrap cíclico.

---

## 5. Instrucciones para Publicar o Actualizar el Mod

Para que el usuario pueda instalar o actualizar este mod en Zen Browser a través de Sine:
1. **Crear repositorio en GitHub:**
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit of Heliarc Ctrl+Tab mod for Zen Browser"
   git branch -M main
   git remote add origin https://github.com/<usuario>/<nombre-repo>.git
   git push -u origin main
   ```
2. **Instalación en Zen Browser:**
   * Abrir Ajustes de Zen (`about:preferences`) -> **Sine Mods**.
   * Pegar el enlace del repositorio GitHub en el campo de instalación.
   * Instalar y reiniciar el navegador.

---

## 6. Recomendaciones para Futuras Mejoras

Si el usuario solicita ampliar funciones en el futuro, estas son las rutas recomendadas:
* **Extracción de Color de Acento Dinámico:**  
  En Heliarc para macOS, el focus ring cambia de color según el color dominante de la captura de pantalla de cada pestaña. En Zen, esto se puede implementar analizando los píxeles del `<canvas>` del thumbnail en el hook `updatePreview` y seteando `--heliarc-ring-color` dinámicamente en el estilo del elemento hijo.
* **Ajuste de Escala Responsivo:**  
  Si el usuario tiene pantallas de baja resolución (ej. laptops de 1366x768) con 8 o 10 pestañas abiertas simultáneamente, el ancho del panel puede superar la pantalla. Se puede agregar una regla `@media (max-width: 1400px)` o un escalado dinámico con CSS `clamp()` o `transform: scale()` para adaptar el ancho del strip automáticamente.
