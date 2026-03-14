#!/bin/bash

# ==============================================================================
# 9Router Management Script
# ==============================================================================
# Descrizione: Avvia, ferma o riavvia il sistema 9Router gestendo processi zombie.
# ==============================================================================

# Directory del progetto
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Carica variabili d'ambiente
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

PORT=${PORT:-20128}
LOG_FILE="./data/9router_system.log"

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err() { echo -e "${RED}[ERR]${NC} $1"; }

# Flag per skip DNS management (default: false)
SKIP_DNS=false

# ------------------------------------------------------------------------------
# Funzione: DNS Cleanup
# ------------------------------------------------------------------------------
cleanup_dns() {
    if [ "$SKIP_DNS" = true ]; then
        log_warn "DNS cleanup skipped (--skip-dns flag)"
        return
    fi
    
    log_info "Cleaning up DNS entries..."
    
    # Verifica se lo script dns-manager.sh esiste
    if [ -f "./scripts/dns-manager.sh" ]; then
        sudo ./scripts/dns-manager.sh remove
    else
        log_warn "dns-manager.sh not found, attempting manual DNS cleanup..."
        
        # Manual DNS cleanup (fallback se dns-manager.sh non esiste)
        TARGET_HOSTS=("cloudcode-pa.googleapis.com" "daily-cloudcode-pa.googleapis.com")
        HOSTS_FILE="/etc/hosts"
        FOUND_ANY=false
        
        # Rimuovi tutti gli host configurati
        for TARGET_HOST in "${TARGET_HOSTS[@]}"; do
            if grep -q "${TARGET_HOST}" "${HOSTS_FILE}" 2>/dev/null; then
                log_info "Removing DNS entry for ${TARGET_HOST}..."
                sudo sed -i '' "/${TARGET_HOST}/d" "${HOSTS_FILE}"
                FOUND_ANY=true
            fi
        done
        
        if [ "$FOUND_ANY" = true ]; then
            # Flush DNS cache
            log_info "Flushing DNS cache..."
            sudo dscacheutil -flushcache 2>/dev/null || true
            sudo killall -HUP mDNSResponder 2>/dev/null || true
            
            log_info "✅ DNS entries removed and cache flushed"
        else
            log_info "DNS entries not found (already clean)"
        fi
    fi
}

# ------------------------------------------------------------------------------
# Funzione: DNS Setup
# ------------------------------------------------------------------------------
setup_dns() {
    if [ "$SKIP_DNS" = true ]; then
        log_warn "DNS setup skipped (--skip-dns flag)"
        return
    fi
    
    log_info "Setting up DNS entries for MITM..."
    
    # Verifica se lo script dns-manager.sh esiste
    if [ -f "./scripts/dns-manager.sh" ]; then
        sudo ./scripts/dns-manager.sh add
    else
        log_warn "dns-manager.sh not found, MITM may not work correctly"
    fi
}

# ------------------------------------------------------------------------------
# Funzione: Stop
# ------------------------------------------------------------------------------
stop_system() {
    log_info "Arresto del sistema 9Router in corso..."
    
    # 1. Trova processi sulla porta specifica
    PIDS_PORT=$(lsof -t -i:$PORT)
    if [ ! -z "$PIDS_PORT" ]; then
        log_warn "Trovati processi sulla porta $PORT (PIDs: $PIDS_PORT). Terminazione in corso..."
        kill -15 $PIDS_PORT 2>/dev/null
        sleep 2
        # Forza se ancora attivi
        kill -9 $PIDS_PORT 2>/dev/null
    fi

    # 2. Cerca processi legati a next/node in questa directory (zombie/lingering)
    # Usiamo grep per filtrare processi che contengono il path del progetto
    ZOMBIES=$(ps aux | grep -E "node|next" | grep "$PROJECT_DIR" | grep -v grep | awk '{print $2}')
    if [ ! -z "$ZOMBIES" ]; then
        log_warn "Trovati processi zombie/residui. Pulizia..."
        echo "$ZOMBIES" | xargs kill -9 2>/dev/null
    fi

    # 3. Gestione MITM (se attivo)
    PID_MITM="./data/mitm/.mitm.pid"
    if [ -f "$PID_MITM" ]; then
        MITM_PID=$(cat "$PID_MITM")
        if ps -p $MITM_PID > /dev/null; then
            log_warn "Terminazione processo MITM (PID: $MITM_PID)..."
            kill -9 $MITM_PID 2>/dev/null
        fi
        rm -f "$PID_MITM"
    fi

    # 4. Cleanup DNS entries (CRITICAL for Antigravity)
    cleanup_dns

    log_info "Sistema arrestato."
}

