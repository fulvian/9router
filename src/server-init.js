// Server startup script
import initializeCloudSync from "./shared/services/initializeCloudSync.js";
import { startTokenRefreshScheduler, stopTokenRefreshScheduler } from "./shared/services/tokenRefreshScheduler.js";

async function startServer() {
  console.log("Starting server...");

  try {
    // Initialize cloud sync
    await initializeCloudSync();
    console.log("✓ Cloud sync initialized");

    // Start token refresh scheduler for proactive OAuth token refresh
    startTokenRefreshScheduler({
      intervalMs: 2 * 60 * 1000,  // Check every 2 minutes
      expiryBufferMs: 10 * 60 * 1000  // Refresh if expiring within 10 minutes
    });
    console.log("✓ Token refresh scheduler started");

    console.log("Server ready");
  } catch (error) {
    console.error("Error during server initialization:", error);
    process.exit(1);
  }
}

// Graceful shutdown handler
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);

  try {
    // Stop token refresh scheduler
    stopTokenRefreshScheduler();
    console.log("✓ Token refresh scheduler stopped");
  } catch (error) {
    console.error("Error during shutdown:", error);
  }

  process.exit(0);
}

// Register shutdown handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start the server initialization
startServer().catch(console.error);

// Export for use as module if needed
export default startServer;
