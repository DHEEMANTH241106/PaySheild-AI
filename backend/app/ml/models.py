from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path


MODEL_DIR = Path(__file__).resolve().parents[1] / "trained_models"


@lru_cache(maxsize=1)
def message_model():
    artifact = MODEL_DIR / "message_model.joblib"
    if artifact.exists():
        import joblib

        return joblib.load(artifact)
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline

    dataset = Path(__file__).resolve().parents[2] / "datasets" / "messages.csv"
    with dataset.open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
    texts = [row["message"] for row in rows]
    labels = [int(row["label"]) for row in rows]
    return make_pipeline(
        TfidfVectorizer(ngram_range=(1, 2), max_features=400),
        LogisticRegression(class_weight="balanced", max_iter=500, random_state=17),
    ).fit(texts, labels)


def _transaction_rows():
    rows = []
    labels = []
    for ratio in (0.5, 1, 2, 6, 12):
        for recent in (0, 1, 3, 6, 10):
            for new in (0, 1):
                for unusual in (0, 1):
                    for previous in (0, 5):
                        for device in (0, 1):
                            for verified in (0, 1):
                                features = [ratio, recent, new, unusual, previous, device, verified]
                                combined_signals = sum((new and previous == 0, unusual, device, recent >= 6, ratio >= 6))
                                high_risk_pattern = (
                                    (device and recent >= 6)
                                    or (recent >= 6 and new and not verified and previous == 0)
                                    or (ratio >= 6 and recent >= 6 and new and not verified)
                                    or (unusual and recent >= 6 and new and not verified)
                                )
                                rows.append(features)
                                labels.append(int(high_risk_pattern and combined_signals >= 2))
    return rows, labels


@lru_cache(maxsize=1)
def transaction_models():
    artifact = MODEL_DIR / "transaction_models.joblib"
    if artifact.exists():
        import joblib

        models = joblib.load(artifact)
        return models["classifier"], models["anomaly"]
    from sklearn.ensemble import IsolationForest, RandomForestClassifier

    rows, labels = _transaction_rows()
    classifier = RandomForestClassifier(n_estimators=120, max_depth=8, class_weight="balanced", random_state=23)
    classifier.fit(rows, labels)
    anomaly = IsolationForest(n_estimators=100, contamination=0.08, random_state=23)
    anomaly.fit(rows)
    return classifier, anomaly


def train_and_save(directory):
    import joblib
    from pathlib import Path

    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    message = message_model()
    classifier, anomaly = transaction_models()
    joblib.dump(message, target / "message_model.joblib")
    joblib.dump({"classifier": classifier, "anomaly": anomaly}, target / "transaction_models.joblib")
    return target
