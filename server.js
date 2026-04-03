const express = require("express");
const fs = require("fs");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const CRITICAL_HR = 120;
const CRITICAL_SPO2 = 90;
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();
const GROQ_MODEL = (process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();

const MAIL_USER = process.env.MAIL_USER || "";
const MAIL_PASS = process.env.MAIL_PASS || "";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const transporter = MAIL_USER && MAIL_PASS
  ? nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: MAIL_USER,
      pass: MAIL_PASS
    }
  })
  : null;

function ensureSupabase(res) {
  if (!supabase) {
    if (res) {
      res.status(500).json({ success: false, message: "Supabase is not configured" });
    }
    return false;
  }
  return true;
}

function sendCriticalEmail(patient, entry) {
  if (!transporter || !patient || !patient.email) return;

  const toList = [];
  const doctorEmail = String(patient.doctorEmail || "").trim();
  const patientEmail = String(patient.email || "").trim();

  if (doctorEmail) toList.push(doctorEmail);
  if (patientEmail && patientEmail.toLowerCase() !== doctorEmail.toLowerCase()) {
    toList.push(patientEmail);
  }
  if (!toList.length) return;

  transporter.sendMail({
    to: toList.join(","),
    subject: "Patient Alert",
    text: `Critical alert for ${patient.name}.\nWatch ID: ${entry.watchID || "-"}\nHR: ${entry.hr}, SpO2: ${entry.spo2}, Steps: ${entry.steps}`
  }).catch((error) => {
    console.error("Email send failed:", error.message);
  });
}

function readJSON(path) {
  if (!fs.existsSync(path)) return {};
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

async function insertReminder({ watch_id, medicine_name, time, repeat_days, doctor_email }) {
  const payload = {
    watch_id,
    medicine_name,
    time,
    repeat_days,
    doctor_email
  };

  const { error } = await supabase.from("reminders").insert([payload]);
  if (error) {
    throw new Error(error.message || "Supabase insert failed");
  }
}

async function fetchRemindersList(watch_id) {
  const { data, error } = await supabase
    .from("reminders")
    .select("watch_id, medicine_name, time, repeat_days, doctor_email, created_at")
    .eq("watch_id", watch_id)
    .order("time", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(error.message || "Supabase fetch failed");
  }

  return Array.isArray(data) ? data : [];
}

async function fetchReadings(watchID) {
  const safeWatchID = String(watchID || "").trim().toUpperCase();
  if (!safeWatchID) return [];

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("readings")
        .select("watchID, hr, spo2, steps, status, time")
        .eq("watchID", safeWatchID)
        .order("time", { ascending: true })
        .limit(500);

      if (!error && Array.isArray(data)) {
        return data;
      }

      if (error) {
        console.error("Supabase fetch failed:", error.message);
      }
    } catch (err) {
      console.error("Supabase fetch exception:", err.message);
    }
  }

  // Fallback to local JSON storage
  const readings = readJSON("./data/readings.json");
  const key = findCaseInsensitiveKey(readings, safeWatchID);
  return (key && readings[key]) || [];
}

function findCaseInsensitiveKey(obj, key) {
  const target = String(key || "").trim().toLowerCase();
  if (!target) return null;
  const keys = Object.keys(obj || {});
  for (const item of keys) {
    if (String(item).toLowerCase() === target) return item;
  }
  return null;
}

function isWatchOwnedByAnotherDoctor(existingEntry, doctorEmail) {
  return existingEntry && existingEntry.doctorEmail && existingEntry.doctorEmail !== doctorEmail;
}

function isCriticalReading(reading) {
  if (!reading) return false;
  const hr = Number(reading.hr);
  const spo2 = Number(reading.spo2);
  const status = String(reading.status || "").toLowerCase();
  return hr > CRITICAL_HR || spo2 < CRITICAL_SPO2 || status.includes("critical");
}

