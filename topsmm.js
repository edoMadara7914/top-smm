const axios = require("axios");
require("dotenv").config();

const API_URL = process.env.TOPSMM_API_URL;
const API_KEY = process.env.TOPSMM_API_KEY;

async function apiRequest(data) {
  const params = new URLSearchParams({
    key: API_KEY,
    ...data
  });

  const response = await axios.post(API_URL, params, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  return response.data;
}

async function getServices() {
  return await apiRequest({ action: "services" });
}

async function getBalance() {
  return await apiRequest({ action: "balance" });
}

async function addOrder(data) {
  return await apiRequest({
    action: "add",
    ...data
  });
}

async function getStatus(orderId) {
  return await apiRequest({
    action: "status",
    order: orderId
  });
}

async function refillOrder(orderId) {
  return await apiRequest({
    action: "refill",
    order: orderId
  });
}

async function cancelOrders(orderIds) {
  return await apiRequest({
    action: "cancel",
    orders: orderIds.join(",")
  });
}

module.exports = {
  getServices,
  getBalance,
  addOrder,
  getStatus,
  refillOrder,
  cancelOrders
};
