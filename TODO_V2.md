# ⛔ NO MERGEAR HASTA FIXEAR — TODO Pendiente (`feat/rollhaven-v2`)

> **Estado del PR #1:** Bloqueado (`Draft` + etiqueta `do-not-merge`). No fusionar a `main` hasta completar el requerimiento siguiente.

## TODO 7 — Separar Interfaz de Escritorio (PC) vs Celular (Móvil) dentro del Viewport (`100dvh`)

> **Regla de Git:** Implementar en una rama diferente a `main` (subrama desde `feat/rollhaven-v2`, ej. `feat/desktop-hotbar-mobile-radial`).

### Descripción del Fix Requerido
- [ ] **Navegador de PC (Escritorio):**
  - La barra inferior de accesos rápidos debe mostrarse **horizontal y visible directamente como estaba antes** (`1. Iniciativa`, `2. Ataque con arma equipada`, conjuros, `Hoja`, `5 Sets`, `Tracker/Chat`, `Pasar Turno`), **fija dentro del viewport (`100dvh`) sin salirse de la pantalla ni requerir scroll**.
  - Mantener el mapa como protagonista y conservar la colocación direccional de plantillas AoE en 2 clics (1º clic fija origen, sigue el mouse para dirección, 2º clic confirma).
- [ ] **Celular (Móvil):**
  - Mantener el enfoque de **menús radiales desplegables** centrados en botones flotantes (botón **Accesos** radial + botón **Medidas** radial) para que los controles sean accesibles sobre el mapa en pantallas pequeñas.
- [ ] **Orden de Turnos:**
  - Mantener el cajón retráctil superior que se despliega automáticamente durante unos segundos cuando el DM cambia de turno.
