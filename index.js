import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import fs from "fs";
import { enhancedOCR, batchOCR } from "./ocr-utils.js";
import { advancedImageAnalysis, classifyImage, batchImageAnalysis, compareImages } from "./image-analysis.js";
import { 
  logger, 
  cache, 
  securityMiddleware, 
  rateLimiter, 
  strictRateLimiter,
  speedLimiter,
  requestLogger,
  apiKeyAuth,
  errorHandler,
  cacheMiddleware,
  asyncHandler,
  healthCheckCache,
  performanceMonitor
} from "./middleware.js";
import { generateApiDocs } from "./api-docs.js";

const app = express();

// Apply security middleware first
app.use(securityMiddleware);

// CORS configuration
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Request parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging and monitoring
app.use(requestLogger);
app.use(performanceMonitor);

// Rate limiting
app.use(rateLimiter);
app.use(speedLimiter);

// API key authentication (optional)
app.use(apiKeyAuth);

// Path fix for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';

// Helper function to call OpenAI API
async function callOpenAI(messages, model = 'gpt-3.5-turbo', maxTokens = 1000) {
  try {
    const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    logger.error('OpenAI API Error:', error);
    throw error;
  }
}

// Helper function to call OpenAI Vision API
async function callOpenAIVision(imageBase64, prompt, model = 'gpt-4-vision-preview') {
  try {
    const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI Vision API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    logger.error('OpenAI Vision API Error:', error);
    throw error;
  }
}

// API Documentation endpoint
app.get('/docs', cacheMiddleware(3600), (req, res) => {
  const docs = generateApiDocs();
  res.json(docs);
});

// Health check endpoint with caching
app.get('/health', asyncHandler(async (req, res) => {
  const cacheKey = 'health_check';
  let healthData = healthCheckCache.get(cacheKey);
  
  if (!healthData) {
    // Perform health checks
    const checks = {
      api: 'healthy',
      database: 'not_applicable',
      openai: OPENAI_API_KEY ? 'configured' : 'not_configured',
      cache: cache.keys().length >= 0 ? 'healthy' : 'error',
      disk_space: 'healthy', // Could add actual disk space check
      memory: process.memoryUsage().heapUsed < 1000000000 ? 'healthy' : 'warning' // 1GB threshold
    };
    
    healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      checks,
      endpoints: [
        'GET /health',
        'GET /docs',
        'POST /chat',
        'POST /ocr',
        'POST /ocr/advanced',
        'POST /ocr/batch',
        'POST /describe-image',
        'POST /analyze-image',
        'POST /classify-image',
        'POST /compare-images',
        'POST /batch-analyze',
        'GET /models',
        'GET /stats',
      ],
    };
    
    healthCheckCache.set(cacheKey, healthData);
  }
  
  res.json(healthData);
}));

