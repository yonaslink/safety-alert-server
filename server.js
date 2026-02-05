require("dotenv").config();
const express = require("express");
const cors = require("cors");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Telegram Bot Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error("❌ TELEGRAM_BOT_TOKEN not set in .env file!");
  process.exit(1);
}
const bot = new TelegramBot(botToken);

// In-memory storage (use MongoDB/PostgreSQL for production)
let safetyState = {
  deadline: null,
  timerDuration: 24 * 60 * 60 * 1000, // Default: 24 hours
  contacts: [],
  alertSentForCurrentDeadline: false,
  lastResetBy: null,
};

// ==================== API ROUTES ====================

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", serverTime: Date.now() });
});

// Get current timer state
app.get("/api/timer", (req, res) => {
  const now = Date.now();
  const timeLeft = safetyState.deadline ? safetyState.deadline - now : 0;

  res.json({
    deadline: safetyState.deadline,
    timeLeft: Math.max(0, timeLeft),
    timerDuration: safetyState.timerDuration,
    alertSent: safetyState.alertSentForCurrentDeadline,
    contacts: safetyState.contacts,
    lastResetBy: safetyState.lastResetBy,
  });
});

// Reset timer (your "I'm Alive!" button calls this)
app.post("/api/reset-timer", (req, res) => {
  const { duration, resetBy } = req.body;

  // ✅ OPTION 2: Use temporary duration for this reset only
  // Don't update safetyState.timerDuration unless explicitly changed via /api/timer-duration
  const effectiveDuration = duration || safetyState.timerDuration;

  safetyState.deadline = Date.now() + effectiveDuration;
  safetyState.alertSentForCurrentDeadline = false;
  safetyState.lastResetBy = resetBy || "Anonymous";

  console.log(`✅ Timer reset by ${safetyState.lastResetBy}`);
  console.log(`   Using duration: ${effectiveDuration / 60000} minutes`);
  console.log(`   Next deadline: ${new Date(safetyState.deadline)}`);

  res.json({
    success: true,
    deadline: safetyState.deadline,
    duration: effectiveDuration,
    message: "Timer reset successfully",
  });
});

// Update contacts
app.post("/api/contacts", (req, res) => {
  const { contacts } = req.body;
  if (!Array.isArray(contacts)) {
    return res.status(400).json({ error: "Contacts must be an array" });
  }
  safetyState.contacts = contacts;
  res.json({ success: true, count: contacts.length });
});

// Update timer duration
app.post("/api/timer-duration", (req, res) => {
  const { hours, minutes, seconds } = req.body;
  const duration = ((hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0)) * 1000;

  if (duration <= 0) {
    return res.status(400).json({ error: "Duration must be greater than 0" });
  }

  safetyState.timerDuration = duration;

  // If timer is active, extend the deadline proportionally
  if (safetyState.deadline) {
    const timeElapsed = Date.now() - (safetyState.deadline - safetyState.timerDuration);
    safetyState.deadline = Date.now() + safetyState.timerDuration - timeElapsed;
  }

  res.json({
    success: true,
    duration: safetyState.timerDuration,
    message: `Timer duration set to ${hours}h ${minutes}m ${seconds}s`,
  });
});

// Manual emergency alert (optional: for testing)
app.post("/api/send-alert", (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  sendAlertToContacts(message)
    .then(() => res.json({ success: true, message: "Alert sent" }))
    .catch((err) => res.status(500).json({ error: err.message }));
});

// ==================== AUTO-ALERT LOGIC ====================

async function sendAlertToContacts(message) {
  const contacts = safetyState.contacts.filter((c) => c.chatId);

  if (contacts.length === 0) {
    console.log("⚠️ No contacts with Telegram Chat IDs");
    return { sent: 0, failed: 0 };
  }

  console.log(`🚨 SENDING ALERT TO ${contacts.length} CONTACTS`);
  console.log("Message:", message);

  let sent = 0;
  let failed = 0;

  for (const contact of contacts) {
    try {
      await bot.sendMessage(contact.chatId, message);
      console.log(`✅ Sent to ${contact.name} (${contact.chatId})`);
      sent++;
    } catch (err) {
      console.error(`❌ Failed to send to ${contact.name}:`, err.message);
      failed++;
    }
  }

  return { sent, failed, total: contacts.length };
}

function checkTimer() {
  const now = Date.now();

  if (!safetyState.deadline) {
    // Timer not set yet
    return;
  }

  if (now >= safetyState.deadline && !safetyState.alertSentForCurrentDeadline) {
    console.log("⏰ TIMER EXPIRED! Sending alert...");

    safetyState.alertSentForCurrentDeadline = true;

    // Get message from contacts (or use default)
    const defaultMessage = `🚨 SAFETY CHECK-IN MISSED!\n\nምናልባት ችግር አጋጥሞኝ ሊሆን ስለሚችል እባክዎን ደውለው ደኅንነቴን ያረጋግጡ፡፡`;

    sendAlertToContacts(defaultMessage).then((result) => {
      console.log(`📊 Alert results: ${result.sent}/${result.total} sent, ${result.failed} failed`);

      // Auto-reset timer for next cycle (recurring alerts)
      setTimeout(() => {
        safetyState.deadline = Date.now() + safetyState.timerDuration;
        safetyState.alertSentForCurrentDeadline = false;
        console.log(`🔄 Timer auto-reset. Next deadline: ${new Date(safetyState.deadline)}`);
      }, 1000);
    });
  }
}

// Run check every 30 seconds
setInterval(checkTimer, 30000);

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`🚀 Safety Alert Server running on port ${PORT}`);
  console.log(`⏰ Auto-check interval: 30 seconds`);

  // Initialize first deadline (optional: remove if you want user to set it)
  safetyState.deadline = Date.now() + safetyState.timerDuration;
  console.log(`⏱️ Initial timer set: ${safetyState.timerDuration / 60000} minutes`);
  console.log(`   Deadline: ${new Date(safetyState.deadline)}`);
});
