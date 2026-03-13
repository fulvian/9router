
import { getProviderConfig, buildProviderUrl } from "../open-sse/services/provider.js";
import { isValidModel, getModelsByProviderId } from "../open-sse/config/providerModels.js";

async function runTest() {
  console.log("--- Testing Local Provider Integration ---");

  // 1. Test Config
  const config = getProviderConfig("local");
  console.log("Local Config:", JSON.stringify(config, null, 2));
  if (config.baseUrl === "http://localhost:1234/v1") {
    console.log("✅ Config baseUrl is correct (default)");
  } else {
    console.log("❌ Config baseUrl mismatch");
  }

  // 2. Test URL Building
  const url = buildProviderUrl("local", "test-model", true);
  console.log("Local URL (stream):", url);
  if (url === "http://localhost:1234/v1/chat/completions") {
    console.log("✅ URL construction is correct");
  } else {
    console.log("❌ URL construction mismatch");
  }

  // 3. Test Model Validation
  const isLocalValid = isValidModel("local", "any-random-model-id");
  console.log("Is 'any-random-model-id' valid for local?:", isLocalValid);
  if (isLocalValid === true) {
    console.log("✅ Passthrough for local models works");
  } else {
    console.log("❌ Passthrough for local models failed");
  }

  const isLoValid = isValidModel("lo", "any-other-model");
  console.log("Is 'any-other-model' valid for 'lo' alias?:", isLoValid);
  if (isLoValid === true) {
    console.log("✅ Passthrough for 'lo' alias works");
  } else {
    console.log("❌ Passthrough for 'lo' alias failed");
  }

  // 4. Test Model Listing
  const models = getModelsByProviderId("local");
  console.log("Default Local Models:", JSON.stringify(models, null, 2));
  if (models.length >= 3) {
    console.log("✅ Default models are registered");
  } else {
    console.log("❌ Default models registration failed");
  }

  console.log("--- Test Complete ---");
}

runTest().catch(console.error);
