import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule as Recognition, useSpeechRecognitionEvent } from 'expo-speech-recognition';

const speechErrors: Record<string, string> = {
  'not-allowed': '请在系统设置中允许麦克风和语音识别权限。',
  'service-not-allowed': '系统语音识别服务不可用，请检查手机设置。',
  'audio-capture': '无法使用麦克风，请检查权限或关闭正在录音的应用。',
  'network': '语音识别服务连接失败。请检查网络，或直接输入文字。',
  'no-speech': '没有听清，请靠近麦克风再试一次。',
  'language-not-supported': '系统语音服务不支持当前英语语言，请检查手机设置。',
  'busy': '系统语音识别正忙，请稍后重试。',
};

const recognitionOptions = { lang: 'en-US', interimResults: true, continuous: false,
  recordingOptions: { persist: false }, iosTaskHint: 'dictation' } as const;

export const callLabels = {
  connecting: '正在连接', listening: '正在听，请开口', thinking: '正在回复', speaking: 'AI 正在说话',
} as const;
type CallPhase = keyof typeof callLabels;
type Call = {
  controller: AbortController;
  phase: CallPhase;
  recognizing: boolean;
  partial: string;
  final: string;
  timer?: ReturnType<typeof setTimeout>;
  reply: (text: string, signal: AbortSignal) => Promise<string>;
};

