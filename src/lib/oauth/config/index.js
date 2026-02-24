/**
 * Stub configuration module to resolve Next.js build errors.
 * The getServerCredentials function was part of the CLI OAuth flow
 * and is not required for the normal runtime Token Refresh processes.
 */

export function getServerCredentials() {
    return {
        server: "http://localhost:20128",
        token: "dummy-token",
        userId: "local-user"
    };
}
