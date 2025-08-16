import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import ollama from "ollama";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Root endpoint
app.get("/", (req, res) => {
  res.json({ message: "Welcome to Juned's Free AI API powered by Ollama + LLaMA3" });
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await ollama.chat({
      model: "llama3", // You can replace with mistral, gemma, etc.
      messages: [{ role: "user", content: userMessage }]
    });

    res.json({
      success: true,
      reply: response.message.content
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

