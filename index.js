const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const dotenv = require("dotenv");
const db = require("./db");

const {
  getServices,
  addOrder,
  getStatus,
  refillOrder,
  cancelOrders
} = require("./topsmm");

const {
  sendMessage,
  sendPhoto,
  sendDocument,
  mainKeyboard,
  paymentKeyboard
} = require("./telegram");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CHAT_ID = String(process.env.TELEGRAM_ADMIN_ID || "");

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false
}));

function auth(req, res, next) {
  if (!req.session.admin) return res.redirect("/login");
  next();
}

function getUser(chatId) {
  return db.prepare("SELECT * FROM telegram_users WHERE chat_id = ?").get(String(chatId));
}

function createOrUpdateUser(msg) {
  const chatId = String(msg.chat.id);
  const from = msg.from || {};
  const exists = getUser(chatId);

  if (!exists) {
    db.prepare(`
      INSERT INTO telegram_users (chat_id, username, first_name, last_name, balance, step, state)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      chatId,
      from.username || "",
      from.first_name || "",
      from.last_name || "",
      0,
      "",
      "{}"
    );
  } else {
    db.prepare(`
      UPDATE telegram_users
      SET username = ?, first_name = ?, last_name = ?
      WHERE chat_id = ?
    `).run(
      from.username || "",
      from.first_name || "",
      from.last_name || "",
      chatId
    );
  }
}

function setStep(chatId, step, state = {}) {
  db.prepare(`
    UPDATE telegram_users
    SET step = ?, state = ?
    WHERE chat_id = ?
  `).run(step, JSON.stringify(state), String(chatId));
}

function getState(chatId) {
  const user = getUser(chatId);
  try {
    return user?.state ? JSON.parse(user.state) : {};
  } catch {
    return {};
  }
}

async function syncServicesToDb() {
  const services = await getServices();
  if (!Array.isArray(services)) return 0;

  db.prepare("DELETE FROM categories").run();
  db.prepare("DELETE FROM services").run();

  const categories = [...new Set(services.map(s => s.category).filter(Boolean))];

  for (const cat of categories) {
    db.prepare("INSERT INTO categories (name) VALUES (?)").run(cat);
  }

  for (const s of services) {
    db.prepare(`
      INSERT INTO services
      (provider_service_id, category_name, name, rate, min, max, refill, cancel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(s.service),
      s.category || "Boshqa",
      s.name || "",
      parseFloat(s.rate || 0),
      parseInt(s.min || 1),
      parseInt(s.max || 1),
      s.refill ? 1 : 0,
      s.cancel ? 1 : 0
    );
  }

  return services.length;
}

function formatUserName(user) {
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  return fullName || user.username || "Noma'lum";
}

app.get("/", (req, res) => {
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.admin = true;
    return res.redirect("/dashboard");
  }

  res.send("Login xato");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/dashboard", auth, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) as count FROM telegram_users").get();
  const services = db.prepare("SELECT COUNT(*) as count FROM services").get();
  const orders = db.prepare("SELECT COUNT(*) as count FROM orders").get();
  const payments = db.prepare("SELECT COUNT(*) as count FROM payments").get();

  res.render("dashboard", { users, services, orders, payments });
});

app.get("/users", auth, (req, res) => {
  const users = db.prepare("SELECT * FROM telegram_users ORDER BY id DESC").all();
  res.render("users", { users });
});

app.post("/users/:chatId/balance", auth, (req, res) => {
  const chatId = String(req.params.chatId);
  const amount = parseFloat(req.body.amount || 0);

  if (!amount || amount <= 0) return res.send("Noto'g'ri summa");

  db.prepare(`
    UPDATE telegram_users
    SET balance = balance + ?
    WHERE chat_id = ?
  `).run(amount, chatId);

  db.prepare(`
    INSERT INTO wallet_transactions (chat_id, amount, type, note)
    VALUES (?, ?, ?, ?)
  `).run(chatId, amount, "deposit", "Admin panel orqali to'ldirildi");

  res.redirect("/users");
});

app.get("/services", auth, (req, res) => {
  const services = db.prepare("SELECT * FROM services ORDER BY id DESC LIMIT 300").all();
  res.render("services", { services });
});

