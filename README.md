# 🩺 Arogya — Smart Health Monitoring System
 
> Real-time wearable health monitor built on ESP32, with cloud storage and a web dashboard for doctors and patients.
 
[![Live Demo](https://img.shields.io/badge/Live%20Demo-Render-46E3B7?style=for-the-badge&logo=render)](https://arogya-41dj.onrender.com/login.html)
 
---
 
## 📌 Overview
 
**Arogya** (Sanskrit: *health*) is a hardware-integrated smart health monitoring system designed for continuous, real-time tracking of vital signs and physical activity. It combines embedded sensor hardware with a cloud backend and a web-based interface accessible by both patients and doctors.
 
The system is being developed under faculty guidance at **VIT Vellore** and is currently advancing through **Technology Readiness Levels (TRL) 1–4**, with a patent draft under preparation.
 
---
 
## ✨ Features
 
| Feature | Status |
|---|---|
| SpO2 & Heart Rate monitoring (MAX30100) | ✅ Working |
| Step counting & fall detection (MPU6050) | ✅ Working |
| Live OLED display (128×64) | ✅ Working |
| WiFi data transmission from ESP32 | ✅ Working |
| Cloud storage via Supabase | ✅ Working |
| Doctor dashboard (web) | ✅ Working |
| Patient portal (web) | ✅ Working |
 
---
 
## 🏗️ System Architecture
 
```
┌─────────────────────────────────┐
│         ESP32 Wearable          │
│  ┌──────────┐  ┌─────────────┐  │
│  │ MAX30100 │  │   MPU6050   │  │
│  │ SpO2/HR  │  │  IMU/Steps  │  │
│  └────┬─────┘  └──────┬──────┘  │
│       └──────┬─────────┘        │
│          ┌───▼────┐             │
│          │  OLED  │ (live view) │
│          └────────┘             │
│       WiFi (HTTP POST)          │
└──────────────┬──────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│    Express.js Backend (Render)   │
│     https://arogya-41dj.onrender.com     │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│          Supabase (DB)           │
│     PostgreSQL cloud storage     │
└──────────┬───────────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
Doctor         Patient
Dashboard      Portal
```
 
---
 
## 🔧 Hardware
 
| Component | Role |
|---|---|
| **ESP32** | Main microcontroller, WiFi, sensor orchestration |
| **MAX30100** | Pulse oximeter — measures SpO2 & heart rate |
| **MPU6050** | 6-axis IMU — step counting, fall detection |
| **128×64 OLED** | Real-time local display of vitals |
 
**Communication:** I2C bus (ESP32 as master)
 
---
 
## 💻 Tech Stack
 
**Firmware**
- Arduino framework on ESP32
- Non-blocking HTTP via `WiFiClient` + `HTTPClient`
- I2C sensor drivers for MAX30100 & MPU6050
 
**Backend**
- Node.js + Express.js
- Hosted on **Render** (free tier)
- REST API for data ingestion and retrieval
 
**Database**
- **Supabase** (PostgreSQL)
- Stores timestamped sensor readings per patient
 
**Frontend**
- Vanilla HTML/CSS/JS
- Doctor Dashboard — view all patients, live vitals
- Patient Portal — personal health history and trends
 
---
 
## 🚀 Live Demo
 
🔗 **[https://arogya-41dj.onrender.com/login.html](https://arogya-41dj.onrender.com/login.html)**
 
> ⚠️ Hosted on Render's free tier — the server may take **~30 seconds to wake up** on first visit. Please wait and refresh if it doesn't load immediately.
 
---
 
## 📁 Repository Structure
 
```
arogya/
├── firmware/
│   └── arogya_esp32/
│       ├── arogya_esp32.ino      # Main Arduino sketch
│       ├── sensors.h             # MAX30100 & MPU6050 helpers
│       └── wifi_client.h         # HTTP POST logic
├── backend/
│   ├── server.js                 # Express.js entry point
│   ├── routes/
│   │   ├── data.js               # POST /api/data
│   │   └── patients.js           # GET /api/patients
│   └── supabase.js               # Supabase client config
├── frontend/
│   ├── login.html
│   ├── doctor_dashboard.html
│   └── patient_portal.html
└── README.md
```
 
*(Update this structure to match your actual repo layout)*
 
---
 
## ⚙️ Setup & Installation
 
### Backend (Local)
 
```bash
git clone https://github.com/rohith-001-gif/arogya.git
cd arogya/backend
npm install
```
 
Create a `.env` file:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
PORT=3000
```
 
```bash
node server.js
```
 
### ESP32 Firmware
 
1. Open `firmware/arogya_esp32/arogya_esp32.ino` in Arduino IDE
2. Install required libraries:
   - `MAX30100_PulseOximeter`
   - `MPU6050`
   - `Adafruit_SSD1306`
   - `WiFi`, `HTTPClient`
3. Set your WiFi credentials and backend URL in the sketch
4. Flash to ESP32
 
---
 
## 📊 API Endpoints
 
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/data` | Receive sensor data from ESP32 |
| `GET` | `/api/patients` | Fetch all patient records |
| `GET` | `/api/data/:id` | Fetch readings for a specific patient |
 
---
 
## 🔮 Roadmap
 
- [ ] BLE support for offline operation
- [ ] Alert system for abnormal vitals (email/SMS)
- [ ] ML-based anomaly detection on vitals
- [ ] PCB design for compact wearable form factor (KiCad)
- [ ] Patent filing
 
---
 
## 👨‍💻 Author
 
**Rohith Lingam. L**
B.Tech – Electronics Engineering (VLSI Design & Technology), VIT Vellore
🔗 [LinkedIn](https://linkedin.com/in/rohith-lingam) | 🐙 [GitHub](https://github.com/rohith-001-gif)
 
---
