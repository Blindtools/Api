// index.js
const { Client, LocalAuth, Buttons } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const express = require("express");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeData = null;
let clientReady = false;

app.use(bodyParser.urlencoded({ extended: true }));

// Home page with form
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>WhatsApp Bot</title>
        <style>
          body { font-family: Arial; padding: 30px; }
          input, textarea, button { padding: 10px; margin: 5px; font-size: 16px; width: 300px; }
        </style>
      </head>
      <body>
        <h2>✅ WhatsApp Bot is running!</h2>
        <p><a href="/qr">👉 Click here to view QR Code</a></p>
        
        <h3>Send Custom Button Message</h3>
        <form method="POST" action="/send">
          <label>WhatsApp Number (with country code, no +):</label><br/>
          <input type="text" name="number" placeholder="91XXXXXXXXXX" required><br/>

          <label>Message Text:</label><br/>
          <textarea name="message" placeholder="Type your message here..." required></textarea><br/>

          <label>Button 1:</label><br/>
          <input type="text" name="btn1" placeholder="Button 1" required><br/>

          <label>Button 2:</label><br/>
          <input type="text" name="btn2" placeholder="Button 2"><br/>

          <label>Button 3:</label><br/>
          <input type="text" name="btn3" placeholder="Button 3"><br/>

          <button type="submit">Send Message</button>
        </form>
      </body>
    </html>
  `);
});

// Show QR in browser
app.get("/qr", async (req, res) => {
  if (!qrCodeData) {
    return res.send("<h2>QR not generated yet. Please wait...</h2><meta http-equiv='refresh' content='5'>");
  }
  try {
    const qrImage = await qrcode.toDataURL(qrCodeData);
    res.send(`
      <html>
        <head>
          <title>WhatsApp QR</title>
          <meta http-equiv="refresh" content="10">
        </head>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
          <h2>Scan this QR with WhatsApp 📱</h2>
          <img src="${qrImage}" alt="QR Code"/>
          <p>Refreshes every 10s if new QR is generated.</p>
          <p><a href="/">⬅ Back to Home</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Error generating QR");
  }
});

// Handle sending custom button message
app.post("/send", async (req, res) => {
  if (!clientReady) {
    return res.send("<h2>❌ Client not ready. Please scan QR first.</h2>");
  }

  const number = req.body.number + "@c.us";
  const message = req.body.message;
  const buttons = [];

  if (req.body.btn1) buttons.push({ body: req.body.btn1 });
  if (req.body.btn2) buttons.push({ body: req.body.btn2 });
  if (req.body.btn3) buttons.push({ body: req.body.btn3 });

  if (buttons.length === 0) {
    return res.send("<h2>❌ Please enter at least one button.</h2>");
  }

  const buttonMessage = new Buttons(
    message,
    buttons,
    "Custom Menu",
    "Choose an option 👇"
  );

  try {
    await client.sendMessage(number, buttonMessage);
    res.send(`<h2>✅ Custom button message sent to ${req.body.number}</h2><p><a href="/">⬅ Back</a></p>`);
  } catch (err) {
    res.send(`<h2>❌ Failed to send message</h2><pre>${err}</pre><p><a href="/">⬅ Back</a></p>`);
  }
});

app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));

// WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  qrCodeData = qr;
  console.log("🔑 New QR received! Open /qr in browser to scan.");
});

client.on("ready", () => {
  clientReady = true;
  console.log("✅ WhatsApp client is ready!");
});

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

