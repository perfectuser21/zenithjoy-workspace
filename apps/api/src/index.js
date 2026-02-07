const express = require('express');
const cors = require('cors');
require('dotenv').config();

const platformDataRouter = require('./routes/platform-data');

const app = express();
const PORT = process.env.PORT || 5220;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/media/platform-data', platformDataRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'zenithjoy-api' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   API: http://localhost:${PORT}/api/media/platform-data/:platform`);
});
