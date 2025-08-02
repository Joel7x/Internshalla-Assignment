'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, Settings, Activity, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

interface PerformanceMetrics {
  sttLatency: number;
  apiLatency: number;
  ttsLatency: number;
  totalLatency: number;
}

interface AudioChunk {
  data: Float32Array;
  timestamp: number;
}

export default function VoiceAssistant() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [currentStatus, setCurrentStatus] = useState('Ready');
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    sttLatency: 0,
    apiLatency: 0,
    ttsLatency: 0,
    totalLatency: 0
  });
  const [audioLevel, setAudioLevel] = useState(0);
  const [isModelLoaded, setIsModelLoaded] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const whisperWorkerRef = useRef<Worker | null>(null);
  const ttsWorkerRef = useRef<Worker | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioChunksRef = useRef<AudioChunk[]>([]);

  // Initialize workers and check online status
  useEffect(() => {
    // Check online status
    setIsOffline(!navigator.onLine);
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initialize Whisper worker
    whisperWorkerRef.current = new Worker('/workers/whisper-worker.js');
    whisperWorkerRef.current.onmessage = handleWhisperMessage;

    // Initialize TTS worker
    ttsWorkerRef.current = new Worker('/workers/tts-worker.js');
    ttsWorkerRef.current.onmessage = handleTTSMessage;

    // Load models
    loadModels();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      whisperWorkerRef.current?.terminate();
      ttsWorkerRef.current?.terminate();
    };
  }, []);

  const loadModels = async () => {
    setCurrentStatus('Loading models...');
    
    try {
      // Initialize Whisper
      whisperWorkerRef.current?.postMessage({ 
        type: 'init',
        modelUrl: '/models/whisper-base.wasm'
      });

      // Initialize TTS
      ttsWorkerRef.current?.postMessage({
        type: 'init',
        modelUrl: '/models/tts-model.onnx'
      });

      setIsModelLoaded(true);
      setCurrentStatus('Ready');
    } catch (error) {
      console.error('Failed to load models:', error);
      setCurrentStatus('Error loading models');
    }
  };

  const handleWhisperMessage = (event: MessageEvent) => {
    const { type, data } = event.data;
    
    switch (type) {
      case 'transcript':
        setTranscript(data.text);
        if (data.final) {
          const sttLatency = Date.now() - startTimeRef.current;
          setMetrics(prev => ({ ...prev, sttLatency }));
          processWithOpenAI(data.text);
        }
        break;
      case 'error':
        console.error('Whisper error:', data);
        setCurrentStatus('STT Error');
        break;
    }
  };

  const handleTTSMessage = (event: MessageEvent) => {
    const { type, data } = event.data;
    
    switch (type) {
      case 'audio':
        const ttsLatency = Date.now() - startTimeRef.current - metrics.sttLatency - metrics.apiLatency;
        setMetrics(prev => ({ 
          ...prev, 
          ttsLatency,
          totalLatency: Date.now() - startTimeRef.current
        }));
        playAudio(data.audioBuffer);
        setCurrentStatus('Playing response');
        break;
      case 'error':
        console.error('TTS error:', data);
        setCurrentStatus('TTS Error');
        break;
    }
  };

  const startRecording = async () => {
    if (!isModelLoaded) {
      setCurrentStatus('Models not loaded');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });

      // Set up audio context for visualization
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // Start audio level monitoring
      monitorAudioLevels();

      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Convert to Float32Array for processing
          const reader = new FileReader();
          reader.onload = () => {
            const arrayBuffer = reader.result as ArrayBuffer;
            const audioData = new Float32Array(arrayBuffer.byteLength / 4);
            new DataView(arrayBuffer).getFloat32(0, true);
            
            audioChunksRef.current.push({
              data: audioData,
              timestamp: Date.now()
            });

            // Send to Whisper worker for real-time processing
            whisperWorkerRef.current?.postMessage({
              type: 'process',
              audioData: audioData
            });
          };
          reader.readAsArrayBuffer(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        setCurrentStatus('Processing speech...');
        
        // Send final audio to Whisper
        whisperWorkerRef.current?.postMessage({
          type: 'finalize'
        });
      };

      startTimeRef.current = Date.now();
      mediaRecorderRef.current.start(100); // 100ms chunks for real-time processing
      setIsRecording(true);
      setCurrentStatus('Listening...');
      setTranscript('');
      setResponse('');
    } catch (error) {
      console.error('Failed to start recording:', error);
      setCurrentStatus('Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setAudioLevel(0);
    }
  };

  const monitorAudioLevels = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const updateLevel = () => {
      if (!analyserRef.current || !isRecording) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(Math.min(100, (average / 255) * 100));
      
      if (isRecording) {
        requestAnimationFrame(updateLevel);
      }
    };

    updateLevel();
  };

  const processWithOpenAI = async (text: string) => {
    if (isOffline) {
      setCurrentStatus('Offline - Cannot reach OpenAI');
      return;
    }

    setIsProcessing(true);
    setCurrentStatus('Thinking...');
    
    const apiStartTime = Date.now();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });

      if (!response.ok) throw new Error('API request failed');

      const data = await response.json();
      const apiLatency = Date.now() - apiStartTime;
      
      setMetrics(prev => ({ ...prev, apiLatency }));
      setResponse(data.response);
      setCurrentStatus('Generating speech...');

      // Send to TTS worker
      ttsWorkerRef.current?.postMessage({
        type: 'synthesize',
        text: data.response
      });

    } catch (error) {
      console.error('OpenAI API error:', error);
      setCurrentStatus('API Error');
    } finally {
      setIsProcessing(false);
    }
  };

  const playAudio = (audioBuffer: ArrayBuffer) => {
    if (!audioContextRef.current) return;

    audioContextRef.current.decodeAudioData(audioBuffer)
      .then(decodedData => {
        const source = audioContextRef.current!.createBufferSource();
        source.buffer = decodedData;
        source.connect(audioContextRef.current!.destination);
        source.start();
        
        source.onended = () => {
          setCurrentStatus('Ready');
        };
      })
      .catch(error => {
        console.error('Audio playback error:', error);
        setCurrentStatus('Playback Error');
      });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
            Offline Voice Assistant
          </h1>
          <p className="text-slate-400">Local STT/TTS with OpenAI Chat Completion</p>
          
          <div className="flex items-center justify-center gap-4 mt-4">
            <Badge variant={isOffline ? "destructive" : "default"} className="flex items-center gap-2">
              {isOffline ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
              {isOffline ? 'Offline' : 'Online'}
            </Badge>
            <Badge variant="outline" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              {currentStatus}
            </Badge>
          </div>
        </div>

        {/* Main Interface */}
        <Card className="bg-black/20 backdrop-blur-lg border-slate-700 mb-8">
          <CardContent className="p-8">
            {/* Voice Recording Interface */}
            <div className="text-center mb-8">
              <div className="relative inline-block">
                <Button
                  size="lg"
                  className={`w-24 h-24 rounded-full text-white transition-all duration-300 ${
                    isRecording 
                      ? 'bg-red-500 hover:bg-red-600 animate-pulse scale-110' 
                      : 'bg-blue-500 hover:bg-blue-600 hover:scale-105'
                  }`}
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={!isModelLoaded || isProcessing}
                >
                  {isRecording ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
                </Button>
                
                {/* Audio Level Visualization */}
                {isRecording && (
                  <div className="absolute -inset-4 border-2 border-blue-400 rounded-full animate-ping opacity-50"></div>
                )}
              </div>
              
              <p className="mt-4 text-slate-300">
                {isRecording ? 'Listening... Click to stop' : 'Click to start recording'}
              </p>
              
              {/* Audio Level Bar */}
              {isRecording && (
                <div className="mt-4 max-w-xs mx-auto">
                  <Progress value={audioLevel} className="h-2" />
                  <p className="text-sm text-slate-400 mt-1">Audio Level: {audioLevel.toFixed(0)}%</p>
                </div>
              )}
            </div>

            {/* Transcript and Response */}
            <div className="space-y-6">
              {transcript && (
                <div>
                  <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    <Mic className="w-5 h-5 text-blue-400" />
                    You said:
                  </h3>
                  <p className="bg-slate-800/50 p-4 rounded-lg text-slate-200">
                    {transcript}
                  </p>
                </div>
              )}

              {response && (
                <div>
                  <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-purple-400" />
                    Assistant:
                  </h3>
                  <p className="bg-slate-800/50 p-4 rounded-lg text-slate-200">
                    {response}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Performance Metrics */}
        <Card className="bg-black/20 backdrop-blur-lg border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Performance Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-400">{metrics.sttLatency}ms</p>
                <p className="text-sm text-slate-400">STT Latency</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-400">{metrics.apiLatency}ms</p>
                <p className="text-sm text-slate-400">API Latency</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-400">{metrics.ttsLatency}ms</p>
                <p className="text-sm text-slate-400">TTS Latency</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-orange-400">{metrics.totalLatency}ms</p>
                <p className="text-sm text-slate-400">Total Time</p>
              </div>
            </div>
            
            <Separator className="my-4 bg-slate-700" />
            
            <div className="text-center">
              <p className="text-sm text-slate-400">
                Target: &lt; 1200ms | Current: {metrics.totalLatency}ms
                <span className={`ml-2 ${metrics.totalLatency < 1200 ? 'text-green-400' : 'text-red-400'}`}>
                  {metrics.totalLatency < 1200 ? '✓ Good' : '⚠ Slow'}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Status Footer */}
        <div className="text-center mt-8 text-slate-400">
          <p className="text-sm">
            This app works offline after initial load. Only OpenAI calls require internet.
          </p>
        </div>
      </div>
    </div>
  );
}