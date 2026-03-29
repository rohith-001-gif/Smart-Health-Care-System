const doctorEmail = localStorage.getItem("doctor_email") || localStorage.getItem("doctor");
const params = new URLSearchParams(window.location.search);
const watchID = (params.get("watchID") || params.get("watch_id") || "").toUpperCase();

const pageTitle = document.getElementById("pageTitle");
const watchInfo = document.getElementById("watchInfo");
const backBtn = document.getElementById("backBtn");
const patientDetails = document.getElementById("patientDetails");
const snapshotCards = document.getElementById("snapshotCards");
const metricSelect = document.getElementById("metricSelect");
const lineChart = document.getElementById("lineChart");
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

let profileData = null;

if (!doctorEmail) {
  window.location = "login.html";
}

if (!watchID) {
  window.location = "dashboard.html";
}

backBtn.addEventListener("click", () => {
  window.location = "dashboard.html";
});

metricSelect.addEventListener("change", () => {
  if (profileData) {
    renderChart(profileData.readings, metricSelect.value);
  }
});

chatSendBtn.addEventListener("click", onSendChat);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    onSendChat();
  }
});

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function pushChatMessage(sender, text) {
  const row = document.createElement("div");
  row.className = "chat-msg";
  row.innerHTML = "<strong>" + sender + "</strong>" + text;
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function computeAverages(readings) {
  if (!readings.length) return { hr: 0, spo2: 0, steps: 0 };

  const total = readings.reduce(
    (acc, r) => {
      acc.hr += Number(r.hr) || 0;
      acc.spo2 += Number(r.spo2) || 0;
      acc.steps += Number(r.steps) || 0;
      return acc;
    },
    { hr: 0, spo2: 0, steps: 0 }
  );

  return {
    hr: (total.hr / readings.length).toFixed(1),
    spo2: (total.spo2 / readings.length).toFixed(1),
    steps: Math.round(total.steps / readings.length)
  };
}

function criticalCount(readings) {
  return readings.filter((r) => Number(r.hr) > 120 || Number(r.spo2) < 90 || String(r.status || "").toLowerCase().includes("critical")).length;
}

function riskLabel(readings) {
  const critical = criticalCount(readings);
  if (critical >= 5) return "High";
  if (critical >= 2) return "Medium";
  return "Low";
}

function renderPatientDetails(profile) {
  const details = [
    ["Patient Name", valueOrDash(profile.name)],
    ["Watch ID", valueOrDash(profile.watch_id || profile.watchID)],
    ["Email", valueOrDash(profile.email)],
    ["Age", valueOrDash(profile.age)],
    ["Condition", valueOrDash(profile.condition)],
    ["Phone", valueOrDash(profile.phone)],
    ["Doctor", valueOrDash(profile.doctor_email || profile.doctorEmail)]
  ];

  patientDetails.innerHTML = "";
  details.forEach((item) => {
    const box = document.createElement("div");
    box.innerHTML = "<label>" + item[0] + "</label><strong>" + item[1] + "</strong>";
    patientDetails.appendChild(box);
  });
}

function renderSnapshot(latest, readings) {
  const avg = computeAverages(readings);
  const risk = riskLabel(readings);
  const cCount = criticalCount(readings);

  const cards = [
    ["Latest HR", latest ? valueOrDash(latest.hr) : "-", latest && Number(latest.hr) > 120],
    ["Latest SpO2", latest ? valueOrDash(latest.spo2) : "-", latest && Number(latest.spo2) < 90],
    ["Average HR", avg.hr, false],
    ["Average SpO2", avg.spo2, false],
    ["Average Steps", avg.steps, false],
    ["Critical Entries", cCount, cCount > 0],
    ["Risk Level", risk, risk === "High"],
    ["Last Updated", latest ? formatTime(latest.time) : "-", false]
  ];

  snapshotCards.innerHTML = "";

  cards.forEach((item) => {
    const card = document.createElement("div");
    card.className = "metric-card";
    card.innerHTML = "<h4>" + item[0] + "</h4><p class='" + (item[2] ? "metric-bad" : "") + "'>" + item[1] + "</p>";
    snapshotCards.appendChild(card);
  });
}

function renderChart(readings, metric) {
  const last30 = readings.slice(-30);

  if (!last30.length) {
    lineChart.innerHTML = "<text x='50%' y='50%' text-anchor='middle' fill='#6b7280' font-size='16'>No readings available for graph</text>";
    return;
  }

  const values = last30.map((r) => Number(r[metric]) || 0);
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    min = min - 1;
    max = max + 1;
  }

  const points = values
    .map((v, idx) => {
      const x = (idx / (values.length - 1 || 1)) * 780 + 10;
      const y = 260 - ((v - min) / (max - min)) * 240;
      return x.toFixed(2) + "," + y.toFixed(2);
    })
    .join(" ");

  const lineColor = metric === "spo2" ? "#1d4ed8" : metric === "steps" ? "#0f766e" : "#be123c";

  lineChart.innerHTML = "<polyline fill='none' stroke='" + lineColor + "' stroke-width='3' points='" + points + "'></polyline>" +
    "<text x='14' y='20' fill='#6b7280' font-size='12'>Min: " + min.toFixed(1) + "</text>" +
    "<text x='14' y='38' fill='#6b7280' font-size='12'>Max: " + max.toFixed(1) + "</text>";
}

