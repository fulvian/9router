/**
 * Token Refresh Scheduler
 * 
 * Servizio di scheduling per refresh proattivo dei token OAuth.
 * Verifica periodicamente tutti i provider OAuth e refresha i token prima che scadano.
 * 
 * Configurazione:
 * - TOKEN_REFRESH_INTERVAL_MS: Intervallo di check (default: 2 minuti)
 * - TOKEN_EXPIRY_BUFFER_MS: Buffer di scadenza (default: 10 minuti)
 */

import { getProviderConnections, updateProviderConnection } from "@/lib/localDb.js";
import { refreshTokenByProvider } from "open-sse/services/tokenRefresh.js";
import * as log from "@/sse/utils/logger.js";

// Configurazione di default
const DEFAULT_REFRESH_INTERVAL_MS = 2 * 60 * 1000;  // 2 minuti
const DEFAULT_EXPIRY_BUFFER_MS = 10 * 60 * 1000;    // 10 minuti
const MAX_REFRESH_RETRIES = 3;

/**
 * Token Refresh Scheduler
 * 
 * Gestisce il refresh proattivo dei token OAuth per tutti i provider.
 */
export class TokenRefreshScheduler {
    /**
     * @param {object} options
     * @param {number} options.intervalMs - Intervallo tra i check in millisecondi
     * @param {number} options.expiryBufferMs - Buffer prima della scadenza per triggerare refresh
     */
    constructor(options = {}) {
        this.intervalMs = options.intervalMs || DEFAULT_REFRESH_INTERVAL_MS;
        this.expiryBufferMs = options.expiryBufferMs || DEFAULT_EXPIRY_BUFFER_MS;
        this.intervalId = null;
        this.isRunning = false;
        this.refreshLocks = new Map(); // Lock per evitare refresh simultanei dello stesso token
        this.stats = {
            totalChecks: 0,
            tokensRefreshed: 0,
            refreshErrors: 0,
            lastCheckAt: null
        };
    }

    /**
     * Avvia lo scheduler
     */
    start() {
        if (this.intervalId) {
            log.warn("TOKEN_SCHEDULER", "Already running");
            return;
        }

        this.isRunning = true;

        // FIX: Primo check IMMEDIATO (non dopo 30s) per gestire token già scaduti
        // Questo è critico quando il server viene riavviato con token scaduti
        this.checkAndRefreshAllTokens().catch(err => {
            log.error("TOKEN_SCHEDULER", `Initial check failed: ${err.message}`);
        });

        // Poi check periodico ogni 2 minuti
        this.intervalId = setInterval(() => {
            this.checkAndRefreshAllTokens().catch(err => {
                log.error("TOKEN_SCHEDULER", `Periodic check failed: ${err.message}`);
            });
        }, this.intervalMs);

        log.info("TOKEN_SCHEDULER", `Started | interval=${this.intervalMs}ms | buffer=${this.expiryBufferMs}ms`);
    }

    /**
     * Ferma lo scheduler
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        this.refreshLocks.clear();
        log.info("TOKEN_SCHEDULER", "Stopped");
    }

    /**
     * Verifica e refresha tutti i token OAuth che stanno per scadere
     */
    async checkAndRefreshAllTokens() {
        this.stats.totalChecks++;
        this.stats.lastCheckAt = new Date().toISOString();

        try {
            // Ottieni tutte le connessioni OAuth attive
            const connections = await getProviderConnections({
                authType: "oauth",
                isActive: true
            });

            if (connections.length === 0) {
                log.debug("TOKEN_SCHEDULER", "No OAuth connections found");
                return;
            }

            log.debug("TOKEN_SCHEDULER", `Checking ${connections.length} OAuth connection(s)`);

            // Controlla ogni connessione
            const refreshPromises = [];
            for (const conn of connections) {
                if (this.shouldRefreshToken(conn)) {
                    refreshPromises.push(this.refreshToken(conn));
                }
            }

            // Esegui tutti i refresh in parallelo
            if (refreshPromises.length > 0) {
                await Promise.allSettled(refreshPromises);
            }

        } catch (error) {
            log.error("TOKEN_SCHEDULER", `Check failed: ${error.message}`);
        }
    }