// API statistics endpoint
app.get('/stats', cacheMiddleware(300), asyncHandler(async (req, res) => {
  const stats = {
    cache: {
      keys: cache.keys().length,
      stats: cache.getStats()
    },
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
  
  res.json(stats);
}));

// List available models with caching
app.get('/models', cacheMiddleware(3600), (req, res) => {
  res.json({
    chat_models: [
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4-turbo-preview',
    ],
    vision_models: [
      'gpt-4-vision-preview',
    ],
    ocr_models: [
      'gpt-4-vision-preview',
      'tesseract',
    ],
    ocr_languages: [
      'eng', 'spa', 'fra', 'deu', 'ita', 'por', 'rus', 'ara', 'chi_sim', 'chi_tra', 'jpn', 'kor'
    ],
    analysis_types: [
      'comprehensive', 'objects', 'scene', 'people', 'text_and_signs', 'technical', 'accessibility'
    ],
    comparison_types: [
      'general', 'similarity', 'objects', 'quality'
    ],
  });
});

// AI chat endpoint
app.post('/chat', asyncHandler(async (req, res) => {
  const { message, model } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  const messages = [
    {
      role: 'system',
      content: 'You are a helpful AI assistant called Blind Bulls Assistant. You provide accurate and helpful responses to user queries.',
    },
    {
      role: 'user',
      content: message,
    },
  ];

  const reply = await callOpenAI(messages, model || 'gpt-3.5-turbo');

  res.json({
    reply: reply,
    model: model || 'gpt-3.5-turbo',
    timestamp: new Date().toISOString(),
  });
}));

// Apply strict rate limiting to resource-intensive endpoints
app.use(['/ocr', '/analyze-image', '/classify-image', '/compare-images', '/batch-analyze'], strictRateLimiter);

// Basic OCR endpoint (OpenAI Vision)
app.post('/ocr', upload.single('image'), asyncHandler(async (req, res) => {
  const { model, language } = req.body;
  
  if (!req.file && !req.body.image_base64) {
    return res.status(400).json({ error: 'Image file or base64 image is required' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  let imageBase64;
  
  if (req.file) {
    // Read uploaded file and convert to base64
    const imageBuffer = fs.readFileSync(req.file.path);
    imageBase64 = imageBuffer.toString('base64');
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
  } else {
    // Use provided base64 image
    imageBase64 = req.body.image_base64.replace(/^data:image\/[a-z]+;base64,/, '');
  }

  const prompt = `Extract all text from this image. If the image contains text in ${language || 'any language'}, please transcribe it accurately. Maintain the original formatting and structure as much as possible. If no text is found, respond with "No text detected in the image."`;

  const extractedText = await callOpenAIVision(imageBase64, prompt);

  res.json({
    extracted_text: extractedText,
    model: model || 'gpt-4-vision-preview',
    language: language || 'auto-detect',
    timestamp: new Date().toISOString(),
  });
}));

// Advanced OCR endpoint with multiple providers and features
app.post('/ocr/advanced', upload.single('image'), asyncHandler(async (req, res) => {
  const { 
    provider = 'tesseract', 
    language = 'eng', 
    extract_tables = false,
    extract_structure = false,
    preprocess_image = true 
  } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required' });
  }

  const options = {
    provider,
    language,
    extractTables: extract_tables === 'true' || extract_tables === true,
    extractStructure: extract_structure === 'true' || extract_structure === true,
    preprocessImage: preprocess_image === 'true' || preprocess_image === true,
  };

  const result = await enhancedOCR(req.file.path, options);

  // Clean up uploaded file
  fs.unlinkSync(req.file.path);

  res.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}));

// Batch OCR endpoint
app.post('/ocr/batch', upload.array('images', 10), asyncHandler(async (req, res) => {
  const { 
    provider = 'tesseract', 
    language = 'eng', 
    extract_tables = false,
    extract_structure = false,
    preprocess_image = true 
  } = req.body;
  
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'At least one image file is required' });
  }

  const imagePaths = req.files.map(file => file.path);
  
  const options = {
    provider,
    language,
    extractTables: extract_tables === 'true' || extract_tables === true,
    extractStructure: extract_structure === 'true' || extract_structure === true,
    preprocessImage: preprocess_image === 'true' || preprocess_image === true,
  };

  const result = await batchOCR(imagePaths, options);

  // Clean up uploaded files
  req.files.forEach(file => {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });

  res.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}));