export function useVoice(setDraft: (draft: string) => void, setError: (message: string) => void) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'finishing'>('idle');
  const state = useRef(phase);
  const original = useRef('');
  const transcript = useRef('');
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speechId = useRef(0);
  const call = useRef<Call | null>(null);
  const [callPhase, setCallPhase] = useState<CallPhase | null>(null);
  const [callPreview, setCallPreview] = useState('');
  const changePhase = (next: typeof phase) => { state.current = next; setPhase(next); };
  const complete = () => {
    clearTimeout(deadline.current);
    changePhase('idle');
  };
  const watchdog = (ms: number) => {
    clearTimeout(deadline.current);
    deadline.current = setTimeout(() => {
      Recognition.abort();
      setError('语音识别未正常结束。已保留当前文字，可以编辑或重试。');
      complete();
    }, ms);
  };

  useSpeechRecognitionEvent('start', () => {
    const session = call.current;
    if (session?.recognizing) {
      clearTimeout(session.timer);
      session.timer = setTimeout(() => {
        if (call.current === session && session.recognizing) {
          endCall();
          setError('本轮语音识别超时。请重新接通后再试。');
        }
      }, 55_000);
      setCallStage(session, 'listening');
      return;
    }
    if (state.current !== 'starting') return;
    clearTimeout(deadline.current);
    changePhase('recording');
  });
  useSpeechRecognitionEvent('result', event => {
    const best = event.results[0]?.transcript.trim();
    const session = call.current;
    if (session) {
      if (session.recognizing && best) {
        session.partial = best.slice(0, 2000);
        if (event.isFinal) session.final = session.partial;
        setCallPreview(session.partial);
      }
      return;
    }
    if (state.current === 'idle') return;
    if (best) {
      transcript.current = best;
      setDraft([original.current.trimEnd(), best].filter(Boolean).join(' ').slice(0, 2000));
    }
  });
  useSpeechRecognitionEvent('nomatch', () => {
    if (state.current !== 'idle' && !transcript.current) setError(speechErrors['no-speech']);
  });
  useSpeechRecognitionEvent('error', event => {
    const session = call.current;
    if (session?.recognizing) {
      if (event.error === 'no-speech' || event.error === 'speech-timeout') {
        // The native module follows the error with an end event.
        session.final = '';
        return;
      }
      endCall();
      setError(speechErrors[event.error] ?? '语音通话已中断，请重新接通。');
      return;
    }
    if (state.current === 'idle') return;
    if (event.error !== 'aborted' && (event.error !== 'no-speech' || !transcript.current)) {
      setError(speechErrors[event.error] ?? '语音识别失败。已保留当前文字，可以编辑或重试。');
    }
    complete();
  });
  useSpeechRecognitionEvent('end', () => {
    const session = call.current;
    if (session) {
      if (!session.recognizing) return;
      session.recognizing = false;
      clearTimeout(session.timer);
      if (session.final) void runCallTurn(session, session.final);
      else scheduleListening(session, 450);
    } else complete();
  });

  useEffect(() => () => {
    clearTimeout(deadline.current);
    const session = call.current;
    call.current = null;
    if (session) {
      clearTimeout(session.timer);
      session.controller.abort();
    }
    if (state.current !== 'idle' || session?.recognizing) Recognition.abort();
    Speech.stop().catch(() => undefined);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'background' && call.current) endCall();
    });
    return () => subscription.remove();
  }, []);

  async function stopSpeech() {
    speechId.current += 1;
    await Speech.stop().catch(() => undefined);
  }

  async function speak(text: string, settled?: () => void, signal?: AbortSignal) {
    if (!text || state.current !== 'idle' || signal?.aborted) { settled?.(); return; }
    const id = ++speechId.current;
    try {
      await Speech.stop();
      if (speechId.current !== id || state.current !== 'idle' || signal?.aborted) return;
      Speech.speak(text, { language: 'en-US', rate: 0.93, useApplicationAudioSession: false,
        onDone: settled, onStopped: settled, onError: () => {
          if (signal?.aborted) return;
          setError('系统朗读失败，请检查手机的英语语音设置。');
          if (signal) endCall();
        } });
    } catch {
      if (signal?.aborted) return;
      setError('系统朗读失败，请检查手机的英语语音设置。');
      if (signal) endCall();
    }
  }

  async function ensurePermission() {
    if (!Recognition.isRecognitionAvailable()) throw new Error('手机未启用可用的系统语音识别服务。你仍可以打字聊天。');
    const permission = await Recognition.requestPermissionsAsync();
    if (!permission.granted) throw new Error(speechErrors['not-allowed']);
  }

  function setCallStage(session: Call, next: CallPhase) {
    session.phase = next;
    setCallPhase(next);
  }

  function scheduleListening(session: Call, delay: number) {
    if (call.current !== session) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      if (call.current !== session) return;
      session.partial = '';
      session.final = '';
      setCallPreview('');
      setCallStage(session, 'connecting');
      session.recognizing = true;
      session.timer = setTimeout(() => {
        if (call.current !== session) return;
        endCall();
        setError('语音识别未启动，请检查系统语音服务后重试。');
      }, 10_000);
      try { Recognition.start(recognitionOptions); } catch {
        endCall();
        setError('无法启动麦克风，请重新接通。');
      }
    }, delay);
  }

  async function runCallTurn(session: Call, text: string) {
    setError('');
    setCallStage(session, 'thinking');
    try {
      const reply = await session.reply(text, session.controller.signal);
      if (call.current !== session) return;
      if (!reply) { scheduleListening(session, 250); return; }
      setCallStage(session, 'speaking');
      session.timer = setTimeout(() => {
        if (call.current !== session) return;
        endCall();
        setError('朗读未正常结束，请重新接通。');
      }, 90_000);
      await speak(reply, () => {
        if (call.current === session && session.phase === 'speaking') {
          setCallStage(session, 'connecting');
          scheduleListening(session, 300);
        }
      }, session.controller.signal);
    } catch (error) {
      if (call.current !== session) return;
      endCall();
      setError(error instanceof Error ? error.message : '通话请求失败，请重试。');
    }
  }

  function endCall() {
    const session = call.current;
    if (!session) return;
    call.current = null;
    clearTimeout(session.timer);
    session.controller.abort();
    if (session.recognizing) Recognition.abort();
    void stopSpeech();
    setCallPreview('');
    setCallPhase(null);
  }

  async function startCall(prepare: (signal: AbortSignal) => Promise<boolean>, reply: Call['reply']) {
    if (call.current || state.current !== 'idle') return;
    const session: Call = { controller: new AbortController(), phase: 'connecting', recognizing: false, partial: '', final: '', reply };
    call.current = session;
    setError('');
    setCallStage(session, 'connecting');
    try {
      await stopSpeech();
      if (call.current !== session) return;
      const ready = await prepare(session.controller.signal);
      if (call.current !== session) return;
      if (!ready) { endCall(); return; }
      await ensurePermission();
      if (call.current === session) scheduleListening(session, 300);
    } catch (error) {
      if (call.current !== session) return;
      endCall();
      setError(error instanceof Error ? error.message : '无法接通语音通话。');
    }
  }

  async function toggle(draft: string) {
    if (call.current) return;
    if (state.current === 'recording') {
      changePhase('finishing');
      try { Recognition.stop(); watchdog(7500); } catch { complete(); setError('无法结束录音，请再试一次。'); }
      return;
    }
    if (state.current !== 'idle') return;
    changePhase('starting');
    original.current = draft;
    transcript.current = '';
    setError('');
    try {
      await stopSpeech();
      await ensurePermission();
      Recognition.start(recognitionOptions);
      watchdog(10_000);
    } catch (error) {
      complete();
      setError(error instanceof Error ? error.message : '无法开始语音识别。');
    }
  }

  return { phase, toggle, speak, stopSpeech, callPhase, callPreview, startCall, endCall };
}