    /**
     * Determina se un token necessita di refresh
     * @param {object} connection - Connessione provider
     * @returns {boolean}
     */
    shouldRefreshToken(connection) {
        // Se non c'è data di scadenza, non possiamo determinare
        if (!connection.expiresAt) {
            return false;
        }

        // Se non c'è refresh token, non possiamo refreshare
        if (!connection.refreshToken) {
            return false;
        }

        const expiresAt = new Date(connection.expiresAt).getTime();
        const now = Date.now();
        const timeUntilExpiry = expiresAt - now;

        // FIX: Gestione token GIÀ SCADUTO (timeUntilExpiry negativo)
        if (timeUntilExpiry <= 0) {
            const expiredMinutesAgo = Math.abs(Math.round(timeUntilExpiry / 60000));
            log.warn("TOKEN_SCHEDULER",
                `${connection.provider}/${connection.id?.slice(0, 8)} TOKEN SCADUTO ${expiredMinutesAgo} minuti fa - refresh immediato richiesto`
            );
            return true; // Deve essere refreshato!
        }

        // Refresh se manca meno del buffer alla scadenza
        const needsRefresh = timeUntilExpiry < this.expiryBufferMs;

        if (needsRefresh) {
            const minutesLeft = Math.round(timeUntilExpiry / 60000);
            log.info("TOKEN_SCHEDULER",
                `${connection.provider}/${connection.id?.slice(0, 8)} expires in ${minutesLeft}min, needs refresh`
            );
        }

        return needsRefresh;
    }

