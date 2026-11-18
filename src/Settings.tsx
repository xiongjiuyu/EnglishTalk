import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { memoryKinds, type Memory, type MemoryKind, type Profile, type ProfileInput, type Suggestion } from './core';
import { Action, Banner, Chip, colors, Field, Icon, ui } from './ui';

const providers = [
  { name: 'DeepSeek', endpoint: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { name: '自定义兼容接口', endpoint: '', model: '' },
];
const blankProfile: ProfileInput = { name: '', provider: '', endpoint: '', model: '' };

export function ApiSettings({ profiles, activeId, onSave, onSelect, onDelete, onTest, onContext }: {
  profiles: Profile[]; activeId: string | null;
  onSave: (input: ProfileInput, key: string, original?: Profile) => Promise<void>;
  onSelect: (id: string) => Promise<void>; onDelete: (profile: Profile) => Promise<void>;
  onTest: (profile: Profile) => Promise<void>; onContext: (profile: Profile) => void;
}) {
  const [form, setForm] = useState<ProfileInput | null>(null);
  const [original, setOriginal] = useState<Profile>();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });
  const [busy, setBusy] = useState('');

  function edit(profile?: Profile) {
    setOriginal(profile);
    setForm(profile ? { name: profile.name, provider: profile.provider, endpoint: profile.endpoint, model: profile.model } : blankProfile);
    setKey(''); setReveal(false); setStatus({ text: '', error: false });
  }

  async function run(id: string, operation: () => Promise<void>, message = '') {
    if (busy) return;
    setBusy(id); setStatus({ text: '', error: false });
    try {
      await operation();
      setStatus({ text: message, error: false });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : '操作失败，请重试。', error: true });
    } finally { setBusy(''); }
  }

  function save() {
    if (!form) return;
    void run('save', async () => { await onSave(form, key, original); setKey(''); setForm(null); }, '配置已保存。');
  }

  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
    <Text style={styles.heading}>API 设置</Text>
    <Text style={ui.muted}>选择聊天用的服务和模型。录音转写、英语朗读由手机系统独立处理。</Text>
    {!!status.text && <Banner text={status.text} error={status.error} />}
    {form ? <View style={ui.card}>
      <Text style={ui.title}>{original ? '编辑配置' : '新增配置'}</Text>
      <View style={ui.row}>{providers.map(provider => <Chip key={provider.name} active={form.provider === provider.name} label={provider.name}
        onPress={() => setForm({ name: form.name || provider.name, provider: provider.name, endpoint: provider.endpoint, model: provider.model })} />)}</View>
      <Field label="配置名称" value={form.name} onChangeText={name => setForm({ ...form, name })} maxLength={60} />
      <Field label="服务商" value={form.provider} onChangeText={provider => setForm({ ...form, provider })} maxLength={60} />
      <Field label="HTTPS API 地址" value={form.endpoint} onChangeText={endpoint => setForm({ ...form, endpoint })} placeholder="https://api.example.com/v1" autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={700} />
      <Field label="对话模型" value={form.model} onChangeText={model => setForm({ ...form, model })} placeholder="输入服务商提供的模型 ID" autoCapitalize="none" autoCorrect={false} maxLength={160} />
      <Field label="API Key" value={key} onChangeText={setKey} secureTextEntry={!reveal} autoCapitalize="none" autoCorrect={false} autoComplete="off"
        placeholder={original ? '留空保留当前密钥' : '粘贴你的 API Key'} maxLength={2048}
        end={<Action label={reveal ? '隐藏' : '显示'} onPress={() => setReveal(!reveal)} />} />
      <Text style={ui.muted}>变更 API 地址时，请重新填写适用于新地址的密钥。</Text>
      <View style={ui.row}>
        <Action label="保存配置" variant="solid" icon="checkmark" busy={busy === 'save'} disabled={!!busy} onPress={save} />
        <Action label="取消" disabled={!!busy} onPress={() => { setKey(''); setForm(null); setStatus({ text: '', error: false }); }} />
      </View>
    </View> : <>
      <View style={ui.row}><Action label="新增 API 配置" variant="solid" icon="add" disabled={!!busy} onPress={() => edit()} /></View>
      {!profiles.length && <Banner text="还没有配置。填写一个兼容 Chat Completions 的 API 地址、密钥和模型即可开始。" />}
      {profiles.map(profile => <View key={profile.id} style={ui.card}>
        <View style={ui.between}>
          <Text style={[ui.title, { flex: 1 }]}>{profile.name}</Text>
          {activeId === profile.id && <Text style={styles.tag}>使用中</Text>}
        </View>
        <Text style={ui.muted}>{profile.provider} · {profile.model}</Text>
        <Text selectable style={ui.muted}>{profile.endpoint}</Text>
        <View style={ui.row}>
          <Action label="测试连接" icon="pulse-outline" busy={busy === profile.id} disabled={!!busy}
            onPress={() => void run(profile.id, () => onTest(profile), `「${profile.name}」连接成功。`)} />
          {activeId !== profile.id && <Action label="切换使用" variant="solid" disabled={!!busy}
            onPress={() => void run('select', () => onSelect(profile.id), `已切换至「${profile.name}」，下一轮生效。`)} />}
          <Action label="编辑" disabled={!!busy} onPress={() => edit(profile)} />
          <Action label="删除" variant="danger" disabled={!!busy} onPress={() => Alert.alert('删除 API 配置', `删除「${profile.name}」及其本机密钥？`, [
            { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void run('delete', () => onDelete(profile), '配置已删除。') },
          ])} />
        </View>
        <View style={ui.between}>
          <Text style={[ui.muted, { flex: 1 }]}>{profile.context === 'allow' ? '允许发送近期对话和相关记忆' : profile.context === 'deny' ? '仅发送本轮输入' : '首次聊天前询问上下文授权'}</Text>
          <Action label="更改" disabled={!!busy} onPress={() => onContext(profile)} />
        </View>
      </View>)}
    </>}
  </ScrollView>;
}

