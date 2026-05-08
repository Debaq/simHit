#!/usr/bin/env bash
#
# simhit.sh - Script de gestion para SimHIT
# Uso: ./simhit.sh [comando]
# Sin argumentos: abre menu interactivo
#

set -uo pipefail

# ── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Variables ────────────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/app"
TAURI_DIR="$APP_DIR/src-tauri"
BUILD_DIR="$APP_DIR/build"
BINARY_NAME="app"
APP_IDENTIFIER="com.nick.app"
VERSION=$(grep '"version"' "$APP_DIR/package.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')

_detect_cargo_target() {
    if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
        echo "$CARGO_TARGET_DIR"
    elif grep -q 'target-dir' ~/.cargo/config.toml 2>/dev/null; then
        grep 'target-dir' ~/.cargo/config.toml | head -1 | sed 's/.*= *"\(.*\)".*/\1/' | sed "s|~|$HOME|"
    else
        echo "$TAURI_DIR/target"
    fi
}
CARGO_TARGET="$(_detect_cargo_target)"
BUNDLE_DIR="$CARGO_TARGET/release/bundle"

find_binary() {
    local name="${1:-$BINARY_NAME}"
    for dir in "$CARGO_TARGET/release" "$TAURI_DIR/target/release"; do
        if [[ -f "$dir/$name" ]]; then
            echo "$dir/$name"
            return 0
        fi
    done
    return 1
}

# ── Funciones auxiliares ─────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}\n"; }

elapsed() {
    local start=$1
    local end=$(date +%s)
    local diff=$((end - start))
    echo "$((diff / 60))m $((diff % 60))s"
}

pause_after() {
    echo ""
    echo -e "${DIM}Presiona ENTER para volver al menu...${NC}"
    read -r
}

# ── Verificacion de dependencias ─────────────────────────────────────────────
check_deps() {
    header "Verificando dependencias"
    local missing=0

    for cmd in node npm cargo rustc; do
        if command -v "$cmd" &>/dev/null; then
            success "$cmd -> $(command $cmd --version 2>/dev/null | head -1)"
        else
            error "$cmd no encontrado"
            missing=1
        fi
    done

    if (cd "$APP_DIR" && npx tauri --version &>/dev/null); then
        success "tauri-cli -> $(cd "$APP_DIR" && npx tauri --version 2>/dev/null)"
    else
        error "tauri-cli no encontrado (cd app && npm i -D @tauri-apps/cli)"
        missing=1
    fi

    if [[ $missing -eq 1 ]]; then
        error "Faltan dependencias obligatorias"
        return 1
    fi
    success "Todas las dependencias disponibles"
}

# ── Instalar dependencias ────────────────────────────────────────────────────
cmd_install() {
    header "Instalando dependencias"
    cd "$APP_DIR"
    npm install
    success "Dependencias npm instaladas"
}

# ── Desarrollo ───────────────────────────────────────────────────────────────
cmd_dev() {
    header "Modo desarrollo (Tauri)"
    check_deps || return
    cd "$APP_DIR"
    info "Iniciando Tauri + Vite hot reload..."
    npm run tauri dev || true
}

cmd_dev_web() {
    header "Frontend dev (solo navegador)"
    cd "$APP_DIR"
    info "Iniciando Vite dev server... (Ctrl+C para detener)"
    npm run dev || true
}

# ── Check ────────────────────────────────────────────────────────────────────
cmd_check() {
    header "Verificacion rapida"
    local start=$(date +%s)
    local errors=0

    info "Svelte check..."
    cd "$APP_DIR"
    if npm run check; then
        success "Svelte/TS OK"
    else
        error "Svelte/TS tiene errores"
        errors=1
    fi

    info "Cargo check..."
    cd "$TAURI_DIR"
    if cargo check; then
        success "Rust OK"
    else
        error "Rust tiene errores"
        errors=1
    fi

    if [[ $errors -eq 0 ]]; then
        success "Todo OK en $(elapsed $start)"
    else
        error "Hay errores ($(elapsed $start))"
    fi
}

# ── Build ────────────────────────────────────────────────────────────────────
cmd_build() {
    header "Build SimHIT v$VERSION"
    check_deps || return
    local start=$(date +%s)
    cd "$APP_DIR"

    info "Limpiando bundles previos..."
    rm -rf "$BUNDLE_DIR"

    info "Compilando binario release (sin bundles deb/rpm/appimage)..."
    npm run tauri build -- --no-bundle

    success "Build completo en $(elapsed $start)"
    collect_artifacts
}

cmd_build_bundle() {
    header "Build SimHIT v$VERSION + bundles"
    check_deps || return
    local start=$(date +%s)
    cd "$APP_DIR"

    info "Limpiando bundles previos..."
    rm -rf "$BUNDLE_DIR"

    info "Compilando + bundles deb/rpm/appimage..."
    npm run tauri build

    success "Build completo en $(elapsed $start)"
    if [[ -d "$BUNDLE_DIR" ]]; then
        success "Bundles en: $BUNDLE_DIR"
        find "$BUNDLE_DIR" -maxdepth 3 -type f \( -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" \) -exec ls -lh {} \;
    fi
    collect_artifacts
}

cmd_build_debug() {
    header "Build debug"
    cd "$APP_DIR"
    local start=$(date +%s)

    rm -rf "$BUNDLE_DIR"
    info "Compilando binario debug (sin bundles)..."
    npm run tauri build -- --debug --no-bundle

    success "Build debug en $(elapsed $start)"
}

cmd_build_frontend() {
    header "Build frontend"
    local start=$(date +%s)
    cd "$APP_DIR"

    info "Vite build..."
    npm run build

    success "Frontend compilado en $(elapsed $start)"
}

# ── Ejecutar binario ─────────────────────────────────────────────────────────
cmd_run() {
    local bin="$(find_binary || echo '')"
    if [[ ! -f "$bin" ]]; then
        error "Binario no encontrado. Ejecuta 'build' primero."
        return 1
    fi
    header "Ejecutando SimHIT v$VERSION"
    "$bin" "$@" || true
}

# ── Recopilar artefactos ─────────────────────────────────────────────────────
collect_artifacts() {
    local out="$ROOT_DIR/out/$(date '+%Y-%m-%d_%H-%M')"
    mkdir -p "$out"

    local bin="$(find_binary || echo '')"
    if [[ -f "$bin" ]]; then
        cp "$bin" "$out/simhit"
        success "Binario en: $out/simhit"
        ls -lh "$out" | tail -n +2
    else
        rmdir "$out" 2>/dev/null
        warn "No se encontró binario"
    fi
}

# ── Datos (localStorage del webview) ─────────────────────────────────────────
cmd_data_path() {
    header "Ubicacion de datos del webview"
    echo -e "${BOLD}Linux:${NC}   ~/.local/share/$APP_IDENTIFIER/"
    echo -e "${BOLD}Windows:${NC} %APPDATA%\\$APP_IDENTIFIER\\"
    echo -e "${BOLD}macOS:${NC}   ~/Library/Application Support/$APP_IDENTIFIER/"
    echo ""
    local data_dir="$HOME/.local/share/$APP_IDENTIFIER"
    if [[ -d "$data_dir" ]]; then
        success "Existe: $data_dir ($(du -sh "$data_dir" 2>/dev/null | cut -f1))"
        echo -e "${DIM}Contenido:${NC}"
        ls -la "$data_dir" 2>/dev/null | tail -n +2
    else
        warn "Directorio no existe aún (corre la app primero)"
    fi
}

cmd_data_purge() {
    header "Purgar data del webview"
    local data_dir="$HOME/.local/share/$APP_IDENTIFIER"
    if [[ ! -d "$data_dir" ]]; then
        info "Nada que purgar"
        return
    fi
    warn "Esto borra escenarios guardados (localStorage) y caché del webview"
    read -rp "¿Eliminar TODO? (s/N) " ans
    if [[ "$ans" =~ ^[sS]$ ]]; then
        rm -rf "$data_dir"
        success "Datos purgados"
    fi
}

# ── Limpiar ──────────────────────────────────────────────────────────────────
cmd_clean() {
    header "Limpieza"
    info "Limpiando build/ + .svelte-kit + cargo clean..."
    rm -rf "$BUILD_DIR" "$APP_DIR/.svelte-kit"
    cd "$TAURI_DIR" && cargo clean
    success "Limpio"
}

# ── Info ─────────────────────────────────────────────────────────────────────
cmd_info() {
    header "SimHIT v$VERSION"
    echo -e "${BOLD}Directorio:${NC} $ROOT_DIR"
    echo -e "${BOLD}App dir:${NC}    $APP_DIR"
    echo -e "${BOLD}Tauri dir:${NC}  $TAURI_DIR"
    echo -e "${BOLD}Node:${NC}       $(node --version 2>/dev/null || echo 'N/A')"
    echo -e "${BOLD}npm:${NC}        $(npm --version 2>/dev/null || echo 'N/A')"
    echo -e "${BOLD}Rust:${NC}       $(rustc --version 2>/dev/null || echo 'N/A')"
    echo -e "${BOLD}Tauri:${NC}      $(cd "$APP_DIR" && npx tauri --version 2>/dev/null || echo 'N/A')"
    echo -e "${BOLD}Branch:${NC}     $(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || echo 'N/A')"
    echo -e "${BOLD}Commit:${NC}     $(git -C "$ROOT_DIR" log --oneline -1 2>/dev/null || echo 'N/A')"
    local bin="$(find_binary || echo '')"
    if [[ -f "$bin" ]]; then
        echo -e "${BOLD}Binario:${NC}    $bin ($(du -h "$bin" | cut -f1))"
    fi
}

# ── Release ──────────────────────────────────────────────────────────────────
cmd_release() {
    header "Nuevo release"
    cd "$ROOT_DIR"

    if ! command -v gh &>/dev/null; then
        error "gh (GitHub CLI) no instalado"
        return 1
    fi

    if [[ -n "$(git status --porcelain)" ]]; then
        error "Hay cambios sin commitear. Commitea o stashea antes."
        git status --short
        return 1
    fi

    local branch=$(git branch --show-current)
    if [[ "$branch" != "main" && "$branch" != "simhit_2026" ]]; then
        warn "No estas en main/simhit_2026 (actual: $branch)"
        read -rp "¿Continuar de todas formas? (s/N) " ans
        [[ "$ans" =~ ^[sS]$ ]] || return 1
    fi

    local current="$VERSION"
    local IFS='.'
    read -r major minor patch <<< "$current"
    unset IFS

    if [[ -z "$major" || -z "$minor" || -z "$patch" ]]; then
        error "Versión actual invalida: $current"
        return 1
    fi

    local next_major="$((major + 1)).0.0"
    local next_minor="$major.$((minor + 1)).0"
    local next_patch="$major.$minor.$((patch + 1))"

    echo -e "${BOLD}Version actual:${NC} ${CYAN}v$current${NC}"
    echo ""
    echo -e "  ${GREEN}1${NC}) patch  → v${next_patch}  ${DIM}(fixes, cambios menores)${NC}"
    echo -e "  ${YELLOW}2${NC}) minor  → v${next_minor}  ${DIM}(features nuevas compatibles)${NC}"
    echo -e "  ${RED}3${NC}) major  → v${next_major}  ${DIM}(cambios breaking)${NC}"
    echo -e "  ${BLUE}4${NC}) custom ${DIM}(escribir version manual)${NC}"
    echo -e "  ${DIM}0) cancelar${NC}"
    echo ""
    read -rp "Opcion: " opt

    local new_version=""
    case "$opt" in
        1) new_version="$next_patch" ;;
        2) new_version="$next_minor" ;;
        3) new_version="$next_major" ;;
        4)
            read -rp "Nueva version (X.Y.Z): " new_version
            if [[ ! "$new_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                error "Formato invalido. Debe ser X.Y.Z"
                return 1
            fi
            ;;
        0|"") info "Cancelado"; return 0 ;;
        *) error "Opcion no valida"; return 1 ;;
    esac

    if git rev-parse "v$new_version" &>/dev/null; then
        error "Tag v$new_version ya existe"
        return 1
    fi

    local last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
    echo ""
    echo -e "${BOLD}Commits desde ${last_tag:-inicio}:${NC}"
    if [[ -n "$last_tag" ]]; then
        git log "${last_tag}..HEAD" --oneline | head -30
    else
        git log --oneline | head -30
    fi
    echo ""

    echo -e "${BOLD}Resumen:${NC}"
    echo -e "  v${CYAN}$current${NC} → v${GREEN}$new_version${NC}"
    echo -e "  - Actualiza app/package.json, tauri.conf.json, Cargo.toml, Cargo.lock"
    echo -e "  - Crea commit chore(release): v$new_version"
    echo -e "  - Crea tag v$new_version"
    echo -e "  - Push a origin/$branch + tag"
    echo ""
    read -rp "¿Confirmar? (s/N) " confirm
    [[ "$confirm" =~ ^[sS]$ ]] || { info "Cancelado"; return 0; }

    info "Actualizando archivos de version..."
    sed -i "s/\"version\": \"$current\"/\"version\": \"$new_version\"/" "$APP_DIR/package.json"
    sed -i "s/\"version\": \"$current\"/\"version\": \"$new_version\"/" "$TAURI_DIR/tauri.conf.json"
    sed -i "s/^version = \"$current\"/version = \"$new_version\"/" "$TAURI_DIR/Cargo.toml"
    if [[ -f "$TAURI_DIR/Cargo.lock" ]]; then
        python3 -c "