    /**
     * Esegue il refresh di un token con retry e exponential backoff
     * Ispirato a me4brain: _refresh_with_retry()
     * @param {object} connection - Connessione provider
     * @returns {Promise<object|null>} Nuove credenziali o null se fallito
     */
    async refreshToken(connection) {
        const lockKey = connection.id;

        // Evita refresh simultanei dello stesso token
        if (this.refreshLocks.has(lockKey)) {
            log.debug("TOKEN_SCHEDULER",
                `${connection.provider}/${connection.id?.slice(0, 8)} already being refreshed, skipping`
            );
            return null;
        }

        // Acquisisci lock
        this.refreshLocks.set(lockKey, Date.now());

        try {
            // FIX: Retry con exponential backoff (come me4brain)
            const maxRetries = 3;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        // Exponential backoff: 1s, 2s, 4s + jitter
                        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
                        log.info("TOKEN_SCHEDULER",
                            `${connection.provider}/${connection.id?.slice(0, 8)} retry ${attempt}/${maxRetries} after ${Math.round(delay)}ms`
                        );
                        await new Promise(r => setTimeout(r, delay));
                    }

                    log.info("TOKEN_SCHEDULER",
                        `Refreshing ${connection.provider}/${connection.id?.slice(0, 8)} (${connection.email || connection.name || "unknown"})`
                    );

                    // Chiama la funzione di refresh del provider
                    const newCreds = await refreshTokenByProvider(connection.provider, {
                        refreshToken: connection.refreshToken,
                        accessToken: connection.accessToken,
                        clientId: connection.clientId,
                        clientSecret: connection.clientSecret
                    });

                    if (!newCreds || !newCreds.accessToken) {
                        throw new Error("No access token in refresh response");
                    }

                    // Calcola nuova scadenza
                    const expiresIn = newCreds.expiresIn || 3600; // Default 1 ora
                    const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

                    // Aggiorna nel database
                    await updateProviderConnection(connection.id, {
                        accessToken: newCreds.accessToken,
                        refreshToken: newCreds.refreshToken || connection.refreshToken,
                        expiresAt: newExpiresAt,
                        expiresIn: expiresIn,
                        testStatus: "active",
                        lastError: null,
                        lastErrorAt: null,
                        errorCode: null
                    });

                    this.stats.tokensRefreshed++;

                    log.info("TOKEN_SCHEDULER",
                        `✅ Refreshed ${connection.provider}/${connection.id?.slice(0, 8)} | expires at ${newExpiresAt}`
                    );

                    return {
                        accessToken: newCreds.accessToken,
                        refreshToken: newCreds.refreshToken || connection.refreshToken,
                        expiresAt: newExpiresAt,
                        expiresIn: expiresIn
                    };

                } catch (error) {
                    const errorMsg = error.message?.toLowerCase() || '';

                    // FIX: Gestione invalid_grant (token revocato) - come me4brain
                    if (errorMsg.includes('invalid_grant') || errorMsg.includes('token has been revoked') || errorMsg.includes('invalid refresh token')) {
                        log.error("TOKEN_SCHEDULER",
                            `❌ ${connection.provider}/${connection.id?.slice(0, 8)} TOKEN REVOCATO - richiede re-auth: ${error.message}`
                        );

                        // Aggiorna stato per indicare che richiede re-auth
                        await updateProviderConnection(connection.id, {
                            testStatus: "unavailable",
                            lastError: "Token revocato - richiede re-authenticazione",
                            lastErrorAt: new Date().toISOString(),
                            errorCode: 401
                        });

                        this.stats.refreshErrors++;
                        return null; // Non ritentare per token revocato
                    }

                    // FIX: Gestione errori di rete/server - ritenta
                    if (attempt < maxRetries - 1) {
                        log.warn("TOKEN_SCHEDULER",
                            `${connection.provider}/${connection.id?.slice(0, 8)} refresh failed (attempt ${attempt + 1}/${maxRetries}): ${error.message}`
                        );
                        continue; // Ritenta
                    }

                    // Ultimo tentativo fallito
                    this.stats.refreshErrors++;
                    log.error("TOKEN_SCHEDULER",
                        `❌ Refresh failed for ${connection.provider}/${connection.id?.slice(0, 8)} after ${maxRetries} attempts: ${error.message}`
                    );

                    // Non aggiorniamo lastError qui per non interferire con il normale flusso errori
                    // Il sistema di fallback gestirà l'errore alla prossima richiesta
                    return null;
                }
            }

            return null;

        } finally {
            // Rilascia lock
            this.refreshLocks.delete(lockKey);
        }
    }

    /**
     * Forza il refresh di una connessione specifica
     * @param {string} connectionId - ID della connessione
     * @returns {Promise<object|null>}
     */
    async forceRefresh(connectionId) {
        const connections = await getProviderConnections({ id: connectionId });
        const connection = connections[0];

        if (!connection) {
            throw new Error(`Connection ${connectionId} not found`);
        }

        if (connection.authType !== "oauth") {
            throw new Error(`Connection ${connectionId} is not an OAuth connection`);
        }

        if (!connection.refreshToken) {
            throw new Error(`Connection ${connectionId} has no refresh token`);
        }

        return this.refreshToken(connection);
    }

    /**
     * Ottiene le statistiche dello scheduler
     * @returns {object}
     */
    getStats() {
        return {
            ...this.stats,
            isRunning: this.isRunning,
            intervalMs: this.intervalMs,
            expiryBufferMs: this.expiryBufferMs,
            activeLocks: this.refreshLocks.size
        };
    }

    /**
     * Verifica se lo scheduler è in esecuzione
     * @returns {boolean}
     */
    isActive() {
        return this.isRunning && this.intervalId !== null;
    }
}

// Singleton instance
let schedulerInstance = null;

/**
 * Ottiene l'istanza singleton dello scheduler
 * @param {object} options - Opzioni per creare lo scheduler (solo alla prima chiamata)
 * @returns {TokenRefreshScheduler}
 */
export function getTokenRefreshScheduler(options = {}) {
    if (!schedulerInstance) {
        schedulerInstance = new TokenRefreshScheduler(options);
    }
    return schedulerInstance;
}

/**
 * Avvia lo scheduler se non è già in esecuzione
 * @param {object} options - Opzioni per lo scheduler
 * @returns {TokenRefreshScheduler}
 */
export function startTokenRefreshScheduler(options = {}) {
    const scheduler = getTokenRefreshScheduler(options);
    scheduler.start();
    return scheduler;
}

/**
 * Ferma lo scheduler
 */
export function stopTokenRefreshScheduler() {
    if (schedulerInstance) {
        schedulerInstance.stop();
    }
}

export default TokenRefreshScheduler;
