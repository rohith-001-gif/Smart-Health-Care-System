const express = require("express");
const fs = require("fs");
const cors = require("cors");
const nodemailer = require("nodemailer");

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

const transporter = MAIL_USER && MAIL_PASS
  ? nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: MAIL_USER,
      pass: MAIL_PASS
    }
  })
  : null;

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

app.get("/update", (req, res) => {
  const { watchID, hr, spo2, steps, status } = req.query;
  const safeWatchID = String(watchID || "").trim().toUpperCase();

  if (!safeWatchID) {
    return res.status(400).send("watchID is required");
  }

  const readings = readJSON("./data/readings.json");
  const patients = readJSON("./data/patients.json");

  if (!readings[safeWatchID]) readings[safeWatchID] = [];

  const entry = {
    hr: Number(hr) || 0,
    spo2: Number(spo2) || 0,
    steps: Number(steps) || 0,
    status: String(status || "normal"),
    time: new Date().toISOString()
  };

  readings[safeWatchID].push(entry);
  writeJSON("./data/readings.json", readings);

  if (isCriticalReading(entry)) {
    const patient = patients[safeWatchID];
    sendCriticalEmail(patient, { ...entry, watchID: safeWatchID });
  }

  res.send("Data stored");
});

app.get("/data/:watchID", (req, res) => {
  const readings = readJSON("./data/readings.json");
  const safeWatchID = String(req.params.watchID || "").trim();
  const key = findCaseInsensitiveKey(readings, safeWatchID);
  res.json((key && readings[key]) || []);
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

app.get("/patientProfile/:watchID", (req, res) => {
  const watchID = String(req.params.watchID || "").trim().toUpperCase();
  const doctorEmail = String(req.query.doctorEmail || "").trim();

  if (!watchID || !doctorEmail) {
    return res.status(400).json({ success: false, message: "watchID and doctorEmail are required" });
  }

  const patients = readJSON("./data/patients.json");
  const readings = readJSON("./data/readings.json");
  const key = findCaseInsensitiveKey(patients, watchID);
  const patient = key ? patients[key] : null;

  if (!patient) {
    return res.status(404).json({ success: false, message: "Patient not found for this watch" });
  }

  if (isWatchOwnedByAnotherDoctor(patient, doctorEmail)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const readingKey = findCaseInsensitiveKey(readings, watchID);
  const watchReadings = (readingKey && readings[readingKey]) || [];
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

app.get("/patientPortal/:watchID", (req, res) => {
  const watchID = String(req.params.watchID || "").trim().toUpperCase();
  const email = String(req.query.email || "").trim();

  if (!watchID || !email) {
    return res.status(400).json({ success: false, message: "watchID and email are required" });
  }

  const patients = readJSON("./data/patients.json");
  const readings = readJSON("./data/readings.json");
  const key = findCaseInsensitiveKey(patients, watchID);
  const patient = key ? patients[key] : null;

  if (!patient) {
    return res.status(404).json({ success: false, message: "Patient not found for this watch" });
  }

  if (String(patient.email || "").toLowerCase() !== email.toLowerCase()) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const readingKey = findCaseInsensitiveKey(readings, watchID);
  const watchReadings = (readingKey && readings[readingKey]) || [];
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

app.get("/criticalNotifications", (req, res) => {
  const doctorEmail = String(req.query.doctorEmail || "").trim();

  if (!doctorEmail) {
    return res.status(400).json({ success: false, message: "doctorEmail is required" });
  }

  const patients = readJSON("./data/patients.json");
  const readings = readJSON("./data/readings.json");

  const items = Object.entries(patients)
    .filter(([, patient]) => patient && patient.doctorEmail === doctorEmail)
    .map(([watchID, patient]) => {
      const allReadings = readings[watchID] || [];
      const latest = allReadings[allReadings.length - 1] || null;
      return {
        watchID,
        patientName: patient.name || "Unknown",
        latest
      };
    })
    .filter((item) => isCriticalReading(item.latest))
    .map((item) => ({
      watchID: item.watchID,
      patientName: item.patientName,
      hr: Number(item.latest.hr) || 0,
      spo2: Number(item.latest.spo2) || 0,
      status: item.latest.status || "critical",
      time: item.latest.time || new Date().toISOString()
    }));

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
