# DNS Management Steering Guide

**inclusion**: manual

---

## 🔴 Se l'IDE è Bloccato

Se 9router si è bloccato e l'IDE non riesce a connettersi ad Antigravity:

### Recovery Rapido (30 secondi)

```bash
# Eseguire script di recovery
./scripts/emergency-dns-cleanup.sh

# Riavviare IDE
# Verificare che Antigravity si connetta
```

### Se Emergency Script Non Funziona

```bash
# Opzione 1: Usare DNS Manager
./scripts/dns-manager.sh remove

# Opzione 2: Usare 9router.sh
./9router.sh stop
./9router.sh dns-cleanup

# Opzione 3: Manuale
sudo sed -i '' '/daily-cloudcode-pa.googleapis.com/d' /etc/hosts
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
```

---

## ✅ Uso Corretto di 9Router

### Avvio

```bash
# Avvia 9router (abilita MITM DNS)
./9router.sh start

# Verifica che sia online
./9router.sh status

# Verifica DNS
./scripts/dns-manager.sh status
```

### Arresto

```bash
# Ferma 9router (disabilita MITM DNS)
./9router.sh stop

# Verifica che DNS sia pulito
./scripts/dns-manager.sh status
```

### Riavvio

```bash
# Riavvia 9router
./9router.sh restart
```

---

## 📊 Comandi Disponibili

| Comando | Descrizione |
|---------|-------------|
| `./9router.sh start` | Avvia 9router (abilita MITM DNS) |
| `./9router.sh stop` | Ferma 9router (disabilita MITM DNS) |
| `./9router.sh restart` | Riavvia 9router |
| `./9router.sh status` | Mostra stato di 9router |
| `./9router.sh dns-status` | Mostra stato DNS |
| `./9router.sh dns-cleanup` | Pulizia manuale DNS |
| `./scripts/dns-manager.sh add` | Abilita MITM DNS |
| `./scripts/dns-manager.sh remove` | Disabilita MITM DNS |
| `./scripts/dns-manager.sh status` | Mostra stato DNS |
| `./scripts/emergency-dns-cleanup.sh` | Recovery di emergenza |

---

## ⚠️ Cosa NON Fare

❌ **Non terminare 9router manualmente**
```bash
# SBAGLIATO - Lascia entry DNS attiva
kill -9 <pid>
```

✅ **Usa sempre lo script di stop**
```bash
# CORRETTO - Ripulisce DNS automaticamente
./9router.sh stop
```

---

## 🔍 Diagnostica

### Verificare se DNS è bloccato

```bash
# Mostra stato DNS
./scripts/dns-manager.sh status

# Verifica entry in /etc/hosts
grep "daily-cloudcode-pa.googleapis.com" /etc/hosts
```

### Verificare se 9router è in esecuzione

```bash
./9router.sh status
```

### Verificare log

```bash
# Log di 9router
tail -f ./data/9router_system.log

# Log MITM
tail -f ~/.9router/mitm/server.log
```

---

## 📚 Documentazione Completa

- **Analisi Tecnica**: `docs/DNS_MANAGEMENT_ANALYSIS.md`
- **Incident Report**: `docs/INCIDENT_REPORT_DNS_BLOCKING.md`
- **Scripts Guide**: `scripts/README.md`

---

## 🆘 Troubleshooting

### Problema: "DNS entry is NOT present" ma IDE è bloccato

**Soluzione**: Il problema potrebbe essere altrove. Verificare:
1. Che Antigravity sia configurato correttamente
2. Che il proxy 9router sia in esecuzione
3. I log di 9router per errori

### Problema: "sudo: password required" durante start/stop

**Soluzione**: Inserire password quando richiesto. Oppure configurare sudo senza password:
```bash
sudo visudo
# Aggiungere: fulvio ALL=(ALL) NOPASSWD: /usr/bin/sed, /usr/bin/dscacheutil, /usr/bin/killall
```

### Problema: Script non trovato

**Soluzione**: Verificare che gli script siano eseguibili:
```bash
chmod +x scripts/dns-manager.sh
chmod +x scripts/emergency-dns-cleanup.sh
```

---

**Last Updated**: 2026-03-10