import re
p = '$TAURI_DIR/Cargo.lock'
with open(p) as f: s = f.read()
s = re.sub(r'(name = \"$BINARY_NAME\"\nversion = \")$current(\")', r'\g<1>$new_version\g<2>', s)
with open(p, 'w') as f: f.write(s)
" 2>/dev/null || {
            warn "python3 no disponible, usando sed para Cargo.lock (menos seguro)"
            sed -i "/^name = \"$BINARY_NAME\"$/,/^version = / s/^version = \"$current\"/version = \"$new_version\"/" "$TAURI_DIR/Cargo.lock"
        }
    fi

    success "Versiones actualizadas a $new_version"

    info "Creando commit..."
    git add "$APP_DIR/package.json" "$TAURI_DIR/tauri.conf.json" "$TAURI_DIR/Cargo.toml"
    [[ -f "$TAURI_DIR/Cargo.lock" ]] && git add "$TAURI_DIR/Cargo.lock"
    git commit -m "chore(release): v$new_version"

    info "Creando tag v$new_version..."
    git tag -a "v$new_version" -m "SimHIT v$new_version"

    info "Push a origin..."
    git push origin "$branch"
    git push origin "v$new_version"

    success "Release v$new_version publicado"
}

# ══════════════════════════════════════════════════════════════════════════════
# ── MENU INTERACTIVO ─────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

