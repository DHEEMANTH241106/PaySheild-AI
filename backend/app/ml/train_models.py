from pathlib import Path

from app.ml.models import train_and_save

if __name__ == "__main__":
    output = Path(__file__).resolve().parents[1] / "trained_models"
    train_and_save(output)
    print(f"Trained demo models saved to {output}")
