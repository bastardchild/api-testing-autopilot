// examples/demo-api/routes/products.js
const router = require('express').Router();

// GET /api/products
router.get('/', (_req, res) => {
  res.json([{ id: 1, name: 'Widget', price: 9.99 }]);
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  res.json({ id: Number(req.params.id), name: 'Widget', price: 9.99 });
});

// POST /api/products
router.post('/', (req, res) => {
  res.status(201).json({ id: 2, ...req.body });
});

module.exports = router;
