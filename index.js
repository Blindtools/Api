import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

// Path fix for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// AI chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    // Example: Call local Ollama (replace with your model endpoint)
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3",
        messages: [{ role: "user", content: userMessage }]
      })
    });

    const data = await response.json();

    res.json({ reply: data.message?.content || "No response" });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

// Render auto port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Blind Bulls Assistant running on port ${PORT}`);
});

