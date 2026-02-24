/**
 * Next.js Instrumentation Hook
 * 
 * This file runs once when the Next.js server starts.
 * Used to initialize background services like the Token Refresh Scheduler.
 * 
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
    // Only run on server side
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        // Initialize Token Refresh Scheduler
        const { startTokenRefreshScheduler } = await import('./shared/services/tokenRefreshScheduler.js');

        startTokenRefreshScheduler({
            intervalMs: 2 * 60 * 1000,    // Check every 2 minutes
            expiryBufferMs: 10 * 60 * 1000  // Refresh if expiring within 10 minutes
        });

        console.log('[Instrumentation] Token refresh scheduler started');

        // Initialize cloud sync
        const initializeCloudSync = (await import('./shared/services/initializeCloudSync.js')).default;
        await initializeCloudSync();
        console.log('[Instrumentation] Cloud sync initialized');
    }
}
