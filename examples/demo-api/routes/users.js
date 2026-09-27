// examples/demo-api/routes/users.js
const router = require('express').Router();

// GET /api/users
router.get('/', (_req, res) => {
  res.json([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
});

// GET /api/users/:id
router.get('/:id', (req, res) => {
  res.json({ id: Number(req.params.id), name: 'Alice' });
});

// POST /api/users
router.post('/', (req, res) => {
  res.status(201).json({ id: 3, ...req.body });
});

// PUT /api/users/:id
router.put('/:id', (req, res) => {
  res.json({ id: Number(req.params.id), ...req.body });
});

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  res.status(204).send();
});

module.exports = router;
