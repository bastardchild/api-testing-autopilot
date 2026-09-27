// examples/demo-api/client.js
// Client module — demonstrates axios client call extraction.
const axios = require('axios').default;

const BASE_URL = process.env.API_BASE || 'http://localhost:3000';

const client = axios.create({ baseURL: BASE_URL });

async function getUsers() {
  return client.get('/api/users');
}

async function getUser(id) {
  return client.get(`/api/users/${id}`);
}

async function createUser(data) {
  return client.post('/api/users', data);
}

async function getProducts() {
  return client.get('/api/products');
}

module.exports = { getUsers, getUser, createUser, getProducts };
