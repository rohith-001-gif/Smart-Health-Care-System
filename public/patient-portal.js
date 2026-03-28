const sessionRaw = localStorage.getItem("patientSession");
const session = sessionRaw ? JSON.parse(sessionRaw) : null;

const portalTitle = document.getElementById("portalTitle");
const portalInfo = document.getElementById("portalInfo");
const patientDetails = document.getElementById("patientDetails");
const snapshotCards = document.getElementById("snapshotCards");
const metricSelect = document.getElementById("metricSelect");
const lineChart = document.getElementById("lineChart");
const logoutPatientBtn = document.getElementById("logoutPatientBtn");
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

let portalData = null;

if (!session || !session.watchID || !session.email) {
  window.location = "login.html";
}

logoutPatientBtn.addEventListener("click", () => {
  localStorage.removeItem("patientSession");
  window.location = "login.html";
});

metricSelect.addEventListener("change", async () => {
  await loadPortal();
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

function renderPatientDetails(profile) {
  const details = [
    ["Patient Name", valueOrDash(profile.name)],
    ["Watch ID", valueOrDash(profile.watchID)],
    ["Email", valueOrDash(profile.email)],
    ["Age", valueOrDash(profile.age)],
    ["Condition", valueOrDash(profile.condition)],
    ["Phone", valueOrDash(profile.phone)]
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
  const cCount = criticalCount(readings);

  const cards = [
    ["Latest HR", latest ? valueOrDash(latest.hr) : "-", latest && Number(latest.hr) > 120],
    ["Latest SpO2", latest ? valueOrDash(latest.spo2) : "-", latest && Number(latest.spo2) < 90],
    ["Latest Steps", latest ? valueOrDash(latest.steps) : "-", false],
    ["Average HR", avg.hr, false],
    ["Average SpO2", avg.spo2, false],
    ["Average Steps", avg.steps, false],
    ["Critical Entries", cCount, cCount > 0],
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

  lineChart.innerHTML =
    "<polyline fill='none' stroke='" + lineColor + "' stroke-width='3' points='" + points + "'></polyline>" +
    "<text x='14' y='20' fill='#6b7280' font-size='12'>Min: " + min.toFixed(1) + "</text>" +
    "<text x='14' y='38' fill='#6b7280' font-size='12'>Max: " + max.toFixed(1) + "</text>";
}

function pushChatMessage(sender, text) {
  const row = document.createElement("div");
  row.className = "chat-msg";
  row.innerHTML = "<strong>" + sender + "</strong>" + text;
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function localFallback(question) {
  if (!portalData) return "Data is loading. Please try again in a moment.";
  const q = question.toLowerCase();
  const latest = portalData.latest || {};

  if (q.includes("latest") || q.includes("current")) {
    return "Latest values -> HR: " + valueOrDash(latest.hr) + ", SpO2: " + valueOrDash(latest.spo2) + ", Steps: " + valueOrDash(latest.steps) + ".";
  }

  if (q.includes("critical") || q.includes("danger") || q.includes("risk")) {
    return "Critical reading count is " + criticalCount(portalData.readings || []) + ". If symptoms worsen, contact your doctor immediately.";
  }

  return "I can help with latest vitals, trend summary, and when to contact your doctor.";
}

function buildPatientContext() {
  if (!portalData) return "No patient data loaded.";

  const latest = portalData.latest || {};
  const avg = computeAverages(portalData.readings || []);

  return [
    "Patient name: " + valueOrDash(portalData.profile.name),
    "Watch ID: " + valueOrDash(portalData.profile.watchID),
    "Age: " + valueOrDash(portalData.profile.age),
    "Condition: " + valueOrDash(portalData.profile.condition),
    "Latest HR: " + valueOrDash(latest.hr),
    "Latest SpO2: " + valueOrDash(latest.spo2),
    "Latest Steps: " + valueOrDash(latest.steps),
    "Latest Status: " + valueOrDash(latest.status),
    "Average HR: " + avg.hr,
    "Average SpO2: " + avg.spo2,
    "Average Steps: " + avg.steps,
    "Critical Count: " + criticalCount(portalData.readings || [])
  ].join("\n");
}

async function askAI(question) {
  const response = await fetch("/aiChat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "patient",
      question,
      context: buildPatientContext()
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

  try {
    const answer = await askAI(text);
    pushChatMessage("Bot:", answer);
  } catch (error) {
    pushChatMessage("Bot:", localFallback(text));
  }
}

async function loadPortal() {
  try {
    const response = await fetch(
      "/patientPortal/" + encodeURIComponent(session.watchID) + "?email=" + encodeURIComponent(session.email)
    );
    const result = await response.json();

    if (!response.ok || !result.success) {
      portalInfo.textContent = result.message || "Unable to load patient portal";
      return;
    }

    portalData = result;

    portalTitle.textContent = valueOrDash(result.profile.name) + " - Patient Portal";
    portalInfo.textContent = "Watch ID: " + result.profile.watchID + " | Last update: " + formatTime(result.latest ? result.latest.time : null);

    renderPatientDetails(result.profile);
    renderSnapshot(result.latest, result.readings || []);
    renderChart(result.readings || [], metricSelect.value);
  } catch (error) {
    portalInfo.textContent = "Server error while loading data";
  }
}

loadPortal();
setInterval(loadPortal, 15000);
pushChatMessage("Bot:", "Hi, I am your assistant. Ask me about your latest vitals or trends.");
