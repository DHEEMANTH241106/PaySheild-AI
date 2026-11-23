# PayShield AI

PayShield AI is a functional Android prototype for checking suspicious messages, assessing transaction context, matching payment claims to **simulated** records, and creating merchant requests. It is not connected to a bank, UPI network, or payment provider.

## Project layout

- `mobile/` — React Native + Expo Android application with React Navigation, Axios, native gallery/camera picker, and an Android APK EAS profile.
- `frontend/` — original Vite web prototype, retained alongside the Android app.
- `backend/` — FastAPI API, SQLite demo database, and ML model code/data.

## Android app (primary mobile experience)

### Requirements

- Node.js 20 or later and npm
- Android Studio + Android SDK/emulator for a local native build, **or** Expo Go on an Android phone for development
- Python 3.10 or later for the API

### Start the backend

From the project root, in a PowerShell terminal:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd backend
python -m app.ml.train_models
python -m uvicorn app.main:app --host 0.0.0.0 --reload
```

The API is at `http://127.0.0.1:8000`; Swagger docs are at `http://127.0.0.1:8000/docs`.

### Start the app in Expo Go

In a second terminal:

```powershell
cd mobile
npm install
Copy-Item .env.example .env
npm start
```

The default API URL in `mobile/.env.example` is `http://10.0.2.2:8000/api`, for the Android emulator talking to the API on the host computer. For a physical phone, change `EXPO_PUBLIC_API_URL` in `mobile/.env` to the host computer's Wi-Fi IPv4 address (for example `http://192.168.1.25:8000/api`); the phone must be connected to the same Wi-Fi (not cellular-only) and the firewall must allow port 8000. Restart Expo after changing `.env`. If the app says it cannot reach the API, check `http://<computer-wifi-ip>:8000/api/health` in a browser on the phone and confirm it returns `{"status":"ok","mode":"simulated prototype"}`.

Scan the Expo QR code with Expo Go. The camera/photo permissions are used only when selecting a screenshot for checking.

### Build an installable Android APK

Install/initialize EAS Build once:

```powershell
npm install --global eas-cli
cd mobile
eas login
eas build:configure
```

The preview profile is configured to create an installable APK. Set `EXPO_PUBLIC_API_URL` to a publicly reachable **HTTPS** backend URL before building:

```powershell
$env:EXPO_PUBLIC_API_URL = "https://your-api.example.com/api"
npm run build:android:apk
```

EAS Build runs remotely and provides the APK download link when the build completes. A public HTTPS backend deployment and EAS account are prerequisites; neither is provisioned by this repository. For local USB/emulator builds with Android Studio installed, use `npx expo run:android`. The app's HTTP cleartext setting is for local development only and should be disabled for production builds.

## Mobile features

- Login/register calls the existing demo authentication API; customer/merchant workspace selection is local to the app because the API does not store roles or issue production sessions.
- Overview dashboard and activity counts.
- Message scanner using the existing TF-IDF/Logistic Regression-backed endpoint.
- Transaction safety check using contextual Random Forest/Isolation Forest demo endpoints.
- Payment reference matching and screenshot capture/gallery upload using Expo ImagePicker and the existing API.
- Merchant payment request creation/history, plus fraud report creation/list and native CSV sharing.
- Dark theme, bottom-tab navigation, native form controls, and Android camera/photo permission prompts.

The app only consumes existing backend endpoints. In particular, the prototype backend uses SQLite rather than Firebase; Firebase Authentication, Firestore, Firebase Storage, and push notifications are not configured.

## Retained web prototype

The previous web app remains under `frontend/`. From the project root run the same backend instructions above; in a separate terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL printed in the terminal. The Vite server proxies API calls to FastAPI.

## Models and demo data

- Message detection uses TF-IDF and Logistic Regression trained from `backend/datasets/messages.csv`.
- Transaction checks use a Random Forest and Isolation Forest trained on generated synthetic examples.
- Seeded payment references:
  - `PSH-DEMO-1001` — successful simulated record for ₹1,250 to `cornerstore@upi`
  - `PSH-DEMO-1002` — pending simulated record for ₹499 to `cornerstore@upi`
  - `PSH-DEMO-1003` — failed simulated record for ₹2,200 to `cornerstore@upi`
- Change amount/receiver to test mismatches; use an unknown reference to test an unverified claim.

Train/save models with `python -m app.ml.train_models` from `backend`. The app can also fit its small demo models when serialized artifacts are absent.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`
- `POST /api/messages/analyze`
- `POST /api/transactions/analyze`, `GET /api/transactions/history`
- `POST /api/payments/upload-screenshot`, `POST /api/payments/verify`, `GET /api/payments/history`
- `POST /api/merchant/create-request`, `GET /api/merchant/dashboard`, `GET /api/merchant/transactions`
- `GET /api/reports`, `POST /api/reports/create`, `GET /api/reports/export`
- `GET /api/analytics/dashboard`

Set `PAYSHIELD_DB` to use a different SQLite file. The default database is `payshield.db` at the project root.

## Safety and prototype limits

- Payment outcomes only match local SQLite demo records. A successful match is labeled simulated, not bank-confirmed.
- A screenshot, OCR result, image property, or demo record cannot prove funds were received. Confirm receipt in an authorized bank or payment-provider app before releasing goods.
- OCR is optional and fallible; the app does not assert image authenticity.
- The datasets are small synthetic demonstrations; model outputs are not validated for real-world use and scores are not calibrated probabilities.
- Authentication does not issue access tokens or enforce authorization; Firebase, production roles, rate limiting, production secrets, and push notifications are not configured.
- The prototype does not request UPI PINs or OTPs. Do not enter passwords, PINs, OTPs, or real personal/financial data.
