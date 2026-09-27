// examples/demo-api/server.js
// Primary demo target: Express REST API with no documentation.
// npm run demo:up — starts on port 3000.

const express = require('express');
const userRouter = require('./routes/users');
const productRouter = require('./routes/products');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Public routes
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Auth-protected routes
app.use('/api/users', authMiddleware, userRouter);
app.use('/api/products', productRouter);

app.listen(PORT, () => {
  console.log(`demo-api running on http://localhost:${PORT}`);
});

module.exports = app;