async function askGroq(question, contextText, role) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const systemPrompt = role === "doctor"
    ? "You are a concise clinical assistant for doctors. Use the provided patient data only. Give practical guidance and mention uncertainty when needed. Keep responses under 8 lines."
    : "You are a supportive health assistant for patients. Use simple language, avoid diagnosis claims, and advise contacting doctor/emergency for severe values. Keep responses under 8 lines.";

  const modelsToTry = [GROQ_MODEL, "llama-3.1-8b-instant"];
  let lastError = "";

  for (const modelName of modelsToTry) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Context:\n${contextText}\n\nQuestion:\n${question}` }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      lastError = `Groq error ${response.status}: ${body}`;
      if (response.status === 404) {
        continue;
      }
      throw new Error(lastError);
    }

    const data = await response.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "No response from AI.";

    return text;
  }

  throw new Error(lastError || "Groq model request failed");
}

app.get("/update", async (req, res) => {
  const { watchID, hr, spo2, steps, status } = req.query;
  const safeWatchID = String(watchID || "").trim().toUpperCase();

  if (!safeWatchID) {
    return res.status(400).send("watchID is required");
  }

  const entry = {
    hr: Number(hr) || 0,
    spo2: Number(spo2) || 0,
    steps: Number(steps) || 0,
    status: String(status || "normal"),
    time: new Date().toISOString()
  };

  // skip local file write if it fails (Render has read-only filesystem)
  try {
    const readings = readJSON("./data/readings.json");
    if (!readings[safeWatchID]) readings[safeWatchID] = [];
    readings[safeWatchID].push(entry);
    writeJSON("./data/readings.json", readings);
  } catch(e) {
    console.log("Local write skipped:", e.message);
  }

  if (supabase) {
    const { error } = await supabase.from("readings").insert([
      {
        watchID: safeWatchID,
        hr: entry.hr,
        spo2: entry.spo2,
        steps: entry.steps,
        status: entry.status,
        time: entry.time
      }
    ]);

    if (error) {
      console.error("Supabase insert failed:", error.message);
      return res.status(500).send("Supabase error");
    }
  }

  const patients = readJSON("./data/patients.json");
  if (isCriticalReading(entry)) {
    const patient = patients[safeWatchID];
    sendCriticalEmail(patient, { ...entry, watchID: safeWatchID });
  }

  res.send("Data stored");
});

app.get("/data/:watchID", async (req, res) => {
  const safeWatchID = String(req.params.watchID || "").trim();
  const data = await fetchReadings(safeWatchID);
  res.json(data);
});

app.post("/addPatient", (req, res) => {
  const { watchID, name, email, doctorEmail, age, condition, phone } = req.body;

  const safeWatchID = String(watchID || "").trim().toUpperCase();
  const safeName = String(name || "").trim();
  const safeEmail = String(email || "").trim();
  const safeDoctorEmail = String(doctorEmail || "").trim();

  if (!safeWatchID || !safeName || !safeEmail || !safeDoctorEmail) {
    return res.status(400).json({ success: false, message: "Watch ID, patient name, email and doctor are required" });
  }

  const patients = readJSON("./data/patients.json");

  const existingKey = findCaseInsensitiveKey(patients, safeWatchID);
  const saveKey = existingKey || safeWatchID;

  if (isWatchOwnedByAnotherDoctor(existingKey ? patients[existingKey] : null, safeDoctorEmail)) {
    return res.status(403).json({ success: false, message: "Watch is linked to another doctor" });
  }

  patients[saveKey] = {
    name: safeName,
    email: safeEmail,
    doctorEmail: safeDoctorEmail,
    age: String(age || "").trim(),
    condition: String(condition || "").trim(),
    phone: String(phone || "").trim()
  };

  writeJSON("./data/patients.json", patients);
  res.json({ success: true, message: "Watch linked successfully" });
});

app.put("/updatePatient", (req, res) => {
  const { watchID, name, email, doctorEmail, age, condition, phone } = req.body;

  const safeWatchID = String(watchID || "").trim().toUpperCase();
  const safeName = String(name || "").trim();
  const safeEmail = String(email || "").trim();
  const safeDoctorEmail = String(doctorEmail || "").trim();

  if (!safeWatchID || !safeName || !safeEmail || !safeDoctorEmail) {
    return res.status(400).json({ success: false, message: "Watch ID, patient name, email and doctor are required" });
  }

  const patients = readJSON("./data/patients.json");
  const existingKey = findCaseInsensitiveKey(patients, safeWatchID);
  const currentEntry = existingKey ? patients[existingKey] : null;

  if (!currentEntry) {
    return res.status(404).json({ success: false, message: "Watch not found" });
  }

  if (isWatchOwnedByAnotherDoctor(currentEntry, safeDoctorEmail)) {
    return res.status(403).json({ success: false, message: "Watch is linked to another doctor" });
  }

  patients[existingKey] = {
    ...currentEntry,
    name: safeName,
    email: safeEmail,
    doctorEmail: safeDoctorEmail,
    age: String(age || currentEntry.age || "").trim(),
    condition: String(condition || currentEntry.condition || "").trim(),
    phone: String(phone || currentEntry.phone || "").trim()
  };

  writeJSON("./data/patients.json", patients);
  res.json({ success: true, message: "Patient updated" });
});

app.get("/doctorWatches", (req, res) => {
  const doctorEmail = String(req.query.doctorEmail || "").trim();

  if (!doctorEmail) {
    return res.status(400).json({ success: false, message: "doctorEmail is required" });
  }

  const patients = readJSON("./data/patients.json");
  const doctorWatches = Object.entries(patients)
    .filter(([, patient]) => patient && patient.doctorEmail === doctorEmail)
    .map(([watchID, patient]) => ({
      watchID,
      name: patient.name || "-",
      email: patient.email || "-",
      age: patient.age || "-",
      condition: patient.condition || "-",
      phone: patient.phone || "-"
    }));

  res.json({ success: true, watches: doctorWatches });
});

app.get("/patientProfile/:watchID", async (req, res) => {
  const watchID = String(req.params.watchID || "").trim().toUpperCase();
  const doctorEmail = String(req.query.doctorEmail || "").trim();

  if (!watchID || !doctorEmail) {
    return res.status(400).json({ success: false, message: "watchID and doctorEmail are required" });
  }

  const patients = readJSON("./data/patients.json");
  const key = findCaseInsensitiveKey(patients, watchID);
  const patient = key ? patients[key] : null;

  if (!patient) {
    return res.status(404).json({ success: false, message: "Patient not found for this watch" });
  }

  if (isWatchOwnedByAnotherDoctor(patient, doctorEmail)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const watchReadings = await fetchReadings(watchID);
  const latest = watchReadings[watchReadings.length - 1] || null;
  const criticalCount = watchReadings.filter(isCriticalReading).length;

  res.json({
    success: true,
    profile: {
      watchID,
      name: patient.name || "-",
      email: patient.email || "-",
      age: patient.age || "-",
      condition: patient.condition || "-",
      phone: patient.phone || "-",
      doctorEmail: patient.doctorEmail || "-"
    },
    latest,
    criticalCount,
    readings: watchReadings
  });
});

app.post("/addReminder", async (req, res) => {
  if (!ensureSupabase(res)) return;

  const watch_id = String(req.body.watch_id || req.body.watchID || "").trim().toUpperCase();
  const medicine_name = String(req.body.medicine_name || "").trim();
  const time = String(req.body.time || "").trim();
  const repeat_days = String(req.body.repeat_days || "").trim();
  const doctor_email = String(req.body.doctor_email || "").trim();

  if (!watch_id || !medicine_name || !time || !repeat_days || !doctor_email) {
    return res.status(400).json({ success: false, message: "watch_id, medicine_name, time, repeat_days and doctor_email are required" });
  }

  const patients = readJSON("./data/patients.json");
  const key = findCaseInsensitiveKey(patients, watch_id);
  const patient = key ? patients[key] : null;
  if (patient && patient.doctorEmail && patient.doctorEmail !== doctor_email) {
    return res.status(403).json({ success: false, message: "Watch is linked to another doctor" });
  }

  try {
    await insertReminder({ watch_id, medicine_name, time, repeat_days, doctor_email });
    return res.json({ success: true, message: "Reminder added" });
  } catch (error) {
    console.error("addReminder failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to add reminder" });
  }
});

app.get("/getReminders", async (req, res) => {
  if (!ensureSupabase(res)) return;

  const watch_id = String(req.query.watch_id || "").trim().toUpperCase();
  if (!watch_id) {
    return res.status(400).json({ success: false, message: "watch_id is required" });
  }

  try {
    const reminders = await fetchRemindersList(watch_id);
    return res.json({ success: true, reminders });
  } catch (error) {
    console.error("getReminders failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to fetch reminders" });
  }
});

app.get("/patientReminders", async (req, res) => {
  if (!ensureSupabase(res)) return;

  const watch_id = String(req.query.watch_id || "").trim().toUpperCase();
  if (!watch_id) {
    return res.status(400).json({ success: false, message: "watch_id is required" });
  }

  try {
    const reminders = await fetchRemindersList(watch_id);
    return res.json({ success: true, reminders });
  } catch (error) {
    console.error("patientReminders failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to fetch reminders" });
  }
});

app.get("/patientPortal/:watchID", async (req, res) => {
  const watchID = String(req.params.watchID || "").trim().toUpperCase();
  const email = String(req.query.email || "").trim();

  if (!watchID || !email) {
    return res.status(400).json({ success: false, message: "watchID and email are required" });
  }

  const patients = readJSON("./data/patients.json");
  const key = findCaseInsensitiveKey(patients, watchID);
  const patient = key ? patients[key] : null;

  if (!patient) {
    return res.status(404).json({ success: false, message: "Patient not found for this watch" });
  }

  if (String(patient.email || "").toLowerCase() !== email.toLowerCase()) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const watchReadings = await fetchReadings(watchID);
  const latest = watchReadings[watchReadings.length - 1] || null;
  const criticalCount = watchReadings.filter(isCriticalReading).length;

  res.json({
    success: true,
    profile: {
      watchID,
      name: patient.name || "-",
      email: patient.email || "-",
      age: patient.age || "-",
      condition: patient.condition || "-",
      phone: patient.phone || "-"
    },
    latest,
    criticalCount,
    readings: watchReadings
  });
});

app.get("/criticalNotifications", async (req, res) => {
  const doctorEmail = String(req.query.doctorEmail || "").trim();

  if (!doctorEmail) {
    return res.status(400).json({ success: false, message: "doctorEmail is required" });
  }

  const patients = readJSON("./data/patients.json");

  const items = [];
  for (const [watchID, patient] of Object.entries(patients)) {
    if (!patient || patient.doctorEmail !== doctorEmail) continue;
    const allReadings = await fetchReadings(watchID);
    const latest = allReadings[allReadings.length - 1] || null;
    if (!isCriticalReading(latest)) continue;
    items.push({
      watchID,
      patientName: patient.name || "Unknown",
      hr: Number(latest.hr) || 0,
      spo2: Number(latest.spo2) || 0,
      status: latest.status || "critical",
      time: latest.time || new Date().toISOString()
    });
  }

  res.json({ success: true, notifications: items });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const doctors = readJSON("./data/doctors.json");

  for (const key in doctors) {
    if (doctors[key].email === email && doctors[key].password === password) {
      return res.json({ success: true, doctorEmail: doctors[key].email });
    }
  }

  res.json({ success: false });
});

app.post("/patientLogin", (req, res) => {
  const { watchID, email } = req.body;
  const safeWatchID = String(watchID || "").trim().toUpperCase();
  const safeEmail = String(email || "").trim().toLowerCase();

  if (!safeWatchID || !safeEmail) {
    return res.status(400).json({ success: false, message: "Watch ID and email are required" });
  }

  const patients = readJSON("./data/patients.json");
  const key = findCaseInsensitiveKey(patients, safeWatchID);
  const patient = key ? patients[key] : null;

  if (!patient) {
    return res.json({ success: false, message: "Watch not found" });
  }

  if (String(patient.email || "").toLowerCase() !== safeEmail) {
    return res.json({ success: false, message: "Invalid credentials" });
  }

  return res.json({
    success: true,
    patient: {
        watchID: key || safeWatchID,
      name: patient.name || "Patient",
      email: patient.email || ""
    }
  });
});

app.post("/aiChat", async (req, res) => {
  const role = String(req.body.role || "patient").trim().toLowerCase();
  const question = String(req.body.question || "").trim();
  const contextText = String(req.body.context || "").trim();

  if (!question) {
    return res.status(400).json({ success: false, message: "question is required" });
  }

  try {
    const answer = await askGroq(question, contextText, role === "doctor" ? "doctor" : "patient");
    return res.json({ success: true, answer });
  } catch (error) {
    console.error("AI chat failed:", error.message);
    return res.status(500).json({ success: false, message: "AI service unavailable" });
  }
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Server running on http://localhost:3000");
  console.log("LAN access enabled on port 3000");
});