show_banner() {
    clear
    echo -e "${BOLD}${MAGENTA}"
    echo "  ___ _          _  _ ___ _____"
    echo " / __(_)_ __  __| || |_ _|_   _|"
    echo " \__ \ | '  \/ _\` __ || |  | |  "
    echo " |___/_|_|_|_\__,_|_||_|___| |_|  "
    echo -e "${NC}"
    echo -e "${DIM}  Simulador vHIT · v$VERSION"
    echo -e "  $(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || echo '-') · $(git -C "$ROOT_DIR" log --oneline -1 2>/dev/null | cut -c1-50 || echo '-')${NC}"
    echo ""
}

show_menu() {
    echo -e "${BOLD} DESARROLLO${NC}"
    echo -e "  ${GREEN}1${NC})  Dev Tauri          ${DIM}Tauri + Vite hot reload${NC}"
    echo -e "  ${GREEN}2${NC})  Dev Web            ${DIM}Solo frontend en navegador${NC}"
    echo -e "  ${GREEN}3${NC})  Check              ${DIM}svelte-check + cargo check${NC}"
    echo ""
    echo -e "${BOLD} BUILD${NC}"
    echo -e "  ${YELLOW}4${NC})  Build release      ${DIM}Solo binario (sin deb/rpm/appimage)${NC}"
    echo -e "  ${YELLOW}5${NC})  Build + bundles    ${DIM}Binario + deb/rpm/appimage${NC}"
    echo -e "  ${YELLOW}6${NC})  Build debug        ${DIM}Sin optimizaciones${NC}"
    echo -e "  ${YELLOW}7${NC})  Build frontend     ${DIM}Solo vite build${NC}"
    echo ""
    echo -e "${BOLD} GESTION${NC}"
    echo -e "  ${BLUE}8${NC})  Ejecutar app       ${DIM}Lanzar binario release${NC}"
    echo -e "  ${BLUE}9${NC})  Instalar deps      ${DIM}npm install${NC}"
    echo -e "  ${BLUE}10${NC}) Info proyecto     ${DIM}Versiones y estado${NC}"
    echo ""
    echo -e "${BOLD} DATOS${NC}"
    echo -e "  ${CYAN}11${NC}) Ver path datos    ${DIM}localStorage del webview${NC}"
    echo -e "  ${RED}12${NC}) Purgar datos      ${DIM}Borrar escenarios y caché${NC}"
    echo -e "  ${RED}13${NC}) Limpiar build     ${DIM}build/ + .svelte-kit + cargo clean${NC}"
    echo ""
    echo -e "${BOLD} RELEASE${NC}"
    echo -e "  ${MAGENTA}14${NC}) Nuevo release    ${DIM}Bump version + tag + push${NC}"
    echo ""
    echo -e "  ${BOLD}0${NC})  Salir"
    echo ""
}