app.post("/services/sync", auth, async (req, res) => {
  try {
    await syncServicesToDb();
    res.redirect("/services");
  } catch (e) {
    res.send("Sync xatolik: " + e.message);
  }
});

app.get("/orders", auth, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 300").all();
  res.render("orders", { orders });
});

app.post("/orders/:id/refill", auth, async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.send("Order topilmadi");

  try {
    const response = await refillOrder(order.provider_order_id);

    db.prepare(`
      INSERT INTO order_logs (order_id, action, response)
      VALUES (?, ?, ?)
    `).run(order.id, "refill", JSON.stringify(response));

    res.redirect("/orders");
  } catch (e) {
    res.send("Refill xatolik: " + e.message);
  }
});

app.post("/orders/:id/cancel", auth, async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.send("Order topilmadi");

  try {
    const response = await cancelOrders([order.provider_order_id]);

    db.prepare(`
      INSERT INTO order_logs (order_id, action, response)
      VALUES (?, ?, ?)
    `).run(order.id, "cancel", JSON.stringify(response));

    res.redirect("/orders");
  } catch (e) {
    res.send("Cancel xatolik: " + e.message);
  }
});

app.get("/payments", auth, (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, u.username, u.first_name, u.last_name
    FROM payments p
    LEFT JOIN telegram_users u ON u.chat_id = p.chat_id
    ORDER BY p.id DESC
    LIMIT 300
  `).all();

  res.render("payments", { payments });
});

app.post("/payments/:id/approve", auth, (req, res) => {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
  if (!payment) return res.send("Payment topilmadi");

  const amount = parseFloat(req.body.amount || 0);
  if (!amount || amount <= 0) return res.send("Summa noto'g'ri");

  db.prepare(`
    UPDATE telegram_users
    SET balance = balance + ?
    WHERE chat_id = ?
  `).run(amount, payment.chat_id);

  db.prepare(`
    INSERT INTO wallet_transactions (chat_id, amount, type, note)
    VALUES (?, ?, ?, ?)
  `).run(payment.chat_id, amount, "deposit", "Chek tasdiqlandi");

  db.prepare(`
    UPDATE payments
    SET amount = ?, status = 'approved', admin_note = ?
    WHERE id = ?
  `).run(amount, "Admin tasdiqladi", payment.id);

  sendMessage(payment.chat_id, `To'lov chekingiz tasdiqlandi.\nBalansga qo'shildi: ${amount}`, mainKeyboard())
    .catch(console.error);

  res.redirect("/payments");
});

app.post("/payments/:id/reject", auth, (req, res) => {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
  if (!payment) return res.send("Payment topilmadi");

  const note = req.body.note || "To'lov rad etildi";

  db.prepare(`
    UPDATE payments
    SET status = 'rejected', admin_note = ?
    WHERE id = ?
  `).run(note, payment.id);

  sendMessage(payment.chat_id, `To'lov chekingiz rad etildi.\nSabab: ${note}`, mainKeyboard())
    .catch(console.error);

  res.redirect("/payments");
});

