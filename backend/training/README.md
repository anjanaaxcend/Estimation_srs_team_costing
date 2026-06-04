# Local NLP Training Sandbox

This directory contains the training architecture for the pre-AI fallback execution. The components in this folder are decoupled from the OpenAI integration and rely purely on Scikit-Learn logic to infer rules and parameters.

## Core Files

1. `requirements_training_data.json`
   Acts as the vocabulary and scenario database. All customizations to platform behaviors (like adding "FinTech" as a domain, or new "Developer Level" logic) should be added to the array catalysts here.

2. `train.py`
   The execution script. Run this after updating the JSON:
   `python train.py`

3. `requirements_model.pkl` (Generated)
   The binary artifact created by the training process. The extraction engine automatically detects and loads this.

Note: In a pure-OpenAI workflow, this directory is functionally obsolete. However, it must remain structurally intact for the local fallback interceptors to compile without throwing 500 errors.
