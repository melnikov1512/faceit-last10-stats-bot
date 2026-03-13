require('dotenv').config();
const config = require('../config.json');

module.exports = {
  ...config,
  faceit_api_key: process.env.FACEIT_API_KEY || config.faceit_api_key
};
