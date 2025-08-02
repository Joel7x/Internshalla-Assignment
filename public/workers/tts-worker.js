// TTS Worker for Text-to-Speech Synthesis
class TTSWorker {
  constructor() {
    this.model = null;
    this.isInitialized = false;
    this.audioContext = null;
    this.sampleRate = 22050;
  }

  async initialize(modelUrl) {
    try {
      console.log('Initializing TTS model from:', modelUrl);
      
      // Initialize AudioContext for audio generation
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      
      // Simulate model loading delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      this.isInitialized = true;
      self.postMessage({ type: 'initialized' });
    } catch (error) {
      console.error('TTS initialization error:', error);
      self.postMessage({ type: 'error', data: error.message });
    }
  }

  async synthesizeAudio(text) {
    if (!this.isInitialized) {
      self.postMessage({ type: 'error', data: 'Model not initialized' });
      return;
    }

    try {
      // Simulate TTS processing time based on text length
      const processingTime = Math.min(1000, text.length * 50);
      await new Promise(resolve => setTimeout(resolve, processingTime));

      // Generate synthetic audio
      // In a real implementation, you would:
      // 1. Tokenize the text
      // 2. Run TTS model inference
      // 3. Generate mel-spectrograms
      // 4. Convert to audio waveform
      // 5. Return audio buffer

      const audioBuffer = this.generateSyntheticSpeech(text);

      self.postMessage({
        type: 'audio',
        data: {
          audioBuffer: audioBuffer,
          sampleRate: this.sampleRate,
          duration: audioBuffer.byteLength / (this.sampleRate * 2) // 16-bit audio
        }
      });

    } catch (error) {
      console.error('TTS synthesis error:', error);
      self.postMessage({ type: 'error', data: error.message });
    }
  }

  generateSyntheticSpeech(text) {
    // Generate a simple synthetic audio for demonstration
    // This creates a basic tone pattern that varies with text content
    const duration = Math.max(1, text.length * 0.1); // ~100ms per character
    const samples = Math.floor(this.sampleRate * duration);
    const buffer = new ArrayBuffer(samples * 2); // 16-bit samples
    const view = new DataView(buffer);

    for (let i = 0; i < samples; i++) {
      const t = i / this.sampleRate;
      
      // Create a more speech-like synthesis with multiple frequencies
      const baseFreq = 150 + (text.charCodeAt(i % text.length) % 100); // Varies with text
      const harmonics = [1, 2, 3, 4].map(h => h * baseFreq);
      
      let sample = 0;
      harmonics.forEach((freq, idx) => {
        const amplitude = 0.3 / (idx + 1); // Decreasing amplitude for harmonics
        sample += amplitude * Math.sin(2 * Math.PI * freq * t);
      });

      // Add some envelope shaping
      const envelope = Math.sin(Math.PI * (i / samples)) * 0.8;
      sample *= envelope;

      // Add slight randomness for more natural sound
      sample += (Math.random() - 0.5) * 0.05;

      // Convert to 16-bit signed integer
      const intSample = Math.max(-32768, Math.min(32767, sample * 32767));
      view.setInt16(i * 2, intSample, true); // little-endian
    }

    return buffer;
  }
}

const tts = new TTSWorker();

self.onmessage = async function(event) {
  const { type, modelUrl, text } = event.data;

  switch (type) {
    case 'init':
      await tts.initialize(modelUrl);
      break;
    
    case 'synthesize':
      await tts.synthesizeAudio(text);
      break;
    
    default:
      console.warn('Unknown message type:', type);
  }
};