# ------------------------------------------------------------------------------
# Funzione: Start
# ------------------------------------------------------------------------------
start_system() {
    # Verifica se già in esecuzione
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
        log_err "Errore: Un processo è già in ascolto sulla porta $PORT."
        log_info "Usa '$0 restart' per riavviare."
        exit 1
    fi

    log_info "Avvio di 9Router in corso..."
    
    # Assicurati che la directory data esista
    mkdir -p ./data

    # Setup DNS entries for MITM (if needed)
    setup_dns

    # Avvio in background
    if [ "$NODE_ENV" = "production" ]; then
        log_info "Running in PRODUCTION mode (npm run start)"
        nohup npm run start >> "$LOG_FILE" 2>&1 &
    else
        log_info "Running in DEVELOPMENT mode (npm run dev)"
        nohup npm run dev >> "$LOG_FILE" 2>&1 &
    fi
    
    # Salva il PID principale (opzionale, dato che Next spawna molti worker)
    echo $! > ./data/9router.pid
    
    log_info "Processo avviato in background. Log: $LOG_FILE"
    
    # Attesa avvio effettivo
    log_info "In attesa che il server sia pronto sulla porta $PORT..."
    MAX_RETRIES=30
    COUNT=0
    while ! lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null; do
        sleep 1
        COUNT=$((COUNT + 1))
        if [ $COUNT -ge $MAX_RETRIES ]; then
            log_err "Timeout: Il server non sembra essersi avviato correttamente."
            log_info "Controlla i log in $LOG_FILE"
            exit 1
        fi
    done
    
    log_info "9Router è ONLINE su http://localhost:$PORT"
}

# ------------------------------------------------------------------------------
# Parse optional flags
# ------------------------------------------------------------------------------
shift_count=0
while [[ $# -gt 1 ]]; do
    case "$1" in
        --skip-dns)
            SKIP_DNS=true
            log_warn "DNS management disabled for this session"
            shift
            ((shift_count++))
            ;;
        *)
            break
            ;;
    esac
done

# ------------------------------------------------------------------------------
# Esecuzione
# ------------------------------------------------------------------------------
case "$1" in
    start)
        start_system
        ;;
    stop)
        stop_system
        ;;
    restart)
        stop_system
        sleep 1
        start_system
        ;;
    status)
        if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null; then
            log_info "Status: 9Router è in ESECUZIONE sulla porta $PORT."
            ps aux | grep -E "node|next" | grep "$PROJECT_DIR" | grep -v grep
        else
            log_warn "Status: 9Router non è in esecuzione."
        fi
        # Show DNS status
        if [ -f "./scripts/dns-manager.sh" ]; then
            echo ""
            ./scripts/dns-manager.sh status
        fi
        ;;
    dns-status)
        if [ -f "./scripts/dns-manager.sh" ]; then
            ./scripts/dns-manager.sh status
        else
            log_err "dns-manager.sh not found"
        fi
        ;;
    dns-cleanup)
        log_warn "Manual DNS cleanup requested"
        cleanup_dns
        ;;
    *)
        echo "Utilizzo: $0 {start|stop|restart|status|dns-status|dns-cleanup} [--skip-dns]"
        echo ""
        echo "Comandi:"
        echo "  start        - Avvia 9Router"
        echo "  stop         - Ferma 9Router e ripulisce le entry DNS"
        echo "  restart      - Riavvia 9Router"
        echo "  status       - Mostra stato di 9Router"
        echo "  dns-status   - Mostra stato delle entry DNS"
        echo "  dns-cleanup  - Rimuove manualmente le entry DNS"
        echo ""
        echo "Flag opzionali:"
        echo "  --skip-dns   - Non gestire le entry DNS (per start/stop)"
        exit 1
        ;;
esac

exit 0
