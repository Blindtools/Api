import express from "express";
import dotenv from "dotenv";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { Client, LocalAuth, Buttons } from "whatsapp-web.js";

dotenv.config();

const app = express();
app.use(express.json());

/**
 * IMPORTANT for Render:
 * - Attach a Persistent Disk (e.g., 1 GB) mounted at /data
 * - LocalAuth dataPath points to /data so your session survives restarts/deploys
 * - Puppeteer must run headless with no-sandbox on Render
 */
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "bot",
    dataPath: process.env.SESSION_PATH || "/data"
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--no-zygote",
      "--disable-dev-shm-usage"
    ],
    // If you set CHROME_BIN on Render, we'll use it; otherwise Puppeteer’s Chromium
    executablePath: process.env.CHROME_BIN || null
  }
});

let lastQr = null;
let ready = false;

client.on("qr", async (qr) => {
  lastQr = qr;
  console.log("🔐 Scan this QR code with WhatsApp (also available at GET /qr):");
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("✅ Authenticated.");
});

client.on("ready", () => {
  ready = true;
  console.log("✅ WhatsApp client is ready!");
});

client.on("disconnected", (reason) => {
  ready = false;
  console.log("⚠️ Disconnected:", reason);
});

client.on("message", async (msg) => {
  // Basic demo replies to the buttons we’ll send
  if (msg.body === "📞 Call Me") {
    await msg.reply("📞 My number: +91 9876543210");
  } else if (msg.body === "🌐 Visit Website") {
    await msg.reply("🌐 https://blindtools.in");
  } else if (msg.body === "💬 Chat with Support") {
    await msg.reply("👨‍💻 Support will reach out shortly.");
  }
});

await client.initialize();

/* ---------- Express endpoints ---------- */

// Health/status
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    ready,
    hasQr: !!lastQr
  });
});

// Show QR as a PNG in the browser
app.get("/qr", async (req, res) => {
  if (!lastQr) return res.status(404).send("QR not available (already authenticated or still initializing).");
  try {
    const dataUrl = await QRCode.toDataURL(lastQr);
    const img = Buffer.from(dataUrl.split(",")[1], "base64");
    res.setHeader("Content-Type", "image/png");
    res.send(img);
  } catch (e) {
    res.status(500).send("Failed to render QR.");
  }
});

// Send a buttons message
/**
 * POST /send-buttons
 * {
 *   "to": "919876543210",        // E.164 without +, user => will be converted to 919...@c.us
 *   "isGroup": false,            // set true and pass groupId instead
 *   "groupId": "12345-67890@g.us",
 *   "title": "Blind Tools",
 *   "text": "Hello 👋, choose an option:",
 *   "footer": "Select one option 👇",
 *   "buttons": ["📞 Call Me", "🌐 Visit Website", "💬 Chat with Support"]
 * }
 */
app.post("/send-buttons", async (req, res) => {
  try {
    if (!ready) return res.status(503).json({ error: "WhatsApp client not ready yet." });

    const {
      to,
      isGroup = false,
      groupId,
      title = "Blind Tools",
      text = "Hello 👋, choose an option:",
      footer = "Select one option 👇",
      buttons = ["📞 Call Me", "🌐 Visit Website", "💬 Chat with Support"]
    } = req.body || {};

    const buttonObjs = buttons.map(b => ({ body: b }));
    const payload = new Buttons(text, buttonObjs, title, footer);

    let chatId;
    if (isGroup) {
      if (!groupId) return res.status(400).json({ error: "groupId required when isGroup=true" });
      chatId = groupId; // must be something like 1234567890-123456789@g.us
    } else {
      if (!to) return res.status(400).json({ error: "to is required" });
      // user number must be countrycode + number, no plus
      chatId = `${to}@c.us`;
    }

    const msg = await client.sendMessage(chatId, payload);
    res.json({ ok: true, id: msg.id.id });
  } catch (err) {
    console.error("send-buttons error:", err);
    res.status(500).json({ error: "Failed to send buttons", details: String(err) });
  }
});

// Optional: plain text
app.post("/send-text", async (req, res) => {
  try {
    if (!ready) return res.status(503).json({ error: "WhatsApp client not ready yet." });
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: "to and text are required" });
    const chatId = `${to}@c.us`;
    const msg = await client.sendMessage(chatId, text);
    res.json({ ok: true, id: msg.id.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to send text" });
  }
});

// Bind to Render's port
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

