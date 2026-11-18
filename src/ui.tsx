import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

export const colors = {
  background: '#F4F5EF', surface: '#FFFFFF', ink: '#172B24', muted: '#50645B', line: '#DDE4DC',
  forest: '#193F33', green: '#285844', pale: '#E4EDE2', lime: '#D8EC9C', white: '#FFFFFF',
  warning: '#75481C', warningBg: '#F9EEDA', danger: '#A03938', darkMuted: '#B8D0C2',
};

export type IconName = ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, size = 21, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Action({ label, icon, onPress, variant = 'light', disabled = false, busy = false }: {
  label: string; icon?: IconName; onPress: () => void; variant?: 'light' | 'solid' | 'danger'; disabled?: boolean; busy?: boolean;
}) {
  const foreground = variant === 'solid' ? colors.white : variant === 'danger' ? colors.danger : colors.ink;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy}
    onPress={onPress} style={({ pressed }) => [ui.action, variant === 'solid' && ui.solid, (pressed || disabled) && ui.faded]}>
    {busy ? <ActivityIndicator size="small" color={foreground} /> : icon && <Icon name={icon} size={17} color={foreground} />}
    <Text style={[ui.actionText, { color: foreground }]}>{label}</Text>
  </Pressable>;
}

export function IconAction({ label, icon, onPress, disabled = false, filled = false }: {
  label: string; icon: IconName; onPress: () => void; disabled?: boolean; filled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [ui.iconAction, filled && ui.solid, (pressed || disabled) && ui.faded]}>
    <Icon name={icon} color={filled ? colors.white : colors.forest} />
  </Pressable>;
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[ui.chip, active && ui.chipActive]}>
    <Text style={[ui.chipText, active && ui.chipTextActive]}>{label}</Text>
  </Pressable>;
}

export function Field({ label, end, ...props }: TextInputProps & { label: string; end?: ReactNode }) {
  return <View style={ui.field}>
    <Text style={ui.label}>{label}</Text>
    <View style={ui.fieldRow}>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} {...props} style={[ui.input, props.style]} />
      {end}
    </View>
  </View>;
}

export function Banner({ text, error = false }: { text: string; error?: boolean }) {
  return <View accessibilityLiveRegion="polite" style={[ui.banner, error && ui.bannerError]}>
    <Icon name={error ? 'alert-circle-outline' : 'information-circle-outline'} color={error ? colors.warning : colors.forest} size={19} />
    <Text style={[ui.bannerText, error && { color: colors.warning }]}>{text}</Text>
  </View>;
}

export const ui = StyleSheet.create({
  action: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.pale },
  actionText: { fontSize: 14, fontWeight: '700' },
  iconAction: { height: 46, width: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.pale },
  solid: { backgroundColor: colors.forest }, faded: { opacity: 0.48 },
  chip: { minHeight: 36, justifyContent: 'center', borderRadius: 20, borderColor: colors.line, borderWidth: 1, paddingHorizontal: 12 },
  chipActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  chipText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  chipTextActive: { color: colors.ink, fontWeight: '800' },
  card: { borderRadius: 19, backgroundColor: colors.surface, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  field: { gap: 5 }, fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: colors.ink },
  input: { flex: 1, minHeight: 46, backgroundColor: colors.background, borderRadius: 12, borderColor: colors.line, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: colors.ink },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  banner: { padding: 11, borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.pale },
  bannerError: { backgroundColor: colors.warningBg }, bannerText: { flex: 1, color: colors.forest, fontSize: 13, lineHeight: 19 },
});
