// index.js
const { Client, LocalAuth, Buttons } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");

// Express server for Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("✅ WhatsApp Bot is running!"));
app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));

// WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// Show QR in terminal for first-time login
client.on("qr", (qr) => {
  console.log("🔑 Scan this QR Code to log in:");
  qrcode.generate(qr, { small: true });
});

// Ready
client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
  
  // Example: send a button message after startup
  const number = "91XXXXXXXXXX@c.us"; // replace with target number
  const button = new Buttons(
    "Hello! 👋 Please choose an option:",
    [{ body: "📞 Call Me" }, { body: "🌐 Visit Website" }],
    "Main Menu",
    "Select below 👇"
  );

  client.sendMessage(number, button);
});

// Reply when receiving a message
client.on("message", async (msg) => {
  if (msg.body.toLowerCase() === "menu") {
    const button = new Buttons(
      "Choose one option:",
      [{ body: "🔔 Notifications" }, { body: "📊 Stats" }],
      "Bot Menu",
      "Pick your choice 👇"
    );
    client.sendMessage(msg.from, button);
  }
});

client.initialize();