// Basic image description endpoint
app.post('/describe-image', upload.single('image'), asyncHandler(async (req, res) => {
  const { model, detail_level } = req.body;
  
  if (!req.file && !req.body.image_base64) {
    return res.status(400).json({ error: 'Image file or base64 image is required' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  let imageBase64;
  
  if (req.file) {
    // Read uploaded file and convert to base64
    const imageBuffer = fs.readFileSync(req.file.path);
    imageBase64 = imageBuffer.toString('base64');
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
  } else {
    // Use provided base64 image
    imageBase64 = req.body.image_base64.replace(/^data:image\/[a-z]+;base64,/, '');
  }

  let prompt;
  switch (detail_level) {
    case 'brief':
      prompt = 'Provide a brief, one-sentence description of this image.';
      break;
    case 'detailed':
      prompt = 'Provide a detailed description of this image, including objects, people, colors, setting, and any notable features or activities.';
      break;
    case 'accessibility':
      prompt = 'Provide an accessibility-focused description of this image that would be helpful for visually impaired users. Include all important visual information in a clear, structured way.';
      break;
    default:
      prompt = 'Describe this image in detail, including what you see, the setting, colors, objects, and any notable features.';
  }

  const description = await callOpenAIVision(imageBase64, prompt);

  res.json({
    description: description,
    model: model || 'gpt-4-vision-preview',
    detail_level: detail_level || 'standard',
    timestamp: new Date().toISOString(),
  });
}));

// Advanced image analysis endpoint
app.post('/analyze-image', upload.single('image'), asyncHandler(async (req, res) => {
  const { analysis_type = 'comprehensive', model, max_tokens, temperature } = req.body;
  
  if (!req.file && !req.body.image_base64) {
    return res.status(400).json({ error: 'Image file or base64 image is required' });
  }

  let imageBase64;
  
  if (req.file) {
    // Read uploaded file and convert to base64
    const imageBuffer = fs.readFileSync(req.file.path);
    imageBase64 = imageBuffer.toString('base64');
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
  } else {
    // Use provided base64 image
    imageBase64 = req.body.image_base64.replace(/^data:image\/[a-z]+;base64,/, '');
  }

  const options = {
    model: model || 'gpt-4-vision-preview',
    maxTokens: max_tokens ? parseInt(max_tokens) : 1500,
    temperature: temperature ? parseFloat(temperature) : 0.3,
  };

  const result = await advancedImageAnalysis(imageBase64, analysis_type, options);

  res.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}));

// Image classification endpoint
app.post('/classify-image', upload.single('image'), asyncHandler(async (req, res) => {
  const { categories, model, max_tokens, temperature } = req.body;
  
  if (!req.file && !req.body.image_base64) {
    return res.status(400).json({ error: 'Image file or base64 image is required' });
  }

  let imageBase64;
  
  if (req.file) {
    // Read uploaded file and convert to base64
    const imageBuffer = fs.readFileSync(req.file.path);
    imageBase64 = imageBuffer.toString('base64');
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
  } else {
    // Use provided base64 image
    imageBase64 = req.body.image_base64.replace(/^data:image\/[a-z]+;base64,/, '');
  }

  const categoryList = categories ? categories.split(',').map(c => c.trim()) : null;
  
  const options = {
    model: model || 'gpt-4-vision-preview',
    maxTokens: max_tokens ? parseInt(max_tokens) : 800,
    temperature: temperature ? parseFloat(temperature) : 0.1,
  };

  const result = await classifyImage(imageBase64, categoryList, options);

  res.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}));

// Image comparison endpoint
app.post('/compare-images', upload.array('images', 2), asyncHandler(async (req, res) => {
  const { comparison_type = 'general', model, max_tokens, temperature } = req.body;
  
  if (!req.files || req.files.length !== 2) {
    return res.status(400).json({ error: 'Exactly two image files are required' });
  }

  // Read and convert both images to base64
  const imageBuffer1 = fs.readFileSync(req.files[0].path);
  const imageBuffer2 = fs.readFileSync(req.files[1].path);
  const imageBase64_1 = imageBuffer1.toString('base64');
  const imageBase64_2 = imageBuffer2.toString('base64');

  // Clean up uploaded files
  req.files.forEach(file => {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });

  const options = {
    model: model || 'gpt-4-vision-preview',
    maxTokens: max_tokens ? parseInt(max_tokens) : 1200,
    temperature: temperature ? parseFloat(temperature) : 0.3,
  };

  const result = await compareImages(imageBase64_1, imageBase64_2, comparison_type, options);

  res.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}));

// Batch image analysis endpoint
app.post('/batch-analyze', upload.array('images', 10), asyncHandler(async (req, res) => {
  const { 
    analysis_type = 'comprehensive', 
    model, 
    max_tokens, 
    temperature,
    delay = 1000 
  } = req.body;
  
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'At least one image file is required' });
  }

  const imagePaths = req.files.map(file => file.path);
  
  const options = {
    model: model || 'gpt-4-vision-preview',
    maxTokens: max_tokens ? parseInt(max_tokens) : 1500,
    temperature: temperature ? parseFloat(temperature) : 0.3,
    delay: parseInt(delay),
  };

  const result = await batchImageAnalysis(imagePaths, analysis_type, options);

  // Clean up uploaded files
  req.files.forEach(file => {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });

  res.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}));

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available_endpoints: [
      'GET /health',
      'GET /docs',
      'POST /chat',
      'POST /ocr',
      'POST /ocr/advanced',
      'POST /ocr/batch',
      'POST /describe-image',
      'POST /analyze-image',
      'POST /classify-image',
      'POST /compare-images',
      'POST /batch-analyze',
      'GET /models',
      'GET /stats',
    ],
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Blind Bulls Assistant API v2.0 running on port ${PORT}`);
  logger.info(`📋 Health check: http://localhost:${PORT}/health`);
  logger.info(`📚 API Documentation: http://localhost:${PORT}/docs`);
  logger.info(`📊 Statistics: http://localhost:${PORT}/stats`);
  logger.info(`🤖 Available endpoints:`);
  logger.info(`   POST /chat - AI chat functionality`);
  logger.info(`   POST /ocr - Basic OCR with OpenAI Vision`);
  logger.info(`   POST /ocr/advanced - Advanced OCR with multiple providers`);
  logger.info(`   POST /ocr/batch - Batch OCR processing`);
  logger.info(`   POST /describe-image - Basic image description`);
  logger.info(`   POST /analyze-image - Advanced image analysis`);
  logger.info(`   POST /classify-image - Image classification`);
  logger.info(`   POST /compare-images - Compare two images`);
  logger.info(`   POST /batch-analyze - Batch image analysis`);
  logger.info(`   GET /models - List available models`);
});

export default server;