app.post("/telegram/webhook", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg) return res.sendStatus(200);

    const hasText = !!msg.text;
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const hasDocument = !!msg.document;

    createOrUpdateUser(msg);

    const chatId = String(msg.chat.id);
    const user = getUser(chatId);
    const state = getState(chatId);

    if (!user) return res.sendStatus(200);

    if (hasPhoto || hasDocument) {
      if (user.step === "waiting_manual_receipt") {
        let fileId = null;
        let receiptType = null;

        if (hasPhoto) {
          fileId = msg.photo[msg.photo.length - 1].file_id;
          receiptType = "photo";
        } else if (hasDocument) {
          fileId = msg.document.file_id;
          receiptType = "document";
        }

        const paymentResult = db.prepare(`
          INSERT INTO payments (chat_id, method, receipt_file_id, receipt_type, status)
          VALUES (?, ?, ?, ?, ?)
        `).run(chatId, "card2card", fileId, receiptType, "pending");

        const paymentId = paymentResult.lastInsertRowid;
        const userName = formatUserName(user);
        const adminCaption =
          `Yangi to'lov cheki\n\n` +
          `Payment ID: ${paymentId}\n` +
          `User: ${userName}\n` +
          `Username: @${user.username || "yo'q"}\n` +
          `Chat ID: ${chatId}\n` +
          `Usul: Kartadan kartaga\n` +
          `Status: pending`;

        if (ADMIN_CHAT_ID) {
          if (receiptType === "photo") {
            await sendPhoto(ADMIN_CHAT_ID, fileId, adminCaption);
          } else {
            await sendDocument(ADMIN_CHAT_ID, fileId, adminCaption);
          }
        }

        await sendMessage(
          chatId,
          "Chekingiz qabul qilindi.\nAdmin tekshiradi va balansingizga qo‘shadi.",
          mainKeyboard()
        );

        setStep(chatId, "");
        return res.sendStatus(200);
      }

      await sendMessage(chatId, "Avval menyudan kerakli bo‘limni tanlang.", mainKeyboard());
      return res.sendStatus(200);
    }

    if (!hasText) return res.sendStatus(200);

    const text = msg.text.trim();

    if (text === "/start") {
      setStep(chatId, "");
      await sendMessage(chatId, "Salom. Menyudan tanlang.", mainKeyboard());
      return res.sendStatus(200);
    }

    if (text === "⬅️ Orqaga") {
      setStep(chatId, "");
      await sendMessage(chatId, "Asosiy menyu", mainKeyboard());
      return res.sendStatus(200);
    }

    if (text === "💰 Balans") {
      await sendMessage(chatId, `Balansingiz: ${user.balance}`, mainKeyboard());
      return res.sendStatus(200);
    }

    if (text === "📞 Yordam") {
      await sendMessage(
        chatId,
        "Buyruqlar:\n/start\nstatus ORDER_ID\nrefill ORDER_ID\ncancel ORDER_ID",
        mainKeyboard()
      );
      return res.sendStatus(200);
    }

    if (text === "💳 Balans to‘ldirish") {
      setStep(chatId, "choose_payment_method");
      await sendMessage(chatId, "To‘lov usulini tanlang:", paymentKeyboard());
      return res.sendStatus(200);
    }

    if (text === "💳 Kartadan kartaga") {
      setStep(chatId, "waiting_manual_receipt", { method: "card2card" });

      const owner = process.env.CARD_OWNER || "ISM FAMILYA";
      const card = process.env.CARD_NUMBER || "8600 XXXX XXXX XXXX";

      const infoText =
        `💳 Kartadan kartaga to‘lov\n\n` +
        `Karta egasi: ${owner}\n` +
        `Karta raqami: ${card}\n\n` +
        `To‘lov qilib bo‘lgach, alohida to‘lov chekini shu yerga yuboring.`;

      await sendMessage(chatId, infoText, {
        reply_markup: {
          keyboard: [[{ text: "⬅️ Orqaga" }]],
          resize_keyboard: true
        }
      });

      return res.sendStatus(200);
    }

    if (text === "💠 Click") {
      setStep(chatId, "click_info");

      await sendMessage(
        chatId,
        process.env.CLICK_PAYMENT_TEXT || "Click to‘lov tizimi keyin ulanadi.",
        {
          reply_markup: {
            keyboard: [[{ text: "⬅️ Orqaga" }]],
            resize_keyboard: true
          }
        }
      );
      return res.sendStatus(200);
    }

    if (text === "📦 Buyurtmalarim") {
      const orders = db.prepare(`
        SELECT * FROM orders
        WHERE chat_id = ?
        ORDER BY id DESC
        LIMIT 10
      `).all(chatId);

      if (!orders.length) {
        await sendMessage(chatId, "Buyurtmalar yo'q.", mainKeyboard());
      } else {
        let out = "Oxirgi buyurtmalar:\n\n";
        for (const o of orders) {
          out += `#${o.id} | ${o.service_name}\nStatus: ${o.status}\nQty: ${o.quantity}\n\n`;
        }
        out += "Status ko'rish: status ID";
        await sendMessage(chatId, out, mainKeyboard());
      }
      return res.sendStatus(200);
    }

    if (text === "🛒 Buyurtma berish") {
      const categories = db.prepare(`
        SELECT * FROM categories
        ORDER BY name ASC
        LIMIT 40
      `).all();

      if (!categories.length) {
        await sendMessage(chatId, "Servislar hali yuklanmagan.", mainKeyboard());
        return res.sendStatus(200);
      }

      const keyboard = {
        reply_markup: {
          keyboard: [
            ...categories.map(c => [{ text: c.name }]),
            [{ text: "⬅️ Orqaga" }]
          ],
          resize_keyboard: true
        }
      };

      setStep(chatId, "choose_category");
      await sendMessage(chatId, "Kategoriyani tanlang:", keyboard);
      return res.sendStatus(200);
    }

    if (user.step === "choose_category") {
      const category = db.prepare("SELECT * FROM categories WHERE name = ?").get(text);
      if (!category) {
        await sendMessage(chatId, "Kategoriya topilmadi.");
        return res.sendStatus(200);
      }

      const services = db.prepare(`
        SELECT * FROM services
        WHERE category_name = ?
        ORDER BY id ASC
        LIMIT 30
      `).all(category.name);

      const keyboard = {
        reply_markup: {
          keyboard: [
            ...services.map(s => [{ text: s.name.slice(0, 80) }]),
            [{ text: "⬅️ Orqaga" }]
          ],
          resize_keyboard: true
        }
      };

      setStep(chatId, "choose_service", { category_name: category.name });
      await sendMessage(chatId, "Servisni tanlang:", keyboard);
      return res.sendStatus(200);
    }

    if (user.step === "choose_service") {
      const service = db.prepare("SELECT * FROM services WHERE name = ?").get(text);
      if (!service) {
        await sendMessage(chatId, "Servis topilmadi.");
        return res.sendStatus(200);
      }

      setStep(chatId, "enter_link", { service_id: service.id });
      await sendMessage(chatId, "Link yuboring:");
      return res.sendStatus(200);
    }

    if (user.step === "enter_link") {
      setStep(chatId, "enter_quantity", { ...state, link: text });
      await sendMessage(chatId, "Quantity yuboring:");
      return res.sendStatus(200);
    }

    if (user.step === "enter_quantity") {
      const quantity = parseInt(text);
      if (!quantity || quantity < 1) {
        await sendMessage(chatId, "Quantity noto'g'ri.");
        return res.sendStatus(200);
      }

      const service = db.prepare("SELECT * FROM services WHERE id = ?").get(state.service_id);
      if (!service) {
        await sendMessage(chatId, "Servis topilmadi.");
        return res.sendStatus(200);
      }

      if (quantity < service.min || quantity > service.max) {
        await sendMessage(chatId, `Min ${service.min}, Max ${service.max}`);
        return res.sendStatus(200);
      }

      const price = (service.rate / 1000) * quantity;

      setStep(chatId, "confirm_order", {
        ...state,
        quantity,
        price
      });

      await sendMessage(
        chatId,
        `Servis: ${service.name}\nLink: ${state.link}\nQuantity: ${quantity}\nNarx: ${price}\n\nTasdiqlash uchun: HA`
      );
      return res.sendStatus(200);
    }

    if (user.step === "confirm_order") {
      if (text !== "HA") {
        await sendMessage(chatId, "Bekor qilindi.", mainKeyboard());
        setStep(chatId, "");
        return res.sendStatus(200);
      }

      const service = db.prepare("SELECT * FROM services WHERE id = ?").get(state.service_id);
      const price = parseFloat(state.price || 0);

      if (!service) {
        await sendMessage(chatId, "Servis topilmadi.", mainKeyboard());
        setStep(chatId, "");
        return res.sendStatus(200);
      }

      if (parseFloat(user.balance) < price) {
        await sendMessage(chatId, "Balans yetarli emas.", mainKeyboard());
        setStep(chatId, "");
        return res.sendStatus(200);
      }

      const response = await addOrder({
        service: service.provider_service_id,
        link: state.link,
        quantity: state.quantity
      });

      if (!response.order) {
        await sendMessage(chatId, "Order xatolik: " + (response.error || "noma'lum"), mainKeyboard());
        setStep(chatId, "");
        return res.sendStatus(200);
      }

      db.prepare(`
        UPDATE telegram_users
        SET balance = balance - ?
        WHERE chat_id = ?
      `).run(price, chatId);

      db.prepare(`
        INSERT INTO wallet_transactions (chat_id, amount, type, note)
        VALUES (?, ?, ?, ?)
      `).run(chatId, price, "withdraw", "Order uchun yechildi");

      db.prepare(`
        INSERT INTO orders
        (chat_id, service_id, provider_order_id, service_name, link, quantity, price, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        chatId,
        service.id,
        String(response.order),
        service.name,
        state.link,
        state.quantity,
        price,
        "Pending"
      );

      setStep(chatId, "");
      await sendMessage(chatId, `Buyurtma yaratildi.\nProvider order ID: ${response.order}`, mainKeyboard());
      return res.sendStatus(200);
    }

    if (text === "♻️ Refill") {
      await sendMessage(chatId, "Refill uchun: refill ORDER_ID", mainKeyboard());
      return res.sendStatus(200);
    }

    if (text === "❌ Cancel") {
      await sendMessage(chatId, "Cancel uchun: cancel ORDER_ID", mainKeyboard());
      return res.sendStatus(200);
    }

    if (text.startsWith("refill ")) {
      const localId = text.split(" ")[1];
      const order = db.prepare(`
        SELECT * FROM orders
        WHERE id = ? AND chat_id = ?
      `).get(localId, chatId);

      if (!order) {
        await sendMessage(chatId, "Order topilmadi.", mainKeyboard());
        return res.sendStatus(200);
      }

      const response = await refillOrder(order.provider_order_id);

      db.prepare(`
        INSERT INTO order_logs (order_id, action, response)
        VALUES (?, ?, ?)
      `).run(order.id, "refill", JSON.stringify(response));

      await sendMessage(chatId, "Refill javobi:\n" + JSON.stringify(response), mainKeyboard());
      return res.sendStatus(200);
    }

    if (text.startsWith("cancel ")) {
      const localId = text.split(" ")[1];
      const order = db.prepare(`
        SELECT * FROM orders
        WHERE id = ? AND chat_id = ?
      `).get(localId, chatId);

      if (!order) {
        await sendMessage(chatId, "Order topilmadi.", mainKeyboard());
        return res.sendStatus(200);
      }

      const response = await cancelOrders([order.provider_order_id]);

      db.prepare(`
        INSERT INTO order_logs (order_id, action, response)
        VALUES (?, ?, ?)
      `).run(order.id, "cancel", JSON.stringify(response));

      await sendMessage(chatId, "Cancel javobi:\n" + JSON.stringify(response), mainKeyboard());
      return res.sendStatus(200);
    }

    if (text.startsWith("status ")) {
      const localId = text.split(" ")[1];
      const order = db.prepare(`
        SELECT * FROM orders
        WHERE id = ? AND chat_id = ?
      `).get(localId, chatId);

      if (!order) {
        await sendMessage(chatId, "Order topilmadi.", mainKeyboard());
        return res.sendStatus(200);
      }

      const response = await getStatus(order.provider_order_id);

      db.prepare(`
        UPDATE orders
        SET status = ?, charge = ?, start_count = ?, remains = ?, currency = ?
        WHERE id = ?
      `).run(
        response.status || order.status,
        response.charge || "",
        response.start_count || "",
        response.remains || "",
        response.currency || "",
        order.id
      );

      await sendMessage(
        chatId,
        `Status: ${response.status || "-"}\nCharge: ${response.charge || "-"}\nRemains: ${response.remains || "-"}`,
        mainKeyboard()
      );
      return res.sendStatus(200);
    }

    await sendMessage(chatId, "Noto'g'ri buyruq. /start bosing.", mainKeyboard());
    return res.sendStatus(200);

  } catch (e) {
    console.error(e);
    return res.sendStatus(200);
  }
});

app.listen(PORT, async () => {
  console.log(`Server started on ${PORT}`);
});
