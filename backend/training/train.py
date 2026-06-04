"""
NLP Model Training Pipeline
This script trains the scikit-learn models used for the local fallback mechanism of the AI SRS Builder.
"""
from pathlib import Path
from app.services.local_nlp_requirement_extractor import train_local_nlp_model

def main():
    base_dir = Path(__file__).parent
    training_data_path = base_dir / "requirements_training_data.json"
    model_output_path = base_dir / "requirements_model.pkl"
    
    print(f"Loading training data from: {training_data_path}")
    print("Training NLP multi-label classifiers and sentence extractors...")
    
    train_local_nlp_model(training_data_path, model_output_path)
    
    print(f"Success! Model artifacts saved to: {model_output_path}")
    print("The Local NLP platform is now ready for autonomous extraction.")

if __name__ == "__main__":
    main()
