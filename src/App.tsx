import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { fetch as expoFetch } from 'expo/fetch';
import { ApiSettings, MemorySettings, styles as settingsStyles } from './Settings';
import { coachMessages, memoryKinds, modes, parseCoachReply, requestChat, scenes, validateProfile, type Message, type Mode, type Profile, type ProfileInput, type Scene, type Suggestion } from './core';
import { initialState, makeId, readCredential, readState, removeCredential, writeCredential, writeState, type LocalState } from './storage';
import { Action, Banner, Chip, colors, Icon, IconAction, type IconName, ui } from './ui';
import { callLabels, useVoice } from './voice';

const tabs = [
  { key: 'chat', label: '聊天', icon: 'chatbubble-ellipses-outline' },
  { key: 'scenes', label: '场景', icon: 'grid-outline' },
  { key: 'memory', label: '记忆', icon: 'bookmark-outline' },
  { key: 'api', label: 'API 设置', icon: 'settings-outline' },
] as const satisfies ReadonlyArray<{ key: string; label: string; icon: IconName }>;
type Tab = typeof tabs[number]['key'];
const transport: typeof globalThis.fetch = (input, init) => expoFetch(String(input), init);

function contextChoice(profile: Profile): Promise<'allow' | 'deny' | null> {
  return new Promise(resolve => Alert.alert(
    '允许发送聊天上下文？',
    `「${profile.name}」将通过 ${profile.endpoint} 处理聊天。你可以允许发送近期对话和相关记忆，也可以只发送本轮输入。`,
    [
      { text: '取消', style: 'cancel', onPress: () => resolve(null) },
      { text: '仅本轮', onPress: () => resolve('deny') },
      { text: '允许上下文', onPress: () => resolve('allow') },
    ], { cancelable: true, onDismiss: () => resolve(null) },
  ));
}

export default function App() {
  return <SafeAreaProvider><EnglishTalk /></SafeAreaProvider>;
}