export function MemorySettings({ enabled, memories, onToggle, onSave, onDelete }: {
  enabled: boolean; memories: Memory[]; onToggle: (enabled: boolean) => void;
  onSave: (item: Suggestion, id?: string) => void; onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<(Suggestion & { id?: string }) | null>(null);

  function save() {
    if (!form?.text.trim()) return;
    onSave({ kind: form.kind, text: form.text.trim() }, form.id);
    setForm(null);
  }

  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
    <Text style={styles.heading}>学习记忆</Text>
    <View style={ui.card}>
      <View style={ui.between}>
        <Text style={[ui.title, { flex: 1 }]}>跨会话记忆</Text>
        <Switch accessibilityLabel="跨会话记忆" value={enabled} onValueChange={value => { setForm(null); onToggle(value); }}
          trackColor={{ false: colors.line, true: colors.green }} />
      </View>
      <Text style={ui.muted}>学习记忆保存在这部手机上。开启且允许当前 API 使用上下文时，相关条目才会随聊天发送。</Text>
    </View>
    {!enabled ? <Banner text="已关闭。重新开启后可查看原有记忆。" /> : <>
      {form ? <View style={ui.card}>
        <Text style={ui.title}>{form.id ? '编辑记忆' : '新增记忆'}</Text>
        <View style={ui.row}>{(Object.keys(memoryKinds) as MemoryKind[]).map(kind => <Chip key={kind} label={memoryKinds[kind]}
          active={kind === form.kind} onPress={() => setForm({ ...form, kind })} />)}</View>
        <Field label="记忆内容" value={form.text} onChangeText={text => setForm({ ...form, text })} maxLength={240} multiline placeholder="例如：练习用英语做课堂展示" />
        <View style={ui.row}><Action label="保存记忆" variant="solid" disabled={!form.text.trim()} onPress={save} />
          <Action label="取消" onPress={() => setForm(null)} /></View>
      </View> : <View style={ui.row}><Action label="新增记忆" icon="add" variant="solid" onPress={() => setForm({ kind: 'goal', text: '' })} /></View>}
      {!form && !memories.length && <Banner text="这里会保存你的学习目标、话题偏好、练习进度和易错表达。" />}
      {memories.map(item => <View key={item.id} style={ui.card}>
        <View style={ui.row}><Icon name="bookmark-outline" size={17} /><Text style={styles.tag}>{memoryKinds[item.kind]}</Text></View>
        <Text selectable style={styles.memory}>{item.text}</Text>
        <View style={ui.row}>
          <Action label="编辑" onPress={() => setForm(item)} />
          <Action label="删除" variant="danger" onPress={() => Alert.alert('删除记忆', '删除这条学习记忆？', [
            { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { if (form?.id === item.id) setForm(null); onDelete(item.id); } },
          ])} />
        </View>
      </View>)}
    </>}
  </ScrollView>;
}

export const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, gap: 14 },
  heading: { color: colors.ink, fontSize: 31, fontWeight: '800', letterSpacing: -0.6 },
  tag: { color: colors.green, fontWeight: '800', fontSize: 12 },
  memory: { color: colors.ink, fontSize: 16, lineHeight: 23 },
});
