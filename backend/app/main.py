from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Iterator

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.ml.models import message_model, transaction_models

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("PAYSHIELD_DB", ROOT / "payshield.db"))
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
URL_RE = re.compile(r"https?://[^\s]+|www\.[^\s]+", re.I)
UPI_RE = re.compile(r"[\w.-]+@[\w.-]+")
AMOUNT_RE = re.compile(r"(?:₹|INR\s*)\s?([\d,]+(?:\.\d{1,2})?)", re.I)
REF_RE = re.compile(r"(?:UTR|transaction\s*(?:id|no|number)|ref(?:erence)?)\s*[:#-]?\s*([A-Z0-9]{6,})", re.I)

app = FastAPI(title="PayShield AI", description="Digital payment protection prototype. Payment records are simulated.", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY, content TEXT NOT NULL, classification TEXT NOT NULL,
                risk_score INTEGER NOT NULL, reasons TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY, sender_id TEXT NOT NULL, receiver_upi TEXT NOT NULL,
                amount REAL NOT NULL, risk_score INTEGER NOT NULL, classification TEXT NOT NULL,
                reasons TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS payment_records (
                reference TEXT PRIMARY KEY, order_id TEXT, amount REAL NOT NULL,
                receiver_upi TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS payment_requests (
                order_id TEXT PRIMARY KEY, merchant TEXT NOT NULL, amount REAL NOT NULL,
                receiver_upi TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL,
                risk_score INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
            );
            """
        )
        if db.execute("SELECT COUNT(*) FROM payment_records").fetchone()[0] == 0:
            samples = [
                ("PSH-DEMO-1001", "DEMO-ORDER-1001", 1250.0, "cornerstore@upi", "success"),
                ("PSH-DEMO-1002", "DEMO-ORDER-1002", 499.0, "cornerstore@upi", "pending"),
                ("PSH-DEMO-1003", "DEMO-ORDER-1003", 2200.0, "cornerstore@upi", "failed"),
                ("PSH-DEMO-2001", None, 850.0, "market@upi", "success"),
            ]
            db.executemany(
                "INSERT INTO payment_records VALUES (?, ?, ?, ?, ?, ?)",
                [(*row, now()) for row in samples],
            )
        if db.execute("SELECT COUNT(*) FROM payment_requests").fetchone()[0] == 0:
            db.execute(
                "INSERT INTO payment_requests VALUES (?, ?, ?, ?, ?, ?)",
                ("DEMO-ORDER-1001", "Corner Store", 1250, "cornerstore@upi", "verified", now()),
            )


init_db()


class MessageInput(BaseModel):
    message: str = Field(min_length=3, max_length=5000)


class TransactionInput(BaseModel):
    sender_id: str = Field(min_length=1, max_length=100)
    receiver_upi: str = Field(min_length=3, max_length=150)
    amount: float = Field(gt=0, le=10_000_000)
    recent_transactions: int = Field(default=1, ge=0, le=1000)
    average_amount: float = Field(default=0, ge=0, le=10_000_000)
    is_receiver_new: bool = False
    unusual_time: bool = False
    receiver_previous_count: int = Field(default=0, ge=0)
    device_anomaly: bool = False
    receiver_verified: bool = False


class VerifyInput(BaseModel):
    amount: float = Field(gt=0)
    receiver_upi: str = Field(min_length=3, max_length=150)
    reference: str = Field(min_length=4, max_length=100)


class RequestInput(BaseModel):
    merchant: str = Field(min_length=2, max_length=120)
    amount: float = Field(gt=0, le=10_000_000)
    receiver_upi: str = Field(min_length=3, max_length=150)


class ReportInput(BaseModel):
    category: str = Field(min_length=2, max_length=80)
    description: str = Field(min_length=3, max_length=2000)
    risk_score: int = Field(ge=0, le=100)


class RegisterInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str
    password: str = Field(min_length=8, max_length=200)


class LoginInput(BaseModel):
    email: str
    password: str


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{salt.hex()}:{digest.hex()}"


def row_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def classify_message(text: str) -> dict:
    normalized = text.lower()
    patterns = {
        "Unexpected prize or reward": r"\b(won|winner|prize|lottery|reward|claim your gift)\b",
        "Urgency or threat language": r"\b(urgent|immediately|expires today|account.*(suspend|block)|act now)\b",
        "Request for sensitive information": r"\b(password|bank details|pin|otp|card number|personal information)\b",
        "Impersonation or payment pressure": r"\b(customer care|support team|verify your account|send (?:money|payment))\b",
    }
    reasons = [reason for reason, pattern in patterns.items() if re.search(pattern, normalized)]
    urls = URL_RE.findall(text)
    suspicious_urls = [url for url in urls if re.search(r"(?:bit\.ly|tinyurl|\.tk\b|secure[-.]|login[-.]|verify[-.])", url, re.I)]
    if suspicious_urls:
        reasons.append("URL uses a shortened or deceptive-looking address")
    # Combine the fitted demo text model's probability with explicit contextual indicators.
    model_score = 0
    try:
        model = message_model()
        model_score = round(float(model.predict_proba([text])[0][1]) * 100)
    except (ImportError, ValueError):
        pass
    score = min(100, max(model_score, 8 + 22 * len(reasons) + (15 if urls else 0)))
    if len(reasons) >= 3 or score >= 75:
        classification = "High Risk"
    elif reasons or score >= 35:
        classification = "Suspicious"
    else:
        classification = "Safe"
    if not reasons and classification == "Safe":
        reasons.append("No strong phishing indicators found in this demo analysis")
    recommendations = (
        ["Do not click links or share credentials, OTPs, or banking details.", "Contact the organization using an independently verified number."]
        if classification != "Safe"
        else ["Continue to verify unexpected requests through an official channel."]
    )
    return {"classification": classification, "risk_score": score, "reasons": reasons, "urls": urls, "recommendations": recommendations}


def transaction_assessment(data: TransactionInput) -> dict:
    reasons = []
    score = 8
    ratio = data.amount / max(data.average_amount, 1)
    if data.average_amount > 0 and ratio >= 5:
        score += 20
        reasons.append("Amount is substantially above the supplied historical average")
    if data.is_receiver_new and data.receiver_previous_count == 0:
        score += 12
        reasons.append("Receiver is new; verify the UPI ID before paying")
    if data.unusual_time:
        score += 10
        reasons.append("Transaction time is unusual for this account")
    if data.recent_transactions >= 6:
        score += 25
        reasons.append("Several recent transactions may indicate rapid activity")
    if data.device_anomaly:
        score += 24
        reasons.append("Device or session anomaly was reported")
    if data.receiver_verified:
        score -= 15
        reasons.append("Receiver is marked verified in this demo")
    model_features = [[
        min(ratio, 20),
        data.recent_transactions,
        int(data.is_receiver_new),
        int(data.unusual_time),
        data.receiver_previous_count,
        int(data.device_anomaly),
        int(data.receiver_verified),
    ]]
    classifier, anomaly_model = transaction_models()
    learned_pattern = bool(classifier.predict(model_features)[0])
    anomaly_detected = anomaly_model.predict(model_features)[0] == -1
    if learned_pattern:
        score = max(score, 55)
        reasons.append("Combined behavior resembles a high-risk pattern in the synthetic training examples")
    elif anomaly_detected:
        reasons.append("Activity is unusual compared with synthetic demo data; this is not proof of fraud")
    score = max(0, min(100, score))
    level = "High Risk" if score >= 70 else "Medium Risk" if score >= 35 else "Low Risk"
    action = "Cancel or independently verify the payment before proceeding." if level == "High Risk" else "Verify the receiver and confirm details; this warning is not a payment block." if level == "Medium Risk" else "Review payment details before confirming."
    return {
        "classification": level,
        "risk_score": score,
        "reasons": reasons or ["No strong contextual risk indicators were supplied"],
        "action": action,
        "anomaly_detected": bool(anomaly_detected or data.device_anomaly or data.recent_transactions >= 6 or (data.average_amount > 0 and ratio >= 5)),
        "notice": "Uses a Random Forest trained on synthetic examples plus contextual checks. Scores are not calibrated probabilities; an anomaly is not proof of fraud.",
    }


def screenshot_fields(text: str) -> dict:
    amount_match = AMOUNT_RE.search(text)
    upi_match = UPI_RE.search(text)
    ref_match = REF_RE.search(text)
    lowered = text.lower()
    status = "pending" if "pending" in lowered else "success" if any(word in lowered for word in ("success", "successful", "paid")) else "unknown"
    return {
        "amount": float(amount_match.group(1).replace(",", "")) if amount_match else None,
        "receiver_upi": upi_match.group(0) if upi_match else None,
        "reference": ref_match.group(1) if ref_match else None,
        "status": status,
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "simulated prototype"}


@app.post("/api/messages/analyze")
def analyze_message(payload: MessageInput):
    result = classify_message(payload.message)
    with connect() as db:
        db.execute(
            "INSERT INTO messages (content, classification, risk_score, reasons, created_at) VALUES (?, ?, ?, ?, ?)",
            (payload.message, result["classification"], result["risk_score"], json.dumps(result["reasons"]), now()),
        )
    return result


@app.post("/api/transactions/analyze")
def analyze_transaction(payload: TransactionInput):
    result = transaction_assessment(payload)
    with connect() as db:
        db.execute(
            "INSERT INTO transactions (sender_id, receiver_upi, amount, risk_score, classification, reasons, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (payload.sender_id, payload.receiver_upi, payload.amount, result["risk_score"], result["classification"], json.dumps(result["reasons"]), now()),
        )
    return result


@app.get("/api/transactions/history")
def transaction_history():
    with connect() as db:
        return [row_dict(r) for r in db.execute("SELECT * FROM transactions ORDER BY id DESC LIMIT 50")]


@app.post("/api/payments/verify")
def verify_payment(payload: VerifyInput):
    with connect() as db:
        record = db.execute("SELECT * FROM payment_records WHERE reference = ?", (payload.reference,)).fetchone()
    if not record:
        return {"verification": "Payment Not Verified", "verified": False, "reasons": ["No matching payment record in the simulated demo database."], "notice": "A screenshot or demo record is not authoritative bank confirmation."}
    mismatches = []
    if abs(float(record["amount"]) - payload.amount) > 0.01:
        mismatches.append("Amount does not match the simulated record.")
    if record["receiver_upi"].lower() != payload.receiver_upi.lower():
        mismatches.append("Receiver UPI ID does not match the simulated record.")
    if mismatches:
        status = "Data Mismatch"
    elif record["status"] == "success":
        status = "Payment Verified (Simulated)"
    elif record["status"] == "pending":
        status = "Payment Pending"
    else:
        status = "Payment Not Verified"
    return {
        "verification": status,
        "verified": status == "Payment Verified (Simulated)",
        "payment_status": record["status"],
        "reasons": mismatches or [f"Matching simulated record has status: {record['status']}."],
        "notice": "Demo-only verification. Never mark a payment complete using a screenshot; confirm in your authorized payment provider.",
    }


@app.post("/api/payments/upload-screenshot")
async def upload_screenshot(file: Annotated[UploadFile, File()]):
    if file.content_type not in {"image/png", "image/jpeg"}:
        raise HTTPException(415, "Upload a PNG or JPEG image.")
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image exceeds the 5 MB limit.")
    try:
        from PIL import Image
        image = Image.open(io.BytesIO(contents))
        image.verify()
    except Exception as exc:
        raise HTTPException(400, "The uploaded file is not a valid PNG or JPEG image.") from exc
    # OCR is optional: this prototype does not claim OCR-derived proof or authenticity.
    try:
        import pytesseract

        text = pytesseract.image_to_string(Image.open(io.BytesIO(contents)))
        return {"filename": file.filename, "extracted": screenshot_fields(text), "ocr_available": True, "notice": "OCR is fallible. This extraction does not establish that a payment occurred."}
    except ImportError:
        return {"filename": file.filename, "extracted": None, "ocr_available": False, "notice": "Image validated. OCR is not installed; enter the visible details manually and verify against demo records."}
    except Exception as exc:
        raise HTTPException(503, f"OCR could not process the image: {exc}") from exc


@app.get("/api/payments/history")
def payment_history():
    with connect() as db:
        return [row_dict(r) for r in db.execute("SELECT * FROM payment_records ORDER BY created_at DESC")]


@app.post("/api/merchant/create-request")
def create_payment_request(payload: RequestInput):
    order_id = f"PS-{secrets.token_hex(4).upper()}"
    with connect() as db:
        db.execute(
            "INSERT INTO payment_requests VALUES (?, ?, ?, ?, ?, ?)",
            (order_id, payload.merchant, payload.amount, payload.receiver_upi, "pending", now()),
        )
    return {"order_id": order_id, "merchant": payload.merchant, "amount": payload.amount, "receiver_upi": payload.receiver_upi, "status": "pending", "notice": "Simulated payment request. No real QR code or payment is generated."}


@app.get("/api/merchant/dashboard")
def merchant_dashboard():
    with connect() as db:
        requests = [row_dict(r) for r in db.execute("SELECT * FROM payment_requests ORDER BY created_at DESC")]
        records = [row_dict(r) for r in db.execute("SELECT * FROM payment_records ORDER BY created_at DESC")]
        verified = [r for r in requests if r["status"] == "verified"]
        return {
            "total_transactions": len(records),
            "total_verified": len(verified),
            "pending_payments": sum(r["status"] == "pending" for r in requests),
            "unverified_claims": len(records),
            "suspicious_attempts": sum(r["status"] == "failed" for r in records),
            "verified_amount": sum(r["amount"] for r in verified),
            "requests": requests,
            "records": records,
        }


@app.get("/api/merchant/transactions")
def merchant_transactions(status: str | None = None):
    with connect() as db:
        rows = [row_dict(r) for r in db.execute("SELECT * FROM payment_requests ORDER BY created_at DESC")]
    return [r for r in rows if not status or r["status"].lower() == status.lower()]


@app.get("/api/reports")
def reports():
    with connect() as db:
        return [row_dict(r) for r in db.execute("SELECT * FROM reports ORDER BY created_at DESC")]


@app.post("/api/reports/create")
def create_report(payload: ReportInput):
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO reports (category, description, risk_score, status, created_at) VALUES (?, ?, ?, 'open', ?)",
            (payload.category, payload.description, payload.risk_score, now()),
        )
        return {"id": cursor.lastrowid, "status": "open"}


@app.get("/api/reports/export")
def export_reports():
    with connect() as db:
        rows = db.execute("SELECT id, category, description, risk_score, status, created_at FROM reports ORDER BY created_at DESC").fetchall()
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(["id", "category", "description", "risk_score", "status", "created_at"])
    writer.writerows([tuple(row) for row in rows])
    stream.seek(0)
    return StreamingResponse(iter([stream.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=payshield-reports.csv"})


@app.get("/api/analytics/dashboard")
def analytics_dashboard():
    with connect() as db:
        message_total = db.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        suspicious = db.execute("SELECT COUNT(*) FROM messages WHERE classification != 'Safe'").fetchone()[0]
        transaction_total = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        high_risk = db.execute("SELECT COUNT(*) FROM transactions WHERE classification = 'High Risk'").fetchone()[0]
        activity = [row_dict(r) for r in db.execute(
            "SELECT 'message' AS type, classification AS result, risk_score, created_at FROM messages UNION ALL SELECT 'transaction', classification, risk_score, created_at FROM transactions ORDER BY created_at DESC LIMIT 8"
        )]
        return {"messages_analyzed": message_total, "suspicious_messages": suspicious, "transactions_analyzed": transaction_total, "high_risk_alerts": high_risk, "recent_activity": activity}


@app.post("/api/auth/register")
def register(payload: RegisterInput):
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", payload.email):
        raise HTTPException(422, "Enter a valid email address.")
    hashed = password_hash(payload.password)
    try:
        with connect() as db:
            cursor = db.execute("INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)", (payload.name, payload.email.lower(), hashed, now()))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "An account with this email already exists.") from exc
    return {"user_id": cursor.lastrowid, "name": payload.name, "email": payload.email.lower(), "notice": "Prototype authentication; use only non-sensitive demo credentials."}


@app.post("/api/auth/login")
def login(payload: LoginInput):
    with connect() as db:
        stored = db.execute("SELECT id, name, email, password_hash FROM users WHERE email = ?", (payload.email.lower(),)).fetchone()
    if stored:
        salt_hex, _ = stored["password_hash"].split(":", 1)
        valid = secrets.compare_digest(password_hash(payload.password, bytes.fromhex(salt_hex)), stored["password_hash"])
        user = {"id": stored["id"], "name": stored["name"], "email": stored["email"]} if valid else None
    else:
        user = None
    if not user:
        raise HTTPException(401, "Invalid email or password.")
    return {"user": user, "notice": "Prototype session only; production authentication is not configured."}


FRONTEND_BUILD = ROOT / "frontend" / "dist"
if FRONTEND_BUILD.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_BUILD, html=True), name="frontend")