function EnglishTalk() {
  const [state, setState] = useState(initialState);
  const current = useRef(state);
  const writes = useRef(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [tab, setTab] = useState<Tab>('chat');
  const [draft, setDraft] = useState('');
  const [chatError, setChatError] = useState('');
  const [sending, setSending] = useState(false);
  const sendLock = useRef(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const list = useRef<FlatList<Message>>(null);
  const voice = useVoice(setDraft, setChatError);
  const profile = state.profiles.find(item => item.id === state.activeId);
  const scene = scenes[state.scene];

  async function load() {
    setLoading(true); setLoadError(false);
    try {
      const stored = await readState();
      current.current = stored;
      setState(stored);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function commit(change: (old: LocalState) => LocalState, publishAfterWrite = false) {
    const before = current.current;
    const next = change(before);
    current.current = next;
    if (!publishAfterWrite) setState(next);
    const write = writes.current.then(() => writeState(next));
    const publish = write.then(() => {
      if (publishAfterWrite && current.current === next) setState(next);
      setStorageError('');
    }, () => {
      if (publishAfterWrite && current.current === next) { current.current = before; setState(before); }
      setStorageError('本机数据保存失败，请检查剩余空间后重试。');
      throw new Error('本机数据保存失败，请重试。');
    });
    writes.current = publish.catch(() => undefined);
    return publish;
  }

  function update(change: (old: LocalState) => LocalState) {
    void commit(change).catch(() => undefined);
  }

  async function saveProfile(input: ProfileInput, enteredKey: string, original?: Profile) {
    const clean = validateProfile(input);
    const key = enteredKey.trim();
    const addressChanged = !!original && original.endpoint !== clean.endpoint;
    if ((!original || addressChanged) && !key) throw new Error(addressChanged ? '请重新填写适用于新地址的 API Key。' : '请填写 API Key。');
    if (/[\r\n]/.test(key)) throw new Error('API Key 不能包含换行。');
    const credential = key ? makeId() : original!.credential;
    const next: Profile = {
      ...clean, id: original?.id ?? makeId(), credential,
      context: !original || addressChanged || original.provider !== clean.provider ? 'ask' : original.context,
    };
    if (key) await writeCredential(credential, key).catch(() => { throw new Error('系统安全存储无法保存 API Key。'); });
    try {
      await commit(old => ({ ...old, activeId: old.activeId ?? next.id,
        profiles: original ? old.profiles.map(item => item.id === original.id ? next : item) : [...old.profiles, next] }), true);
    } catch (error) {
      if (key) await removeCredential(credential).catch(() => undefined);
      throw error;
    }
    if (original && key) await removeCredential(original.credential).catch(() => {
      setStorageError('配置已更新，但系统未能清理旧密钥。');
    });
  }

  async function deleteProfile(item: Profile) {
    await commit(old => {
      const profiles = old.profiles.filter(entry => entry.id !== item.id);
      return { ...old, profiles, activeId: old.activeId === item.id ? profiles[0]?.id ?? null : old.activeId };
    }, true);
    await removeCredential(item.credential).catch(() => {
      setStorageError('配置已移除，但系统未能清理它的密钥。');
      throw new Error('配置已移除，但系统未能清理它的密钥。');
    });
  }

  async function changeContext(item: Profile) {
    const choice = await contextChoice(item);
    if (!choice) return;
    await commit(old => ({ ...old, profiles: old.profiles.map(entry => entry.id === item.id ? { ...entry, context: choice } : entry) }));
    return { ...item, context: choice };
  }

  function openTab(next: Tab) {
    if (next === tab) return;
    Keyboard.dismiss();
    setTab(next);
  }

  async function getActiveProfile() {
    const active = current.current.profiles.find(item => item.id === current.current.activeId);
    if (!active) throw new Error('请先在 API 设置中保存一套配置。');
    return active.context === 'ask' ? changeContext(active) : active;
  }

  async function sendTurn(text: string, active: Profile, key: string, signal?: AbortSignal) {
    const snapshot = current.current;
    const messages = coachMessages({ profile: active, scene: snapshot.scene, mode: snapshot.mode,
      history: snapshot.messages, memories: snapshot.memories, memoryEnabled: snapshot.memoryEnabled, text });
    const content = await requestChat(transport, active, key, messages, signal);
    if (signal?.aborted) return '';
    const reply = parseCoachReply(content, snapshot.mode);
    update(old => ({ ...old, messages: [...old.messages, { id: makeId(), role: 'user' as const, text }, {
      id: makeId(), role: 'assistant' as const, text: reply.reply, spoken: reply.spoken, corrections: reply.corrections,
      model: active.model,
    }].slice(-250) }));
    if (current.current.memoryEnabled && (reply.memory || !signal)) setSuggestion(reply.memory);
    return reply.spoken;
  }

  function beginCall() {
    if (sendLock.current) return;
    Keyboard.dismiss();
    let connection: { profile: Profile; key: string } | undefined;
    void voice.startCall(async signal => {
      const profile = await getActiveProfile();
      if (!profile || signal.aborted) return false;
      const key = await readCredential(profile.credential);
      connection = { profile, key };
      return true;
    }, async (text, signal) => {
      if (!connection || signal.aborted) return '';
      try {
        return await sendTurn(text, connection.profile, connection.key, signal);
      } catch (error) {
        if (!signal.aborted) setDraft(old => old || text);
        throw error;
      }
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text || sendLock.current || voice.phase !== 'idle' || voice.callPhase) return;
    sendLock.current = true;
    setSending(true); setChatError('');
    Keyboard.dismiss();
    try {
      const active = await getActiveProfile();
      if (!active) return;
      const key = await readCredential(active.credential);
      const spoken = await sendTurn(text, active, key);
      setDraft('');
      void voice.speak(spoken);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : '请求失败，请重试。');
    } finally { setSending(false); sendLock.current = false; }
  }

  function saveMemory(item: Suggestion, id?: string) {
    update(old => {
      if (!old.memoryEnabled) return old;
      const existing = id ?? old.memories.find(memory => memory.kind === item.kind && memory.text.toLowerCase() === item.text.toLowerCase())?.id;
      const next = { ...item, id: existing ?? makeId(), updatedAt: Date.now() };
      return { ...old, memories: [next, ...old.memories.filter(memory => memory.id !== next.id)] };
    });
  }

  function newChat(next: Scene) {
    function reset() {
      update(old => ({ ...old, scene: next, messages: [] }));
      setDraft(''); setChatError(''); setSuggestion(null); setTab('chat');
      void voice.stopSpeech();
    }
    if (state.messages.length === 0) reset();
    else Alert.alert('开始新会话', '当前聊天记录会清空。已保存的学习记忆仍可使用。', [
      { text: '取消', style: 'cancel' }, { text: '开始', onPress: reset },
    ]);
  }

  if (loading || loadError) return <SafeAreaView style={styles.center}>
    {loading ? <ActivityIndicator size="large" color={colors.forest} /> : <>
      <Banner text="无法读取本机数据。请重试。" error />
      <Action label="重试" onPress={() => void load()} />
    </>}
  </SafeAreaView>;

  const voiceBusy = voice.phase !== 'idle';
  const navDisabled = sending || voiceBusy || !!voice.callPhase;
  const micLabel = voice.phase === 'recording' ? '结束录音' : voice.phase === 'starting' ? '正在启动' : voice.phase === 'finishing' ? '正在转写' : '开始录音';

  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="dark-content" />
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {!!storageError && <View style={styles.side}><Banner text={storageError} error /></View>}
      <View style={styles.fill}>
        {tab === 'chat' && <View style={styles.fill}>
          <View style={styles.header}>
            <View style={styles.brand}><Icon name="chatbubble-ellipses" size={22} color={colors.white} /></View>
            <View style={styles.fill}>
              <Text style={styles.brandTitle}>English Talk</Text>
              <Pressable accessibilityRole="button" disabled={navDisabled} onPress={() => openTab('api')}>
                <Text numberOfLines={1} style={ui.muted}>{profile ? profile.model : '配置聊天 API'}</Text>
              </Pressable>
            </View>
            <IconAction label="新会话" icon="add" disabled={navDisabled || !state.messages.length} onPress={() => newChat(state.scene)} />
          </View>
          <View style={styles.controls}>
            <Pressable style={styles.sceneLink} accessibilityRole="button" disabled={navDisabled} onPress={() => openTab('scenes')}>
              <Icon name={scene.icon} size={17} /><Text style={styles.sceneLabel}>{scene.title}</Text><Icon name="chevron-down" size={12} />
            </Pressable>
            <View style={styles.modeRow}>{(Object.keys(modes) as Mode[]).map(mode => <Chip key={mode} label={modes[mode]}
              active={state.mode === mode} onPress={() => update(old => ({ ...old, mode }))} />)}</View>
          </View>
          <FlatList ref={list} data={state.messages} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
            style={styles.fill} contentContainerStyle={styles.thread} onContentSizeChange={() => { if (state.messages.length) list.current?.scrollToEnd({ animated: false }); }}
            ListEmptyComponent={<View style={styles.hero}>
              <View style={styles.heroIcon}><Icon name={scene.icon} size={26} color={colors.lime} /></View>
              <Text style={styles.heroTitle}>{scene.en}</Text>
              <Text style={styles.heroText}>{scene.opener}</Text>
              <View style={ui.row}><Action label="听开场" icon="volume-medium-outline" onPress={() => void voice.speak(scene.opener)} disabled={navDisabled} />
                {!profile && <Action label="配置 API" icon="settings-outline" onPress={() => openTab('api')} disabled={navDisabled} />}</View>
            </View>}
            renderItem={({ item }) => <ChatMessage item={item} onPlay={() => void voice.speak(item.spoken ?? '')} disabled={navDisabled} />}
            ListFooterComponent={sending ? <View style={styles.pending}><ActivityIndicator size="small" color={colors.green} /><Text style={ui.muted}>正在回复</Text></View> : null} />
          {!!chatError && <View style={styles.side}><Banner text={chatError} error /></View>}
          {!voice.callPhase && state.memoryEnabled && suggestion && <View style={[ui.card, styles.suggestion]}>
            <Text style={ui.label}>{memoryKinds[suggestion.kind]}建议</Text>
            <Text style={ui.muted}>{suggestion.text}</Text>
            <View style={ui.row}>
              <Action label="保存记忆" onPress={() => { saveMemory(suggestion); setSuggestion(null); }} />
              <Action label="略过" onPress={() => setSuggestion(null)} />
            </View>
          </View>}
          {voice.callPhase ? <View style={styles.callPanel}>
            <View style={ui.between}>
              <View style={styles.fill} accessibilityLiveRegion="polite">
                <Text style={styles.callLabel}>{callLabels[voice.callPhase]}</Text>
                <Text style={styles.callHint} numberOfLines={2}>{voice.callPreview || '说完停顿，AI 会自动接话。'}</Text>
              </View>
              <Action label="挂断" icon="call" variant="danger" onPress={voice.endCall} />
            </View>
          </View> : <View style={styles.composer}>
            <TextInput accessibilityLabel="聊天输入" placeholder="用英语说一句，或输入文字…" placeholderTextColor={colors.muted}
              value={draft} onChangeText={setDraft} editable={!sending && !voiceBusy} multiline maxLength={2000} style={styles.draft} />
            <View style={ui.between}>
              <View style={ui.row}>
                <Action label="语音通话" icon="call-outline" variant="solid" disabled={navDisabled} onPress={beginCall} />
                <IconAction label={micLabel} icon={voice.phase === 'recording' ? 'stop' : 'mic-outline'} filled={voice.phase === 'recording'}
                  disabled={sending || voice.phase === 'starting' || voice.phase === 'finishing'} onPress={() => { Keyboard.dismiss(); void voice.toggle(draft); }} />
              </View>
              <IconAction label={sending ? '发送中' : '发送'} icon="arrow-up" filled disabled={!draft.trim() || navDisabled} onPress={() => void send()} />
            </View>
          </View>}
        </View>}
        {tab === 'scenes' && <SceneSettings selected={state.scene} onSelect={newChat} />}
        {tab === 'memory' && <MemorySettings enabled={state.memoryEnabled} memories={state.memories} onSave={saveMemory}
          onToggle={enabled => { setSuggestion(null); update(old => ({ ...old, memoryEnabled: enabled })); }}
          onDelete={id => update(old => ({ ...old, memories: old.memories.filter(item => item.id !== id) }))} />}
        {tab === 'api' && <ApiSettings profiles={state.profiles} activeId={state.activeId} onSave={saveProfile} onDelete={deleteProfile}
          onSelect={id => commit(old => ({ ...old, activeId: id }), true)} onContext={item => void changeContext(item).catch(() => undefined)}
          onTest={async item => { const key = await readCredential(item.credential); await requestChat(transport, item, key, [{ role: 'user', content: 'Reply with just OK.' }]); }} />}
      </View>
      <View style={styles.navigation}>{tabs.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key, disabled: navDisabled }}
        disabled={navDisabled} onPress={() => openTab(item.key)} style={styles.tab}>
        <View style={[styles.tabIcon, tab === item.key && styles.activeTab]}><Icon name={item.icon} size={20} color={tab === item.key ? colors.forest : colors.muted} /></View>
        <Text style={[styles.tabText, tab === item.key && styles.activeLabel]}>{item.label}</Text>
      </Pressable>)}</View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function SceneSettings({ selected, onSelect }: { selected: Scene; onSelect: (scene: Scene) => void }) {
  return <FlatList data={Object.keys(scenes) as Scene[]} keyExtractor={id => id} contentContainerStyle={settingsStyles.page}
    ListHeaderComponent={<Text style={settingsStyles.heading}>选择练习场景</Text>}
    renderItem={({ item }) => {
      const scene = scenes[item];
      return <Pressable accessibilityRole="button" accessibilityState={{ selected: item === selected }}
        onPress={() => onSelect(item)} style={({ pressed }) => [ui.card, styles.sceneCard, pressed && ui.faded]}>
        <View style={styles.sceneBadge}><Icon name={scene.icon} size={24} /></View>
        <View style={styles.fill}>
          <Text style={ui.title}>{scene.title}</Text><Text style={ui.muted}>{scene.hint}</Text>
        </View>
        <Icon name={item === selected ? 'checkmark-circle' : 'chevron-forward'} size={20} color={colors.green} />
      </Pressable>;
    }} />;
}

function ChatMessage({ item, onPlay, disabled }: { item: Message; onPlay: () => void; disabled: boolean }) {
  const user = item.role === 'user';
  return <View style={[styles.messageGroup, user && styles.userGroup]}>
    <Text style={styles.messageLabel}>{user ? '我' : '英语陪练'}</Text>
    <View style={[styles.message, user && styles.userMessage]}>
      <Text selectable style={[styles.messageText, user && styles.userText]}>{item.text}</Text>
      {!!item.spoken && <View style={ui.row}><Action label="重播" icon="volume-medium-outline" onPress={onPlay} disabled={disabled} /></View>}
    </View>
    {item.corrections?.map((correction, index) => <View key={index} style={styles.correction}>
      <View style={ui.row}><Icon name="sparkles-outline" size={15} color={colors.warning} /><Text style={styles.correctionLabel}>表达建议</Text></View>
      <Text selectable style={ui.muted}>{correction.original}</Text>
      <Text selectable style={styles.better}>{correction.better}</Text>
      <Text style={ui.muted}>{correction.reason}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, fill: { flex: 1 },
  center: { flex: 1, backgroundColor: colors.background, padding: 24, gap: 12, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  brand: { backgroundColor: colors.forest, borderRadius: 15, width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  brandTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -0.6, color: colors.ink },
  controls: { paddingHorizontal: 18, paddingBottom: 9, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  sceneLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 35, paddingHorizontal: 9, gap: 6, borderRadius: 10, backgroundColor: colors.pale },
  sceneLabel: { fontSize: 13, fontWeight: '800', color: colors.ink }, modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thread: { padding: 16, gap: 14, flexGrow: 1 }, side: { paddingHorizontal: 16, paddingBottom: 6 },
  hero: { backgroundColor: colors.forest, borderRadius: 24, padding: 20, gap: 13 },
  heroIcon: { width: 48, height: 48, borderRadius: 15, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.green },
  heroTitle: { color: colors.white, fontSize: 31, fontWeight: '900', letterSpacing: -0.6 },
  heroText: { color: colors.darkMuted, fontSize: 17, lineHeight: 24 },
  messageGroup: { alignItems: 'flex-start', alignSelf: 'flex-start', maxWidth: '92%', gap: 5 },
  userGroup: { alignItems: 'flex-end', alignSelf: 'flex-end' }, messageLabel: { color: colors.muted, fontSize: 12, marginHorizontal: 6 },
  message: { gap: 8, backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11 },
  userMessage: { backgroundColor: colors.forest }, messageText: { color: colors.ink, fontSize: 16, lineHeight: 23 }, userText: { color: colors.white },
  correction: { backgroundColor: colors.warningBg, borderRadius: 14, padding: 11, gap: 3 },
  correctionLabel: { color: colors.warning, fontSize: 12, fontWeight: '800' }, better: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 8 }, suggestion: { marginHorizontal: 16, marginBottom: 7, padding: 10, gap: 4 },
  composer: { backgroundColor: colors.surface, padding: 9, marginHorizontal: 14, marginBottom: 7, gap: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 18 },
  callPanel: { backgroundColor: colors.forest, padding: 15, marginHorizontal: 14, marginBottom: 7, borderRadius: 18 },
  callLabel: { color: colors.white, fontSize: 17, fontWeight: '800' },
  callHint: { color: colors.darkMuted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  draft: { color: colors.ink, fontSize: 16, minHeight: 42, maxHeight: 110, paddingHorizontal: 7, paddingVertical: 7, textAlignVertical: 'top' },
  navigation: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 5, paddingHorizontal: 10 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 47 },
  tabIcon: { width: 44, height: 28, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, activeTab: { backgroundColor: colors.lime },
  tabText: { color: colors.muted, fontSize: 11, fontWeight: '600' }, activeLabel: { color: colors.forest, fontWeight: '800' },
  sceneCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sceneBadge: { width: 50, height: 50, borderRadius: 15, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' },
});
