# Model Files Directory

This directory should contain:

1. **whisper-base.wasm** - Whisper WASM model for speech-to-text
   - Download from: https://github.com/ggerganov/whisper.cpp
   - Size: ~40MB
   - Required for offline STT functionality

2. **tts-model.onnx** - TTS model for text-to-speech synthesis
   - Coqui-style TTS model in ONNX format
   - Size: ~20-50MB depending on model
   - Required for offline TTS functionality

## For Production Deployment:

1. Download the actual model files
2. Place them in this directory
3. Update the worker scripts to load real models
4. Test offline functionality

## Current Status:
This demo uses simulated models for demonstration purposes.
In a production environment, you would replace the mock implementations
with actual Whisper WASM and TTS model integrations.