menu_loop() {
    while true; do
        show_banner
        show_menu

        echo -ne "${BOLD}  Opcion: ${NC}"
        read -r choice

        case "${choice// /}" in
            1)  cmd_dev;            pause_after ;;
            2)  cmd_dev_web;        pause_after ;;
            3)  cmd_check;          pause_after ;;
            4)  cmd_build;          pause_after ;;
            5)  cmd_build_bundle;   pause_after ;;
            6)  cmd_build_debug;    pause_after ;;
            7)  cmd_build_frontend; pause_after ;;
            8)  cmd_run;            pause_after ;;
            9)  cmd_install;        pause_after ;;
            10) cmd_info;           pause_after ;;
            11) cmd_data_path;      pause_after ;;
            12) cmd_data_purge;     pause_after ;;
            13) cmd_clean;          pause_after ;;
            14) cmd_release;        pause_after ;;
            0|q|salir) echo -e "\n${GREEN}Hasta luego${NC}"; exit 0 ;;
            "") ;;
            *)  error "Opcion no valida: $choice"; sleep 1 ;;
        esac
    done
}

# ── Ayuda CLI ────────────────────────────────────────────────────────────────
cmd_help() {
    echo -e "${BOLD}${MAGENTA}SimHIT v$VERSION${NC}"
    echo -e "${DIM}Simulador vHIT (video Head Impulse Test)${NC}"
    echo ""
    echo -e "${BOLD}Uso:${NC} ./simhit.sh [comando]"
    echo -e "     ./simhit.sh          ${DIM}(menu interactivo)${NC}"
    echo ""
    echo "  dev            Tauri + Vite hot reload"
    echo "  dev:web        Solo frontend en navegador"
    echo "  check          svelte-check + cargo check"
    echo "  build          Build release (solo binario)"
    echo "  build:bundle   Build release + deb/rpm/appimage"
    echo "  build:debug    Build debug"
    echo "  build:frontend Solo frontend"
    echo "  run            Ejecutar binario release"
    echo "  install        npm install"
    echo "  info           Info del proyecto"
    echo "  data:path      Ubicacion de los datos"
    echo "  data:purge     Borrar escenarios + caché webview"
    echo "  clean          Limpiar build + cargo clean"
    echo "  release        Nuevo release (bump + tag + push)"
    echo "  help           Esta ayuda"
}

# ── Router ───────────────────────────────────────────────────────────────────
main() {
    cd "$ROOT_DIR"

    if [[ $# -eq 0 ]]; then
        menu_loop
        exit 0
    fi

    case "$1" in
        dev)            cmd_dev ;;
        dev:web)        cmd_dev_web ;;
        check)          cmd_check ;;
        build)          cmd_build ;;
        build:bundle)   cmd_build_bundle ;;
        build:debug)    cmd_build_debug ;;
        build:frontend) cmd_build_frontend ;;
        run)            cmd_run ;;
        install)        cmd_install ;;
        info)           cmd_info ;;
        data:path)      cmd_data_path ;;
        data:purge)     cmd_data_purge ;;
        clean)          cmd_clean ;;
        release)        cmd_release ;;
        help|--help|-h) cmd_help ;;
        *)              error "Comando desconocido: $1"; cmd_help; exit 1 ;;
    esac
}

main "$@"
