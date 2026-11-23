# User Guide / Guía de Usuario (`Rollhaven`)

## 1. Inicio Rápido (Dungeon Master / Host)

1. Descarga el binario correspondiente a tu sistema operativo desde [GitHub Releases](https://github.com/SilverFeit/Rollhaven/releases/latest):
   - **Windows 10/11 (64-bit):** `rollhaven-windows-amd64.exe`
   - **macOS (App Bundle):** `Rollhaven-1.2.0-macOS.dmg` (o el binario `rollhaven-mac-arm64` / `rollhaven-mac-amd64`)
2. Ejecuta **Rollhaven**:
   - Se abrirá automáticamente tu navegador en `http://localhost:8080/dm`.
   - En la terminal y en la cabecera del Dashboard verás la **URL LAN** (`https://192.168.x.x:8080` y `http://192.168.x.x:8080`) y el **PIN de 4 dígitos** (por si quieres abrir `/dm` desde una tablet externa).
3. Muestra el **Código QR** del Dashboard a tus jugadores para que escaneen con la cámara de su celular y entren al instante sin instalar ninguna app.

---

## 2. Desbloqueo de Firewall Local y Gatekeeper (SDD-07)

### Windows Defender Firewall
Al iniciar la aplicación por primera vez en Windows, el sistema desplegará una alerta de Seguridad de Windows:
- Marca la casilla **"Redes privadas (como la red doméstica o del trabajo)"** y haz clic en **Permitir acceso**.
- Si no aparece la alerta y otros celulares no logran entrar a `https://<IP-LAN>:8080`, abre *Firewall de Windows Defender -> Permitir una aplicación* y autoriza `rollhaven-windows-amd64.exe` en redes privadas.

### macOS Gatekeeper
Al ser un ejecutable open-source autocompilado sin firma paga de Apple Developer:
- Haz **clic derecho** sobre `Rollhaven.app` (o el binario `rollhaven-mac-arm64`) -> **Abrir** -> **Abrir** en el diálogo de confirmación.
- Alternativamente, si descargas el binario CLI por terminal, quita el atributo de cuarentena con:
  ```bash
  xattr -cr ./rollhaven-mac-arm64
  chmod +x ./rollhaven-mac-arm64
  ./rollhaven-mac-arm64
  ```

---

## 3. Guía para Jugadores (Móvil / Tablet / Laptop)

1. Escanea el QR o ingresa `http://<IP-LAN>:8080` en el navegador.
2. En la pantalla inicial ingresa únicamente tu **Nombre** y tu **Iniciativa** (opcionalmente puedes elegir raza y color ahí mismo o más tarde).
3. En tu turno:
   - Lanza cualquiera de los **5 Sets de Decisión** las veces que necesites:
     - **Dados:** `d2`, `d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100` o fórmulas `NdX+M`.
     - **Moneda:** Cara, Cruz o Canto (`1 en 6000`).
     - **Magic 8 Ball:** 20 respuestas clásicas o modo Sí/No estricto (50/50).
     - **Peonza:** Preset de 6 caras o editable entre 4 y 12 caras.
     - **Ruleta:** Opciones dinámicas configurables.
   - Todos los dispositivos conectados ven en vivo el **Resultado del Turno Actual**.
   - Cuando termines tus acciones, presiona **Pasar Turno**.
4. En las pestañas superiores puedes:
   - **Raza y Hoja:** Elegir el ícono SVG de tu raza, cambiar el color de tu token y subir tu hoja de personaje (PDF o imagen hasta 10 MB).
   - **Inventario:** Llevar el resumen de ítems y cantidades (`+` / `-`).
   - **Notas:** Escribir anotaciones de campaña con autoguardado automático cada 500 ms.
   - **Mapa:** Cuando el DM active el mapa táctico, aparecerá la pestaña **Mapa** donde podrás hacer zoom/pan y mover tu ficha en la cuadrícula (`5×5` hasta `50×50`).
