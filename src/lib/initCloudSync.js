import initializeCloudSync from "@/shared/services/initializeCloudSync";
import { startTokenRefreshScheduler } from "@/shared/services/tokenRefreshScheduler";

// Initialize cloud sync and token scheduler when this module is imported
let cloudSyncInitialized = false;
let tokenSchedulerStarted = false;

export async function ensureCloudSyncInitialized() {
  if (!cloudSyncInitialized) {
    try {
      await initializeCloudSync();
      cloudSyncInitialized = true;
    } catch (error) {
      console.error("[ServerInit] Error initializing cloud sync:", error);
    }
  }
  return cloudSyncInitialized;
}

export async function ensureTokenSchedulerStarted() {
  if (!tokenSchedulerStarted) {
    try {
      startTokenRefreshScheduler({
        intervalMs: 2 * 60 * 1000,    // Check every 2 minutes
        expiryBufferMs: 10 * 60 * 1000  // Refresh if expiring within 10 minutes
      });
      tokenSchedulerStarted = true;
      console.log("[ServerInit] Token refresh scheduler started");
    } catch (error) {
      console.error("[ServerInit] Error starting token scheduler:", error);
    }
  }
  return tokenSchedulerStarted;
}

// Auto-initialize when module loads
Promise.all([
  ensureCloudSyncInitialized(),
  ensureTokenSchedulerStarted()
]).catch(console.error);

export default ensureCloudSyncInitialized;
