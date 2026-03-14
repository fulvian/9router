const path = require("path");
const fs = require("fs");
const os = require("os");

const TARGET_HOSTS = ["cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com"];

/**
 * Generate self-signed SSL certificate using selfsigned (pure JS, no openssl needed)
 */
async function generateCert() {
  const certDir = path.join(os.homedir(), ".9router", "mitm");
  const keyPath = path.join(certDir, "server.key");
  const certPath = path.join(certDir, "server.crt");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log("✅ SSL certificate already exists");
    return { key: keyPath, cert: certPath };
  }

  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  const selfsigned = require("selfsigned");
  const attrs = [{ name: "commonName", value: TARGET_HOSTS[0] }];
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 1);
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: notAfter,
    extensions: [
      { 
        name: "subjectAltName", 
        altNames: TARGET_HOSTS.map(host => ({ type: 2, value: host }))
      }
    ]
  });

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);

  console.log(`✅ Generated SSL certificate for: ${TARGET_HOSTS.join(", ")}`);
  return { key: keyPath, cert: certPath };
}

module.exports = { generateCert };
