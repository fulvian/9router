import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

/**
 * GET /api/models/discovery - Unified discovery for all active providers
 */
export async function GET() {
  try {
    const connections = await getProviderConnections({ isActive: true });
    
    const results = await Promise.allSettled(
      connections.map(async (conn) => {
        try {
          let url = "";
          let headers = {
            "Content-Type": "application/json",
          };

          if (isOpenAICompatibleProvider(conn.provider)) {
            const baseUrl = conn.providerSpecificData?.baseUrl;
            if (!baseUrl) return null;
            url = `${baseUrl.replace(/\/$/, "")}/models`;
            if (conn.apiKey) {
              headers["Authorization"] = `Bearer ${conn.apiKey}`;
            }
          } else if (isAnthropicCompatibleProvider(conn.provider)) {
            let baseUrl = conn.providerSpecificData?.baseUrl;
            if (!baseUrl) return null;
            baseUrl = baseUrl.replace(/\/$/, "");
            if (baseUrl.endsWith("/messages")) baseUrl = baseUrl.slice(0, -9);
            url = `${baseUrl}/models`;
            headers["x-api-key"] = conn.apiKey;
            headers["anthropic-version"] = "2023-06-01";
            headers["Authorization"] = `Bearer ${conn.apiKey}`;
          } else {
            // Standard providers don't need dynamic discovery for now 
            // as their models are mostly static in providerModels.js
            return null;
          }

          const response = await fetch(url, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(5000), // 5s timeout for local servers
          });

          if (!response.ok) return null;

          const data = await response.json();
          const models = (data.data || data.models || []).map(m => ({
            id: m.id || m.name || m.model,
            name: m.name || m.id || m.model,
            provider: conn.provider,
            connectionId: conn.id,
          }));

          return {
            providerId: conn.provider,
            connectionId: conn.id,
            connectionName: conn.name,
            models,
          };
        } catch (e) {
          console.log(`Discovery failed for ${conn.provider}:`, e.message);
          return null;
        }
      })
    );

    const discovered = results
      .filter(r => r.status === "fulfilled" && r.value !== null)
      .map(r => r.value);

    return NextResponse.json({ discovered });
  } catch (error) {
    console.error("Discovery service error:", error);
    return NextResponse.json({ error: "Discovery failed" }, { status: 500 });
  }
}
