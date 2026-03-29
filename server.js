require("dotenv").config();

const express = require("express");
const path = require('path');
const cors = require("cors");
const nodemailer = require("nodemailer");
const supabase = require("./lib/supabase");

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
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
  ? nodemailer.createTransport({ service: "gmail", auth: { user: MAIL_USER, pass: MAIL_PASS } })
  : null;

const normalizeWatchId = (value = "") => value.trim().toUpperCase();
const normalizeEmail = (value = "") => value.trim().toLowerCase();

function isCritical(reading) {
  return Number(reading.hr) > CRITICAL_HR || Number(reading.spo2) < CRITICAL_SPO2;
}

function mapPatient(row = {}) {
  return {
    watch_id: row.watch_id,
    watchID: row.watch_id,
    name: row.name || "",
    email: row.email || "",
    doctor_email: row.doctor_email || "",
    doctorEmail: row.doctor_email || "",
    age: row.age || "",
    condition: row.condition || "",
    phone: row.phone || "",
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapReading(row = {}) {
  return {
    id: row.id,
    watch_id: row.watch_id,
    watchID: row.watch_id,
    hr: Number(row.hr) || 0,
    spo2: Number(row.spo2) || 0,
    steps: Number(row.steps) || 0,
    status: row.status || (isCritical(row) ? "critical" : "normal"),
    time: row.time
  };
}

function sendCriticalEmail(patient, reading) {
  if (!transporter || !patient) return;

  const emails = [patient.doctor_email, patient.email].filter(Boolean);
  if (!emails.length) return;

  transporter
    .sendMail({
      to: emails.join(","),
      subject: "Critical Patient Alert",
      text: `Critical alert for ${patient.name}
Watch ID: ${reading.watch_id}
HR: ${reading.hr}
SpO2: ${reading.spo2}`
    })
    .catch((err) => console.error("Email send error", err));
}

async function fetchReadings(watch_id, limit = 100) {
  const { data, error } = await supabase
    .from("readings")
    .select("*")
    .eq("watch_id", watch_id)
    .order("time", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data.map(mapReading);
}

// ---------------- LOGIN (Doctor) ----------------
app.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = (req.body.password || "").trim();

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    const { data, error } = await supabase
      .from("doctors")
      .select("email")
      .eq("email", email)
      .eq("password", password)
      .single();

    if (error || !data) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    return res.json({ success: true, doctor_email: data.email });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------- PATIENT LOGIN ----------------
app.post("/patientLogin", async (req, res) => {
  try {
    const watch_id = normalizeWatchId(req.body.watch_id || req.body.watchID);
    const email = normalizeEmail(req.body.email);

    if (!watch_id || !email) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .eq("watch_id", watch_id)
      .eq("email", email)
      .single();

    if (error || !data) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    return res.json({ success: true, patient: mapPatient(data) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------- ADD PATIENT ----------------
app.post("/addPatient", async (req, res) => {
  try {
    const watch_id = normalizeWatchId(req.body.watch_id || req.body.watchID);
    const name = (req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const doctor_email = normalizeEmail(req.body.doctor_email || req.body.doctorEmail);
    const age = (req.body.age || "").trim();
    const condition = (req.body.condition || "").trim();
    const phone = (req.body.phone || "").trim();

    if (!watch_id || !name || !email || !doctor_email) {
      return res.status(400).json({ success: false, message: "Watch ID, name, email, and doctor email are required" });
    }

    const { data, error } = await supabase
      .from("patients")
      .insert({ watch_id, name, email, doctor_email, age, condition, phone })
      .select("*")
      .single();

    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    return res.json({ success: true, patient: mapPatient(data), message: "Watch linked to patient" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------- UPDATE PATIENT ----------------
app.put("/updatePatient", async (req, res) => {
  try {
    const watch_id = normalizeWatchId(req.body.watch_id || req.body.watchID);
    const doctor_email = normalizeEmail(req.body.doctor_email || req.body.doctorEmail);

    if (!watch_id || !doctor_email) {
      return res.status(400).json({ success: false, message: "Watch ID and doctor email are required" });
    }

    const updates = {
      name: (req.body.name || "").trim(),
      email: normalizeEmail(req.body.email),
      age: (req.body.age || "").trim(),
      condition: (req.body.condition || "").trim(),
      phone: (req.body.phone || "").trim(),
      doctor_email
    };

    const { data, error } = await supabase
      .from("patients")
      .update(updates)
      .eq("watch_id", watch_id)
      .select("*")
      .single();

    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    if (!data) {
      return res.status(404).json({ success: false, message: "Watch not found" });
    }

    return res.json({ success: true, patient: mapPatient(data), message: "Patient updated" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------- GET WATCHES FOR DOCTOR ----------------
app.get("/doctorWatches", async (req, res) => {
  try {
    const doctor_email = normalizeEmail(req.query.email || req.query.doctor_email || req.query.doctorEmail);

    if (!doctor_email) {
      return res.json({ success: true, watches: [] });
    }

    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .eq("doctor_email", doctor_email)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    return res.json({ success: true, watches: data.map(mapPatient) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------- GET READINGS ----------------
app.get("/data/:watchId", async (req, res) => {
  try {
    const watch_id = normalizeWatchId(req.params.watchId);
    if (!watch_id) {
      return res.status(400).json({ success: false, message: "watch_id is required" });
    }

    const readings = await fetchReadings(watch_id, 100);
    return res.json({ success: true, readings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Unable to load readings" });
  }
});

// ---------------- PATIENT PROFILE FOR DOCTOR ----------------
app.get("/patientProfile/:watchId", async (req, res) => {
  try {
    const watch_id = normalizeWatchId(req.params.watchId);
    const doctor_email = normalizeEmail(req.query.doctor_email || req.query.doctorEmail);

    if (!watch_id) {
      return res.status(400).json({ success: false, message: "watch_id is required" });
    }

    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("*")
      .eq("watch_id", watch_id)
      .single();

    if (patientError || !patient) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    if (doctor_email && normalizeEmail(patient.doctor_email) !== doctor_email) {
      return res.status(403).json({ success: false, message: "Doctor not linked to this patient" });
    }

    const readings = await fetchReadings(watch_id, 120);
    const latest = readings.length ? readings[readings.length - 1] : null;

    return res.json({ success: true, profile: mapPatient(patient), readings, latest });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Unable to load profile" });
  }
});

// ---------------- PATIENT PORTAL ----------------
app.get("/patientPortal/:watchId", async (req, res) => {
  try {
    const watch_id = normalizeWatchId(req.params.watchId);
    const email = normalizeEmail(req.query.email);

    if (!watch_id || !email) {
      return res.status(400).json({ success: false, message: "watch_id and email required" });
    }

    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("*")
      .eq("watch_id", watch_id)
      .eq("email", email)
      .single();

    if (patientError || !patient) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    const readings = await fetchReadings(watch_id, 120);
    const latest = readings.length ? readings[readings.length - 1] : null;

    return res.json({ success: true, profile: mapPatient(patient), readings, latest });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Unable to load patient portal" });
  }
});

// ---------------- CRITICAL ALERTS ----------------
app.get("/criticalNotifications", async (req, res) => {
  try {
    const doctor_email = normalizeEmail(req.query.doctor_email || req.query.doctorEmail);
    if (!doctor_email) {
      return res.json({ success: true, notifications: [] });
    }

    const { data: patients, error: patientError } = await supabase
      .from("patients")
      .select("watch_id,name,doctor_email,email")
      .eq("doctor_email", doctor_email);

    if (patientError) {
      return res.status(400).json({ success: false, message: patientError.message });
    }

    const notifications = [];

    for (const patient of patients) {
      const { data: latestRow, error: readError } = await supabase
        .from("readings")
        .select("*")
        .eq("watch_id", patient.watch_id)
        .order("time", { ascending: false })
        .limit(1);

      if (readError || !latestRow || !latestRow.length) continue;
      const reading = mapReading(latestRow[0]);

      if (isCritical(reading)) {
        notifications.push({
          watchID: patient.watch_id,
          patientName: patient.name,
          ...reading
        });
      }
    }

    return res.json({ success: true, notifications });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Unable to load notifications" });
  }
});

// ---------------- UPDATE FROM ESP32 ----------------
app.get("/update", async (req, res) => {
  try {
    const watch_id = normalizeWatchId(req.query.watch_id || req.query.watchID);
    const hr = Number(req.query.hr || 0);
    const spo2 = Number(req.query.spo2 || 0);
    const steps = Number(req.query.steps || 0);

    if (!watch_id) {
      return res.status(400).json({ success: false, message: "Missing watch_id" });
    }

    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("watch_id,name,email,doctor_email")
      .eq("watch_id", watch_id)
      .single();

    if (patientError || !patient) {
      return res.status(404).json({ success: false, message: "Watch ID is not registered" });
    }

    const status = isCritical({ hr, spo2 }) ? "critical" : "normal";

    const { data, error } = await supabase
      .from("readings")
      .insert({ watch_id, hr, spo2, steps, status })
      .select("*")
      .single();

    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const reading = mapReading(data);

    if (isCritical(reading)) {
      sendCriticalEmail(patient, reading);
    }

    return res.json({ success: true, reading });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Unable to save reading" });
  }
});

// ---------------- AI ----------------
app.post("/aiChat", async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(400).json({ success: false, message: "GROQ_API_KEY not configured" });
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: req.body.question }]
      })
    });

    const data = await response.json();
    return res.json({ success: true, answer: data.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "AI service error" });
  }
});

// ---------------- SUPABASE TEST ----------------
app.get("/supabase-health", async (req, res) => {
  const { data, error } = await supabase.from("doctors").select("email").limit(1);

  if (error) return res.status(500).json({ success: false, error: error.message });

  return res.json({ success: true, message: "Supabase connected", data });
});

// ---------------- SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