function chatbotReply(question) {
  if (!profileData) {
    return "Patient data is still loading.";
  }

  const q = question.toLowerCase();
  const latest = profileData.latest;
  const readings = profileData.readings || [];
  const avg = computeAverages(readings);
  const risk = riskLabel(readings);
  const cCount = criticalCount(readings);

  if (q.includes("latest") || q.includes("current") || q.includes("vital")) {
    if (!latest) return "No latest reading is available yet.";
    return "Latest vitals -> HR: " + latest.hr + ", SpO2: " + latest.spo2 + ", Steps: " + latest.steps + ", Status: " + valueOrDash(latest.status) + ".";
  }

  if (q.includes("risk") || q.includes("critical")) {
    return "Current risk level is " + risk + ". Critical entries found: " + cCount + ".";
  }

  if (q.includes("summary") || q.includes("average")) {
    return "Summary -> Avg HR: " + avg.hr + ", Avg SpO2: " + avg.spo2 + ", Avg Steps: " + avg.steps + ".";
  }

  if (q.includes("patient") || q.includes("detail")) {
    return "Patient: " + valueOrDash(profileData.profile.name) + ", age " + valueOrDash(profileData.profile.age) + ", condition: " + valueOrDash(profileData.profile.condition) + ".";
  }

  if (q.includes("next") || q.includes("plan") || q.includes("care")) {
    return "Suggested next steps: verify medication adherence, repeat vitals in 30 minutes, and contact emergency support if trend worsens.";
  }

  return "You can ask about latest vitals, risk level, patient details, summary, or next steps.";
}

function buildDoctorContext() {
  if (!profileData) return "No patient data loaded.";

  const latest = profileData.latest || {};
  const avg = computeAverages(profileData.readings || []);

  return [
    "Patient name: " + valueOrDash(profileData.profile.name),
    "Watch ID: " + valueOrDash(profileData.profile.watch_id || profileData.profile.watchID),
    "Age: " + valueOrDash(profileData.profile.age),
    "Condition: " + valueOrDash(profileData.profile.condition),
    "Latest HR: " + valueOrDash(latest.hr),
    "Latest SpO2: " + valueOrDash(latest.spo2),
    "Latest Steps: " + valueOrDash(latest.steps),
    "Latest Status: " + valueOrDash(latest.status),
    "Average HR: " + avg.hr,
    "Average SpO2: " + avg.spo2,
    "Average Steps: " + avg.steps,
    "Critical Count: " + criticalCount(profileData.readings || [])
  ].join("\n");
}

async function askAI(question) {
  const response = await fetch("/aiChat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "doctor",
      question,
      context: buildDoctorContext()
    })
  });

  if (!response.ok) {
    throw new Error("AI request failed");
  }

  const result = await response.json();
  if (!result.success || !result.answer) {
    throw new Error("No AI answer");
  }

  return result.answer;
}

async function onSendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  pushChatMessage("You:", text);
  chatInput.value = "";

  let answer = "";
  try {
    answer = await askAI(text);
  } catch (error) {
    answer = chatbotReply(text);
  }

  pushChatMessage("Bot:", answer);
}

async function loadProfile() {
  try {
    const response = await fetch(
      "/patientProfile/" + encodeURIComponent(watchID) + "?doctor_email=" + encodeURIComponent(doctorEmail)
    );
    const result = await response.json();

    if (!response.ok || !result.success) {
      watchInfo.textContent = result.message || "Unable to load patient profile.";
      return;
    }

    profileData = {
      profile: {
        ...(result.profile || {}),
        watchID: (result.profile && (result.profile.watch_id || result.profile.watchID)) || watchID
      },
      readings: result.readings || [],
      latest: result.latest || null
    };

    pageTitle.textContent = profileData.profile.name + " - Patient Statistics";
    watchInfo.textContent =
      "Watch ID: " + (profileData.profile.watch_id || profileData.profile.watchID) + " | Last update: " + formatTime(profileData.latest ? profileData.latest.time : null);

    renderPatientDetails(profileData.profile);
    renderSnapshot(profileData.latest, profileData.readings);
    renderChart(profileData.readings, metricSelect.value);

    pushChatMessage("Bot:", "Patient data loaded. Ask for latest vitals, summary, risk, or next steps.");
  } catch (error) {
    watchInfo.textContent = "Server error while loading profile.";
  }
}

loadProfile();
setInterval(loadProfile, 15000);
